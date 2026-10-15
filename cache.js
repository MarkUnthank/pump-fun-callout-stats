export const SNAPSHOT_CACHE_KEY = 'calloutSnapshots';
export const SNAPSHOT_CACHE_LIMIT = 20;

export function validSnapshot(snapshot) {
  return typeof snapshot?.profile?.id === 'string' && typeof snapshot.profile.username === 'string'
    && Array.isArray(snapshot.rows) && Number.isFinite(snapshot.fetchedAt);
}

export function snapshotMatches(snapshot, profile) {
  return snapshot.profile.id === profile || snapshot.profile.address === profile
    || snapshot.profile.username.toLowerCase() === profile.toLowerCase();
}

export function mergeSnapshots(previous, incoming) {
  const unique = new Map();
  for (const snapshot of [incoming, ...(Array.isArray(previous) ? previous : [])].filter(validSnapshot).sort((a,b) => b.fetchedAt-a.fetchedAt)) {
    if (!unique.has(snapshot.profile.id)) unique.set(snapshot.profile.id, snapshot);
  }
  return [...unique.values()].slice(0, SNAPSHOT_CACHE_LIMIT);
}

// Serialize read/modify/write so parallel profile loads cannot erase each other.
export function createSnapshotPublisher(storage) {
  let tail = Promise.resolve();
  return snapshot => {
    const job = tail.then(async () => {
      const saved = await storage.get(SNAPSHOT_CACHE_KEY);
      await storage.set({[SNAPSHOT_CACHE_KEY]:mergeSnapshots(saved[SNAPSHOT_CACHE_KEY],snapshot)});
    });
    tail = job.catch(() => {});
    return job;
  };
}
