export const PERIODS = { today: 1, yesterday: 1, week: 7, month: 30 };
export const STALE_AFTER_MS = 5 * 60 * 1000;
const dateFormatters = new Map();

export function validZone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return typeof value === 'string' && value.length > 0;
  } catch { return false; }
}

export function localZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function dayKey(timestamp, zone) {
  if (!dateFormatters.has(zone)) dateFormatters.set(zone, new Intl.DateTimeFormat('en', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }));
  const parts = dateFormatters.get(zone).formatToParts(timestamp);
  const get = (name) => parts.find((part) => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function periodBounds(period, now, zone) {
  const today = dayKey(now, zone);
  const date = new Date(`${today}T00:00:00Z`);
  if (period === 'yesterday') {
    date.setUTCDate(date.getUTCDate() - 1);
    const yesterday = date.toISOString().slice(0, 10);
    return { first: yesterday, last: yesterday };
  }
  date.setUTCDate(date.getUTCDate() - ((PERIODS[period] || 1) - 1));
  return { first: date.toISOString().slice(0, 10), last: today };
}

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// A missing entry quote must not turn a default 1× into a measured return.
export function normalizeCallout(raw, now = Date.now()) {
  if (!raw || typeof raw.calloutId !== 'string' || !/^[\w-]{1,128}$/.test(raw.calloutId)
    || !positive(raw.createdAt) || raw.createdAt > now + 300_000) return null;
  const supported = !raw.perp && !raw.collectible
    && (!raw.assetClass || raw.assetClass === 'ASSET_CLASS_TOKEN');
  const hasEntry = positive(raw.calloutPrice) || positive(raw.calloutPriceUsd);
  return {
    id: raw.calloutId,
    mint: typeof raw.coinMint === 'string' ? raw.coinMint.slice(0, 128) : '',
    createdAt: raw.createdAt,
    supported,
    entryCap: supported && positive(raw.marketCap) ? raw.marketCap : null,
    current: supported && hasEntry && nonnegative(raw.multiple) ? raw.multiple : null,
    peak: supported && hasEntry && positive(raw.maxMultiplier) ? raw.maxMultiplier : null,
  };
}

export function mean(values) {
  return values.length ? values.reduce((total, value) => total + value / values.length, 0) : null;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(rows, period, now, zone) {
  const { first, last } = periodBounds(period, now, zone);
  return summarizeRows(rows, (row) => {
    const date = dayKey(row.createdAt, zone);
    return date >= first && date <= last && row.createdAt <= now;
  });
}

// Feed windows are elapsed time, independent of midnight and DST.
export function summarizeRolling(rows, durationMs, now) {
  return summarizeRows(rows, row => row.createdAt >= now - durationMs && row.createdAt <= now);
}

function summarizeRows(rows, inWindow) {
  const unique = new Map(rows.map((row) => [row.id, row]));
  const inPeriod = [...unique.values()].filter(inWindow);
  const calls = inPeriod.filter((row) => row.supported).sort((a, b) => b.createdAt - a.createdAt);
  const caps = calls.map((row) => row.entryCap).filter(positive);
  const currents = calls.map((row) => row.current).filter(nonnegative);
  const peaks = calls.map((row) => row.peak).filter(positive);
  return {
    calls, count: calls.length, excluded: inPeriod.length - calls.length,
    entry: mean(caps), entryN: caps.length,
    current: mean(currents), currentN: currents.length, median: median(currents),
    peak: mean(peaks), peakN: peaks.length,
    winners: currents.filter((value) => value > 1).length,
  };
}

export function money(value) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
  }).format(value);
}

export function multiple(value) {
  if (value === null) return '—';
  if (value > 0 && value < 0.01) return '<0.01×';
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}
