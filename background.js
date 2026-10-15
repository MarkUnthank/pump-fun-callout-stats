import { createLoader } from './loader.js';
import { createSharedClient } from './shared-api.js';
import { createSnapshotPublisher } from './cache.js';

const shared = createSharedClient();
const load = createLoader(shared.load);
const publish = createSnapshotPublisher(chrome.storage.local);

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !['CALLOUT_LOAD', 'CALLOUT_UPDATES', 'CALLOUT_CACHE'].includes(message?.type)) return false;
  let request;
  try { request = message.type === 'CALLOUT_CACHE' ? shared.readShared(message.profiles)
    : message.type === 'CALLOUT_UPDATES'
    ? shared.loadUpdates(message.profile, message.calloutId)
    : load(message.profile, { force: message.force === true }); }
  catch (error) { reply({ ok: false, error: error.message }); return false; }
  request.then(
    async (snapshot) => {
      if (message.type === 'CALLOUT_LOAD') await publish(snapshot).catch(() => {});
      if (message.type === 'CALLOUT_CACHE') for (const item of snapshot) await publish(item).catch(() => {});
      reply({ ok: true, snapshot });
    },
    (error) => reply({ ok: false, error: error.message || 'Callouts could not be loaded.' }),
  );
  return true;
});
