import { loadProfile, parseProfile } from './api.js';
import { STALE_AFTER_MS } from './stats.js';

// Bound feed lookups, share concurrent requests and keep a small in-memory cache.
export function createLoader(load = loadProfile, clock = Date.now) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;
  function drain() {
    while (active < 2 && queue.length) {
      const job = queue.shift(); active++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }
  function get(profile, { force = false } = {}) {
    const key = parseProfile(profile);
    if (pending.has(key)) return pending.get(key);
    const saved = cache.get(key);
    if (!force && saved && clock() - saved.fetchedAt < STALE_AFTER_MS) return Promise.resolve(saved);
    const promise = new Promise((resolve, reject) => {
      queue.push({ run: () => load(key), resolve, reject }); drain();
    }).then((snapshot) => {
      cache.delete(key); cache.set(key, snapshot);
      if (cache.size > 20) cache.delete(cache.keys().next().value);
      return snapshot;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  get.peek = profile => cache.get(parseProfile(profile));
  return get;
}
