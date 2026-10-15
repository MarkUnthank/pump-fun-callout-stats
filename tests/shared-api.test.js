import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedClient, CACHE_API } from '../shared-api.js';

const snapshot = { profile: { id: 'uuid', username: 'caller', address: 'wallet' }, rows: [], fetchedAt: Date.now(), complete: true };
test('extension requests only the shared origin without credentials or force bypasses', async () => {
  const seen = [];
  const client = createSharedClient(async (url, options) => {
    seen.push({ url, options });
    assert.ok(url.startsWith(CACHE_API + '/'));
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return Response.json({ ok: true, snapshot: url.endsWith('/updates') ? { rows: [], issues: [] } : snapshot, snapshots: [snapshot] });
  });
  assert.deepEqual(await client.load('@caller', { force: true }), snapshot);
  assert.deepEqual(JSON.parse(seen[0].options.body), { profile: 'caller' });
  assert.equal(seen.length, 1);
});

test('shared reads are batch cache-only requests and updates send only the selected public IDs', async () => {
  const seen = [];
  const client = createSharedClient(async (url, options) => {
    seen.push({ url, options });
    return Response.json({ ok: true, snapshot: { rows: [], issues: [] }, snapshots: [snapshot] });
  });
  assert.equal((await client.readShared(['caller', 'wallet', 'caller'])).length, 1);
  assert.equal(seen[0].options.method, 'GET');
  assert.deepEqual(new URL(seen[0].url).searchParams.getAll('profile'), ['caller', 'wallet']);
  await client.loadUpdates('caller', 'selected-call');
  assert.deepEqual(JSON.parse(seen[1].options.body), { profile: 'caller', calloutId: 'selected-call' });
  await assert.rejects(client.readShared(Array(21).fill('caller')));
  await assert.rejects(client.loadUpdates('caller', '../bad'));
  assert.equal(seen.length, 2);
});

test('cache errors and invalid responses are visible with no direct Pump fallback or automatic retry', async () => {
  for (const result of [new Error('offline'), new Response('<html>down</html>', { status: 503 }),
    Response.json({ ok: false, error: 'Pump is limiting requests. Shared lookups are paused.' }, { status: 429 }),
    Response.json({ ok: true, snapshot: {} })]) {
    let requests = 0;
    const client = createSharedClient(async url => {
      requests++; assert.ok(url.startsWith(CACHE_API));
      if (result instanceof Error) throw result;
      return result;
    });
    await assert.rejects(client.load('caller'), /cache|limiting/i);
    assert.equal(requests, 1);
  }
});
