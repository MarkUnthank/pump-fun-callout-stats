import { getJson } from './api.js';

// Updates have their own time and ID; they never become new price observations.
export async function loadUpdates(snapshot, { fetcher = fetch } = {}) {
  const calls = snapshot.rows.filter(row => row.supported).sort((a,b) => b.createdAt-a.createdAt);
  const queue = calls.slice(0, 1);
  const rows = new Map();
  const issues = [];
  let checked = 0;
  const started = Date.now();
  await Promise.all(Array.from({length: 2}, async () => {
    while (queue.length) {
      if (Date.now() - started > 40_000) {
        issues.push('The update scan reached its time limit.'); queue.length = 0; break;
      }
      const call = queue.shift();
      try {
        const data = await getJson(`https://frontend-api-v3.pump.fun/callout/${encodeURIComponent(call.id)}/replies?limit=200&filter=AUTHOR_ONLY`, fetcher);
        if (!Array.isArray(data.replies)) throw new Error('Pump returned an unreadable update list.');
        checked++;
        if (data.replies.length >= 200) issues.push('A callout reached the 200-update limit.');
        for (const raw of data.replies) {
          if (raw.tombstone || raw.parentMessageId || raw.rootMessageId) continue;
          if (raw.userId !== snapshot.profile.id && (!snapshot.profile.address || raw.walletAddress !== snapshot.profile.address)) continue;
          const createdAt = Date.parse(raw.createdAt);
          if (typeof raw.id !== 'string' || !/^[\w-]{1,128}$/.test(raw.id) || !Number.isFinite(createdAt) || createdAt > Date.now()) continue;
          rows.set(raw.id, {id:raw.id, calloutId:call.id, mint:call.mint, createdAt, text:typeof raw.content === 'string' ? raw.content.slice(0,4000) : ''});
        }
      } catch (error) {
        issues.push('Some callout updates could not be loaded.');
        if (error.message.includes('limiting requests')) { queue.length = 0; issues.push(error.message); }
      }
    }
  }));
  if (calls.length > 1) issues.push('Only the selected callout was checked.');
  return {rows:[...rows.values()].sort((a,b) => b.createdAt-a.createdAt), checked, issues:[...new Set(issues)], fetchedAt:Date.now()};
}
