import { detectActiveProfile } from './account.js';
import { SNAPSHOT_CACHE_KEY, validSnapshot } from './cache.js';

export const extensionClient = {
  mode: 'live',
  async readShared(profiles) {
    const response = await chrome.runtime.sendMessage({ type: 'CALLOUT_CACHE', profiles });
    if (!response?.ok) throw new Error(response?.error || 'Shared cache unavailable.');
    return response.snapshot;
  },
  async readSnapshots() {
    const saved = await chrome.storage.local.get(SNAPSHOT_CACHE_KEY);
    return (Array.isArray(saved[SNAPSHOT_CACHE_KEY]) ? saved[SNAPSHOT_CACHE_KEY] : []).filter(validSnapshot);
  },
  subscribeSnapshots(listener) {
    const handler = (changes, area) => {
      if (area !== 'local' || !changes[SNAPSHOT_CACHE_KEY]) return;
      for (const snapshot of changes[SNAPSHOT_CACHE_KEY].newValue || []) if (validSnapshot(snapshot)) listener(snapshot);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
  async read() {
    const { calloutPreferences } = await chrome.storage.local.get('calloutPreferences');
    return calloutPreferences || {};
  },
  async save(preferences) {
    await chrome.storage.local.set({ calloutPreferences: preferences });
  },
  detectProfile() { return detectActiveProfile(chrome.tabs); },
  async loadUpdates(profile, { calloutId } = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'CALLOUT_UPDATES', profile, calloutId });
    if (!response?.ok) throw new Error(response?.error || 'Updates could not be loaded.');
    return response.snapshot;
  },
  async load(profile, { force = false } = {}) {
    let response;
    try { response = await chrome.runtime.sendMessage({ type: 'CALLOUT_LOAD', profile, force }); }
    catch { throw new Error('The extension was updated or disconnected. Reload this tab and try again.'); }
    if (!response?.ok) throw new Error(response?.error || 'Callouts could not be loaded. Try again.');
    return response.snapshot;
  },
};
