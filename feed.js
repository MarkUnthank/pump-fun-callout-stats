import { validSnapshot, snapshotMatches } from './cache.js';
import { summarizeRolling, money, multiple, STALE_AFTER_MS } from './stats.js';
import { tone } from './tone.js';

const WINDOWS = [['24h', 24], ['7d', 7 * 24], ['30d', 30 * 24]];

// Observed in Pump's public CalloutFeedCard component on 2026-10-15.
export const CARD_SELECTOR = ['feed-callout-card', 'coin-callouts-feed-card', 'coin-callouts-viewer-callout', 'pnl-viewer-callout', 'callout-detail-card'].map(id => `[data-testid="${id}"]`).join(',');

export function profileFromLink(href) {
  try {
    const url = new URL(href, 'https://pump.fun');
    if (url.origin !== 'https://pump.fun' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/profile\/([^/]+)\/?$/);
    const profile = match ? decodeURIComponent(match[1]) : '';
    return /^[A-Za-z0-9_-]{1,100}$/.test(profile) ? profile : null;
  } catch { return null; }
}

export function callerFromCard(card) {
  // Pump puts the full-card coin link before the author's avatar link.
  for (const link of card.querySelectorAll('a[aria-label^="Open "][href]')) {
    if (link.closest(CARD_SELECTOR) !== card) continue;
    const profile = profileFromLink(link.getAttribute('href'));
    if (profile) return profile;
  }
  return null;
}

export function describeCaller(snapshot, now = Date.now()) {
  const windows = WINDOWS.map(([period, hours]) => {
    const stats = summarizeRolling(snapshot.rows, hours * 3_600_000, now);
    const count = `${stats.count}${snapshot.complete ? '' : '+'}`;
    const parts = [
      { text: period, title: `Last ${hours} hours (rolling window)` },
      { text: count, title: `${count} token callouts${snapshot.complete ? '' : ' retrieved; history is incomplete'}` },
      { text: money(stats.entry), title: `Average entry market cap in USD: ${money(stats.entry)} (${stats.entryN}/${stats.count} calls)` },
      { text: multiple(stats.current), title: `Average current multiple: ${multiple(stats.current)} (${stats.currentN}/${stats.count} calls)`, tone: tone(stats.current) },
    ];
    return { period, parts, title: `${parts.map(part => part.title).join('. ')}. Median ${multiple(stats.median)}; average peak ${multiple(stats.peak)}.` };
  });
  const title = `${snapshot.complete ? '' : 'Partial history. '}${windows.map(window => window.title).join(' ')} Multiples as of ${new Date(snapshot.fetchedAt).toLocaleString()}. Click for details.`;
  return { windows, title, fetchedAt: snapshot.fetchedAt, snapshot };
}

const ICONS = {
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

function icon(name) {
  const span = document.createElement('span'); span.className = 'icon'; span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A header that shortens when the card is narrow.
function label(wide, narrow) {
  const cell = element('span', 'num');
  cell.append(element('span', 'wide', wide), element('span', 'narrow', narrow));
  return cell;
}

// Stats sit under the caller's position card, above Pump's action row, like part of the card.
// Cards without a position take them under the note; anything unrecognised gets them on top.
export function place(card, host) {
  const own = selector => [...card.querySelectorAll(selector)].find(node => node.closest(CARD_SELECTOR) === card);
  const anchor = own('[data-testid="callout-position-mini-card"]') || own('[data-testid="callout-note"]');
  if (anchor) anchor.after(host);
  else { host.style.marginBottom = '8px'; card.prepend(host); }
}

export function watchFeed({ root = document, client, openProfile, styleUrl }) {
  const cards = new Map();
  const lookups = new Map();
  const snapshots = new Map();
  let scheduled;
  let sharedTimer;
  let sharedBusy = false;
  let sharedPaused = false;
  const sharedChecked = new Set();
  const sharedQueue = new Set();
  let stopped = false;
  function queueShared(profile) {
    if (!client.readShared || sharedPaused || sharedChecked.has(profile) || sharedChecked.size >= 500) return;
    sharedChecked.add(profile); sharedQueue.add(profile);
    if (!sharedTimer && !sharedBusy) sharedTimer = setTimeout(readShared, 200);
  }
  async function readShared() {
    sharedTimer = undefined;
    if (stopped || sharedPaused || !sharedQueue.size) return;
    sharedBusy = true;
    const profiles = [...sharedQueue].slice(0, 20);
    profiles.forEach(profile => sharedQueue.delete(profile));
    try { for (const snapshot of await client.readShared(profiles)) applySnapshot(snapshot); }
    // Cache errors leave manual controls usable. No automatic retries or Pump fallback.
    catch { sharedPaused = true; sharedQueue.clear(); }
    finally {
      sharedBusy = false;
      if (!stopped && sharedQueue.size) sharedTimer = setTimeout(readShared, 1000);
    }
  }
  function author(card) {
    // Use the author's avatar link, not mentions or a quoted caller in the text.
    return callerFromCard(card);
  }
  function cached(profile) {
    const values = [...snapshots.values()];
    return values.find(snapshot => snapshot.profile.id === profile || snapshot.profile.address === profile)
      || values.find(snapshot => snapshotMatches(snapshot, profile));
  }
  function applySnapshot(snapshot) {
    if (stopped || !validSnapshot(snapshot)) return;
    const previous = snapshots.get(snapshot.profile.id);
    if (previous && previous.fetchedAt >= snapshot.fetchedAt) return;
    snapshots.delete(snapshot.profile.id); snapshots.set(snapshot.profile.id, snapshot);
    if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value);
    const data = describeCaller(snapshot);
    for (const entry of cards.values()) if (snapshotMatches(snapshot, entry.profile)) {
      entry.data = data; renderStats(entry);
    }
  }
  function lookup(profile, force = false) {
    const old = lookups.get(profile);
    if (!force && old && Date.now() - old.time < STALE_AFTER_MS) return old.promise;
    const promise = client.load(profile, { force }).then((snapshot) => { applySnapshot(snapshot); return describeCaller(cached(profile) || snapshot); }).catch((error) => { lookups.delete(profile); throw error; });
    lookups.delete(profile); lookups.set(profile, { promise, time: Date.now() });
    if (lookups.size > 50) lookups.delete(lookups.keys().next().value);
    return promise;
  }
  function renderStats(entry) {
    const stale = Date.now() - entry.data.fetchedAt >= STALE_AFTER_MS;
    // One grid, Pump's own table style: a quiet header, then a row per window.
    const grid = element('span', 'grid');
    const head = element('span', 'row head'); head.setAttribute('aria-hidden', 'true');
    const lead = element('span', `lead${stale ? ' stale' : ''}`); lead.append(icon(stale ? 'clock' : 'chart'));
    if (stale) lead.title = 'Over 5 minutes old. Use reload to refresh.';
    head.append(lead, element('span', 'num', 'Calls'), label('Avg entry MC', 'Entry MC'), label('Avg multiple', 'Avg ×'));
    grid.append(head);
    for (const window of entry.data.windows) {
      const row = element('span', 'row'); row.dataset.period = window.period;
      window.parts.forEach((part, index) => {
        const cell = element('span', index ? `num${part.tone ? ` ${part.tone}` : ''}` : 'period', part.text);
        cell.title = `${window.period}: ${part.title}`; row.append(cell);
      });
      grid.append(row);
    }
    entry.refresh.hidden = false;
    entry.button.dataset.state = 'ready'; entry.button.removeAttribute('aria-busy');
    entry.button.replaceChildren(grid);
    entry.button.title = `${stale ? 'Over 5 minutes old. Use reload to refresh. ' : ''}${entry.data.title}`;
    entry.button.setAttribute('aria-label', `Callout stats for ${entry.profile}. ${entry.button.title}`);
  }
  // Before stats arrive the button is one quiet line: Load, Loading or Retry.
  function bar(entry, state, text, action, note = '') {
    entry.button.dataset.state = state;
    entry.button.toggleAttribute('aria-busy', state === 'loading');
    entry.button.replaceChildren(icon(state === 'error' ? 'alert' : 'chart'), element('span', 'bar-label', text), element('span', 'bar-note', note), element('span', 'bar-action', action));
  }
  async function populate(entry, force = false) {
    if (entry.loading) return;
    entry.loading = true;
    entry.refresh.disabled = true; entry.refresh.setAttribute('aria-busy', 'true');
    if (!entry.data) {
      bar(entry, 'loading', 'Caller stats', 'Loading…'); entry.button.title = 'Loading caller stats…';
      entry.button.setAttribute('aria-label', `Loading callout stats for ${entry.profile}`);
    }
    try {
      const data = await lookup(entry.profile, force);
      if (stopped || cards.get(entry.card) !== entry) return;
      entry.data = data; renderStats(entry);
      entry.refresh.removeAttribute('data-reason');
      entry.refresh.title = 'Reload cached stats. Shared data refreshes at most once per 5 minutes.';
      entry.refresh.setAttribute('aria-label', `Reload callout stats for ${entry.profile}`);
    } catch (error) {
      if (stopped || cards.get(entry.card) !== entry) return;
      const limited = /limiting requests/.test(error.message);
      if (entry.data) {
        entry.refresh.dataset.reason = 'error';
        entry.refresh.title = `Refresh failed. ${error.message} Showing saved stats. Click to retry.`;
        entry.refresh.setAttribute('aria-label', `Retry refreshing callout stats for ${entry.profile}. ${error.message}`);
        return;
      }
      bar(entry, 'error', limited ? 'Pump is busy' : 'Stats unavailable', 'Retry');
      entry.button.dataset.reason = limited ? 'limited' : 'error'; entry.button.title = `Caller stats unavailable. ${error.message} Click to retry.`;
      entry.button.setAttribute('aria-label', `Retry callout stats for ${entry.profile}. ${error.message}`);
    } finally { entry.loading = false; entry.refresh.disabled = false; entry.refresh.removeAttribute('aria-busy'); }
  }
  function scan() {
    for (const [card, entry] of cards) {
      if (!card.isConnected || !root.contains(card) || author(card) !== entry.profile || !entry.host.isConnected) {
        entry.host.remove(); cards.delete(card);
      }
    }
    for (const card of root.querySelectorAll(CARD_SELECTOR)) {
      if (cards.has(card)) continue;
      const profile = author(card);
      if (!profile) continue;
      const host = document.createElement('div');
      host.dataset.calloutAuthorStats = '';
      // Pump's card body turns pointer events off for everything but its own links and buttons.
      host.style.cssText = 'display:block;position:relative;z-index:3;width:100%;pointer-events:auto;';
      const shadow = host.attachShadow({ mode: 'open' });
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = styleUrl;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'caller-stats'; button.title = 'Click to load all three windows from one cached history';
      button.setAttribute('aria-label', `Callout stats for ${profile}`);
      const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'reload-stats'; refresh.hidden = true;
      refresh.setAttribute('aria-label', `Reload callout stats for ${profile}`);
      refresh.title = 'Reload cached stats. Shared data refreshes at most once per 5 minutes.'; refresh.append(icon('refresh'));
      const controls = document.createElement('div'); controls.className = 'stats-controls'; controls.append(button, refresh);
      const entry = { card, profile, host, button, refresh, loading: false, data: null };
      bar(entry, 'idle', 'Caller stats', 'Load', '24h · 7d · 30d');
      button.addEventListener('click', () => { if (entry.data) openProfile(profile, button, entry.data.snapshot); else void populate(entry); });
      refresh.addEventListener('click', () => { void populate(entry, true); });
      // Pump cards are clickable. Inspecting stats must not navigate or trade.
      for (const type of ['click', 'pointerdown', 'keydown', 'keyup']) host.addEventListener(type, (event) => {
        event.stopPropagation(); if (type === 'click') event.preventDefault();
      });
      shadow.append(css, controls); place(card, host); cards.set(card, entry);
      const saved = cached(profile);
      if (saved) { entry.data = describeCaller(saved); renderStats(entry); }
      queueShared(profile);
    }
  }
  const observer = new MutationObserver(() => {
    if (!scheduled) scheduled = setTimeout(() => { scheduled = undefined; scan(); }, 100);
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'aria-label'] });
  scan();
  const unsubscribe = client.subscribeSnapshots?.(applySnapshot);
  void client.readSnapshots?.().then(values => { for (const value of values) applySnapshot(value); }).catch(() => {});
  const timer = setInterval(() => {
    for (const entry of cards.values()) {
      if (entry.data) { entry.data = describeCaller(entry.data.snapshot); renderStats(entry); }
    }
  }, 60_000);
  return () => {
    stopped = true; unsubscribe?.(); observer.disconnect(); clearTimeout(scheduled); clearTimeout(sharedTimer); clearInterval(timer);
    for (const entry of cards.values()) entry.host.remove(); cards.clear();
  };
}
