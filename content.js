(async () => {
  const id = 'callout-stats-extension';
  if (document.getElementById(id)) return;
  const host = document.createElement('div'); host.id = id; host.dataset.calloutVersion = '0.3.0';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const styleUrl = chrome.runtime.getURL('panel.css');
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = styleUrl;
  const launcher = document.createElement('button'); launcher.type = 'button'; launcher.className = 'launcher';
  const mark = document.createElement('img'); mark.src = chrome.runtime.getURL('mascot.png'); mark.alt = ''; mark.width = 30; mark.height = 30;
  launcher.append(mark, 'My callout stats'); launcher.style.pointerEvents = 'auto';
  const overlay = document.createElement('div'); overlay.className = 'overlay'; overlay.hidden = true;
  overlay.style.pointerEvents = 'auto'; overlay.setAttribute('role', 'region'); overlay.setAttribute('aria-label', 'Callout stats');
  // On phones the overlay is a bottom sheet; tapping the dimmed page behind it closes it.
  const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.hidden = true;
  shadow.append(css, launcher, scrim, overlay); document.documentElement.append(host);
  let mounted;
  let returnFocus = launcher;
  function close() { overlay.hidden = true; scrim.hidden = true; launcher.hidden = false; mounted?.destroy(); mounted = null; returnFocus.focus(); }
  try {
    const [{ mountPanel }, { extensionClient }, { watchFeed }, { waitForOwnProfile }] = await Promise.all([
      import(chrome.runtime.getURL('app.js')), import(chrome.runtime.getURL('extension-client.js')), import(chrome.runtime.getURL('feed.js')), import(chrome.runtime.getURL('account.js')),
    ]);
    const pageClient = { ...extensionClient, detectProfile: () => waitForOwnProfile(document), currentMint: () => location.pathname.match(/^\/coin\/([^/]+)/)?.[1] || '' };
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id || message?.type !== 'CALLOUT_DETECT_ACCOUNT') return false;
      waitForOwnProfile(document).then((profile) => reply({ profile }), () => reply({ profile: '' }));
      return true;
    });
    function openProfile(profile = '', focusTarget = launcher, initialSnapshot = null) {
      mounted?.destroy(); returnFocus = focusTarget;
      overlay.hidden = false; scrim.hidden = false; launcher.hidden = true;
      mounted = mountPanel(overlay, pageClient, { onClose: close, initialProfile: profile, initialSnapshot, inspect: !!profile });
      mounted.focus();
    }
    launcher.addEventListener('click', () => openProfile());
    scrim.addEventListener('click', close);
    shadow.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !overlay.hidden) { event.stopPropagation(); close(); } });
    watchFeed({ client: extensionClient, openProfile, styleUrl: chrome.runtime.getURL('card.css') });
  } catch { launcher.textContent = 'Reload this tab to open Callout stats'; }
})();
