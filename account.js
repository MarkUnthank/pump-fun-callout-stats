import { profileFromLink } from './feed.js';

// Pump's SidebarIdentity uses the signed-in profile (public frontend, 2026-10-15).
// Never infer the viewer from the page URL, a feed author, or a mentioned profile.
export function detectOwnProfile(root) {
  const profiles = new Set([...root.querySelectorAll('a[data-testid="sidebar-identity"][href]')]
    .map((link) => profileFromLink(link.getAttribute('href'))).filter(Boolean));
  return profiles.size === 1 ? [...profiles][0] : '';
}

export function waitForOwnProfile(root, timeoutMs = 2000) {
  const profile = detectOwnProfile(root);
  if (profile) return Promise.resolve(profile);
  return new Promise((resolve) => {
    const observer = new root.defaultView.MutationObserver(() => {
      const found = detectOwnProfile(root);
      if (found) finish(found);
    });
    const timer = setTimeout(() => finish(''), timeoutMs);
    function finish(value) { observer.disconnect(); clearTimeout(timer); resolve(value); }
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'data-testid'] });
  });
}

export async function detectActiveProfile(tabs) {
  if (!tabs) return '';
  try {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) return '';
    const response = await tabs.sendMessage(tab.id, { type: 'CALLOUT_DETECT_ACCOUNT' });
    return typeof response?.profile === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(response.profile) ? response.profile : '';
  } catch { return ''; } // Non-Pump tabs, missing permission, or a tab needing reload.
}
