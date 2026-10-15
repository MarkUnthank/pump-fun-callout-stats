import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { detectOwnProfile, waitForOwnProfile, detectActiveProfile } from '../account.js';

const page = (html) => parseHTML(`<html><body>${html}</body></html>`).document;

test('account detection uses the sidebar identity, never a feed author or viewed profile', () => {
  const document = page('<main><a href="/profile/someone-else" aria-label="Open someone’s profile">Other caller</a></main><aside><a data-testid="sidebar-identity" href="/profile/own-wallet" aria-label="@me">Me</a></aside>');
  assert.equal(detectOwnProfile(document), 'own-wallet');
  document.querySelector('[data-testid="sidebar-identity"]').remove();
  assert.equal(detectOwnProfile(document), '');
});

test('account changes are read afresh and ambiguous or foreign identity links are rejected', () => {
  const document = page('<a data-testid="sidebar-identity" href="/profile/first">Me</a>');
  const link = document.querySelector('a');
  assert.equal(detectOwnProfile(document), 'first');
  link.setAttribute('href', '/profile/second'); assert.equal(detectOwnProfile(document), 'second');
  const duplicate = link.cloneNode(true); document.body.append(duplicate);
  assert.equal(detectOwnProfile(document), 'second');
  duplicate.setAttribute('href', '/profile/other'); assert.equal(detectOwnProfile(document), '');
  duplicate.remove(); link.setAttribute('href', 'https://evil.test/profile/first');
  assert.equal(detectOwnProfile(document), '');
});

test('late-rendered sidebar identity is detected and a signed-out page resolves empty', async () => {
  const document = page('');
  const waiting = waitForOwnProfile(document, 1000);
  const link = document.createElement('a'); link.dataset.testid = 'sidebar-identity'; link.href = '/profile/hydrated';
  document.body.append(link);
  assert.equal(await waiting, 'hydrated');
  assert.equal(await waitForOwnProfile(page(''), 5), '');
});

test('popup asks only the active tab and safely falls back outside Pump', async () => {
  const tabs = {
    query: async (query) => { assert.deepEqual(query, { active: true, currentWindow: true }); return [{ id: 7 }, { id: 9 }]; },
    sendMessage: async (id, message) => { assert.equal(id, 7); assert.deepEqual(message, { type: 'CALLOUT_DETECT_ACCOUNT' }); return { profile: 'my-wallet' }; },
  };
  assert.equal(await detectActiveProfile(tabs), 'my-wallet');
  assert.equal(await detectActiveProfile({ ...tabs, sendMessage: async () => { throw new Error('No content script'); } }), '');
  assert.equal(await detectActiveProfile({ ...tabs, sendMessage: async () => ({ profile: 'bad/value' }) }), '');
  assert.equal(await detectActiveProfile(undefined), '');
});
