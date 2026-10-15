import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCallout, summarize, summarizeRolling, dayKey, periodBounds, multiple } from '../stats.js';

const now = Date.parse('2026-10-15T12:00:00Z');
const raw = (id, changes = {}) => ({ calloutId: id, coinMint: 'mint', createdAt: now - 1000, marketCap: 10000, calloutPrice: .01, multiple: 1, maxMultiplier: 3, ...changes });

test('averages include losses and zero, exclude missing quotes and deduplicate IDs', () => {
  const rows = [raw('a', { multiple: 0 }), raw('b', { multiple: .5, marketCap: 20000 }), raw('c', { multiple: 8, marketCap: 30000 }), raw('missing', { calloutPrice: 0, multiple: 1, marketCap: 0, maxMultiplier: null })].map((row) => normalizeCallout(row, now));
  const stats = summarize([...rows, rows[0]], 'today', now, 'UTC');
  assert.equal(stats.count, 4);
  assert.equal(stats.currentN, 3);
  assert.ok(Math.abs(stats.current - 8.5 / 3) < 1e-12);
  assert.equal(stats.median, .5);
  assert.equal(stats.entry, 20000);
  assert.equal(stats.peakN, 3);
});

test('zero timestamps, future dates and non-token products do not pollute statistics', () => {
  assert.equal(normalizeCallout(raw('a', { createdAt: 0 }), now), null);
  assert.equal(normalizeCallout(raw('a', { createdAt: now + 3600000 }), now), null);
  const stats = summarize([normalizeCallout(raw('p', { perp: {} }), now)], 'today', now, 'UTC');
  assert.equal(stats.count, 0); assert.equal(stats.excluded, 1); assert.equal(stats.current, null);
});

test('today follows timezone and calendar windows survive DST', () => {
  const midnight = Date.parse('2026-10-15T00:30:00Z');
  assert.equal(dayKey(midnight, 'America/Los_Angeles'), '2026-10-14');
  assert.equal(dayKey(midnight, 'Europe/Rome'), '2026-10-15');
  assert.deepEqual(periodBounds('week', Date.parse('2026-11-02T12:00:00Z'), 'America/New_York'), { first: '2026-10-27', last: '2026-11-02' });
  const row = normalizeCallout(raw('late', { createdAt: midnight }), now);
  assert.equal(summarize([row], 'today', now, 'America/Los_Angeles').count, 0);
  assert.equal(summarize([row], 'today', now, 'Europe/Rome').count, 1);
});

test('period boundaries include day 30 but not day 31, and missing values stay missing', () => {
  const rows = [29, 30].map((days) => normalizeCallout(raw(`day-${days}`, { createdAt: now - days * 86400000 }), now));
  assert.equal(summarize(rows, 'month', now, 'UTC').count, 1);
  assert.equal(multiple(null), '—'); assert.equal(multiple(0), '0.00×'); assert.equal(multiple(.001), '<0.01×');
});

test('yesterday contains only the preceding calendar day in the selected timezone', () => {
  const rows = [
    raw('before', { createdAt: Date.parse('2026-10-13T21:59:59Z') }),
    raw('start', { createdAt: Date.parse('2026-10-13T22:00:00Z') }),
    raw('end', { createdAt: Date.parse('2026-10-14T21:59:59Z') }),
    raw('today', { createdAt: Date.parse('2026-10-14T22:00:00Z') }),
  ].map((value) => normalizeCallout(value, now));
  assert.deepEqual(summarize(rows, 'yesterday', now, 'Europe/Rome').calls.map((call) => call.id), ['end', 'start']);
  assert.deepEqual(periodBounds('yesterday', now, 'Europe/Rome'), { first: '2026-10-14', last: '2026-10-14' });
  assert.deepEqual(summarize(rows, 'yesterday', now, 'UTC').calls.map((call) => call.id), ['today', 'end']);
});

test('yesterday handles a 25-hour DST day and year rollover', () => {
  const afterDST = Date.parse('2026-10-26T12:00:00Z');
  const rows = [
    ['before', '2026-10-24T21:59:59Z'], ['start', '2026-10-24T22:00:00Z'],
    ['first-0230', '2026-10-25T00:30:00Z'], ['second-0230', '2026-10-25T01:30:00Z'],
    ['end', '2026-10-25T22:59:59Z'], ['today', '2026-10-25T23:00:00Z'],
  ].map(([id, time]) => normalizeCallout(raw(id, { createdAt: Date.parse(time) }), afterDST));
  assert.deepEqual(summarize(rows, 'yesterday', afterDST, 'Europe/Rome').calls.map((call) => call.id), ['end', 'second-0230', 'first-0230', 'start']);
  assert.deepEqual(periodBounds('yesterday', Date.parse('2027-01-01T12:00:00Z'), 'UTC'), { first: '2026-12-31', last: '2026-12-31' });
});


test('rolling windows include their exact cutoff and retain the full thirtieth day', () => {
  const hour = 3_600_000;
  for (const hours of [24, 7 * 24, 30 * 24]) {
    const rows = [
      raw('before', { createdAt: now - hours * hour - 1 }),
      raw('cutoff', { createdAt: now - hours * hour }),
      raw('recent', { createdAt: now - 1 }),
      raw('now', { createdAt: now }),
      raw('future', { createdAt: now + 1 }),
    ].map(value => normalizeCallout(value, now));
    assert.deepEqual(summarizeRolling(rows, hours * hour, now).calls.map(row => row.id), ['now', 'recent', 'cutoff']);
  }
});

test('rolling 24h crosses midnight and a DST change as elapsed time', () => {
  const end = Date.parse('2026-10-25T12:00:00Z');
  const rows = [
    raw('24h', { createdAt: end - 86_400_000 }),
    raw('25h', { createdAt: end - 90_000_000 }),
  ].map(value => normalizeCallout(value, end));
  assert.deepEqual(summarizeRolling(rows, 86_400_000, end).calls.map(row => row.id), ['24h']);
  assert.equal(summarize(rows, 'today', end, 'Europe/Rome').count, 0);
});
