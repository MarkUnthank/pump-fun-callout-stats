import { normalizeCallout } from './stats.js';

const BASE = 'https://frontend-api-v3.pump.fun';
const DAY = 86_400_000;
export const PAGE_LIMIT = 100;
export const MAX_PAGES = 3;

export function parseProfile(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Enter a Pump username, wallet address or profile URL.');
  let id = value.trim().replace(/^@/, '');
  if (/^https?:\/\//i.test(id)) {
    let url;
    try { url = new URL(id); } catch { throw new Error('That profile URL is not valid.'); }
    const match = url.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if (url.protocol !== 'https:' || url.hostname !== 'pump.fun' || url.port || url.username || url.password || !match) {
      throw new Error('Use a profile URL from https://pump.fun/profile/…');
    }
    try { id = decodeURIComponent(match[1]); } catch { throw new Error('That profile URL is not valid.'); }
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Use a Pump username or wallet address, without spaces.');
  return id;
}

// Share pacing across profile history and update scans in the service worker.
export function createPacedFetcher(fetcher = fetch, { gapMs = 1000, clock = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let tail = Promise.resolve();
  let nextAt = 0;
  let blockedUntil = 0;
  return (url, options) => {
    const job = tail.then(async () => {
      if (clock() < blockedUntil) {
        const error = new Error('Pump is limiting requests. Wait a minute, then refresh.');
        error.code = 'PUMP_RATE_LIMIT'; throw error;
      }
      const delay = nextAt - clock();
      if (delay > 0) await wait(delay);
      nextAt = clock() + gapMs;
      const response = await fetcher(url, options);
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 60;
        blockedUntil = clock() + Math.max(60, seconds) * 1000;
      }
      return response;
    });
    tail = job.catch(() => {});
    return job;
  };
}
const liveFetch = createPacedFetcher();

export async function getJson(url, fetcher) {
  let response;
  try {
    response = await (fetcher === fetch ? liveFetch : fetcher)(url, { credentials: 'omit', signal: AbortSignal.timeout(12_000) });
  } catch (error) { if (error.code === 'PUMP_RATE_LIMIT') throw error; throw new Error('Pump could not be reached. Check your connection and try again.'); }
  if (response.status === 404) throw new Error('Pump could not find that profile. Check the Pump username or profile URL.');
  if (response.status === 429) throw new Error('Pump is limiting requests. Wait a minute, then refresh.');
  if (!response.ok) throw new Error(`Pump returned an error (${response.status}). Try again shortly.`);
  try { return await response.json(); } catch { throw new Error('Pump returned an unreadable response. Try again shortly.'); }
}

export async function loadProfile(input, { fetcher = fetch, now = Date.now(), maxPages = MAX_PAGES } = {}) {
  const id = parseProfile(input);
  const user = await getJson(`${BASE}/users/${encodeURIComponent(id)}`, fetcher);
  if (typeof user?.userId !== 'string' || !/^[\w-]{1,100}$/.test(user.userId)
    || typeof user.username !== 'string' || !user.username) {
    throw new Error('This Pump profile has no readable callout history identifier.');
  }
  // Fetch a margin beyond 30 calendar days so all supported timezones are covered.
  const cutoff = now - 32 * DAY;
  const rows = new Map();
  const seenTokens = new Set();
  const issues = [];
  let pageToken = '';
  let pages = 0;
  let invalidRows = 0;
  let complete = false;
  let previousTimestamp = Infinity;
  const started = Date.now();
  for (; pages < maxPages;) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), sortBy: 'TIMESTAMP', sortOrder: 'DESC' });
    if (pageToken) params.set('pageToken', pageToken);
    let page;
    try {
      page = await getJson(`${BASE}/callout/list/${encodeURIComponent(user.userId)}?${params}`, fetcher);
      if (!Array.isArray(page?.callouts) || typeof page.nextPageToken !== 'string') {
        throw new Error('Pump’s history format changed. Some calls could not be read.');
      }
    } catch (error) {
      if (pages === 0) throw error;
      issues.push(error.message);
      break;
    }
    pages++;
    let ordered = true;
    let newest = 0;
    for (const raw of page.callouts) {
      const row = normalizeCallout(raw, now);
      if (!row) { invalidRows++; continue; }
      if (row.createdAt > previousTimestamp) ordered = false;
      previousTimestamp = row.createdAt;
      newest = Math.max(newest, row.createdAt);
      if (!rows.has(row.id)) rows.set(row.id, row);
    }
    if (!ordered && !issues.includes('Pump returned history out of time order.')) {
      issues.push('Pump returned history out of time order.');
    }
    if (!page.nextPageToken) { complete = true; break; }
    // Short and even empty pages can have a next cursor. Only the cursor ends history.
    if (newest > 0 && newest < cutoff && issues.length === 0 && invalidRows === 0) { complete = true; break; }
    if (seenTokens.has(page.nextPageToken)) { issues.push('Pump repeated a history page.'); break; }
    seenTokens.add(page.nextPageToken);
    pageToken = page.nextPageToken;
    if (Date.now() - started > 40_000) { issues.push('The history request reached its time limit.'); break; }
  }
  if (!complete && pages >= maxPages) issues.push(`History is limited to ${(maxPages * PAGE_LIMIT).toLocaleString('en-US')} calls per refresh.`);
  if (invalidRows) issues.push(`${invalidRows} history ${invalidRows === 1 ? 'record had' : 'records had'} an unreadable ID or time.`);
  return {
    profile: { id: user.userId, username: user.username.slice(0, 100), address: typeof user.address === 'string' ? user.address : '' },
    rows: [...rows.values()], fetchedAt: Date.now(), asOf: now, pages,
    complete: complete && issues.length === 0, issues, source: 'pump',
  };
}
