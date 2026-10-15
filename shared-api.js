import { parseProfile } from './api.js';
import { validSnapshot } from './cache.js';

export const CACHE_API = 'https://notrandom.fun/callout-stats/v1';

// All network access goes through the shared service. There is no Pump fallback.
export function createSharedClient(fetcher = fetch) {
  async function request(path, body) {
    let response;
    try {
      response = await fetcher(`${CACHE_API}${path}`, {
        method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(120_000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error('Shared cache could not be reached. Try again shortly.'); }
    let data;
    try { data = await response.json(); }
    catch { throw new Error('Shared cache is unavailable. Try again shortly.'); }
    if (!response.ok || !data?.ok) throw new Error(data?.error || `Shared cache returned ${response.status}.`);
    return data;
  }
  return {
    async load(profile) {
      const { snapshot } = await request('/profile', { profile: parseProfile(profile) });
      if (!validSnapshot(snapshot)) throw new Error('Shared cache returned an unreadable profile.');
      return snapshot;
    },
    async loadUpdates(profile, calloutId) {
      if (typeof calloutId !== 'string' || !/^[\w-]{1,128}$/.test(calloutId)) throw new Error('Choose a callout from the loaded history.');
      const { snapshot } = await request('/updates', { profile: parseProfile(profile), calloutId });
      if (!Array.isArray(snapshot?.rows) || !Array.isArray(snapshot.issues)) throw new Error('Shared cache returned unreadable updates.');
      return snapshot;
    },
    async readShared(profiles) {
      if (!Array.isArray(profiles) || !profiles.length || profiles.length > 20) throw new Error('Request 1–20 profiles.');
      const query = new URLSearchParams();
      for (const profile of new Set(profiles.map(parseProfile))) query.append('profile', profile);
      const { snapshots } = await request(`/cache?${query}`);
      if (!Array.isArray(snapshots)) throw new Error('Shared cache returned unreadable profiles.');
      return snapshots.filter(validSnapshot);
    },
  };
}
