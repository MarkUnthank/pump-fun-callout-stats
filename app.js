import { localZone, validZone, summarize, summarizeRolling, money, multiple, STALE_AFTER_MS, PERIODS, periodBounds, dayKey } from './stats.js';
import { validSnapshot, snapshotMatches } from './cache.js';
import { tone } from './tone.js';

const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
};
const asset = (path) => new URL(path, import.meta.url).href;

// The overlay renders inside Pump's page, where a shadow root can't declare fonts.
// Registering Fredoka on the document under our own name reaches the panel and the popup.
let fontsRequested = false;
function loadFonts() {
  if (fontsRequested || typeof FontFace !== 'function' || !globalThis.document?.fonts) return;
  fontsRequested = true;
  const face = new FontFace('notrandom Fredoka', `url(${asset('fonts/fredoka.woff2')}) format('woff2')`, { weight: '300 700', display: 'swap' });
  document.fonts.add(face);
  face.load().catch(() => {});
}

export function mountPanel(root, client, { onClose, initialProfile = '', initialSnapshot = null, inspect = false } = {}) {
  const state = { profile: initialProfile, period: inspect ? 'month' : 'today', zone: localZone(), snapshot: null, request: 0, visible: 20 };
  loadFonts();
  root.innerHTML = `
    <section class="panel" aria-labelledby="callout-stats-title">
      <header class="panel-head">
        <img class="mark" src="${asset('mascot.png')}" alt="" width="36" height="36">
        <div class="panel-title">
          <h2 id="callout-stats-title">Callout stats</h2>
          <p>by notrandom.fun <small>v0.3.0</small></p>
        </div>
        <button type="button" class="icon-btn" data-close hidden aria-label="Close">${ICON.close}</button>
      </header>
      <form class="lookup">
        <fieldset><legend class="eyebrow">Profile</legend>
          <p class="hint" data-account></p>
          <label class="field-label" for="callout-profile">Pump username, address or profile URL</label>
          <div class="field-row">
            <input id="callout-profile" name="profile" type="text" required maxlength="256" autocomplete="off" spellcheck="false" placeholder="@username or wallet">
            <button type="submit" class="btn btn-primary">Load</button>
          </div>
        </fieldset>
      </form>
      <p class="status" role="status" aria-live="polite"></p>
      <section class="results" data-results hidden aria-label="Loaded profile">
        <header class="profile">
          <div>
            <h3><a data-profile target="_blank" rel="noopener noreferrer"></a></h3>
            <p><small data-updated></small></p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-refresh>${ICON.refresh}Refresh</button>
        </header>
        <table class="perf">
          <caption class="eyebrow">Callout performance</caption>
          <thead><tr><th scope="col"><span class="sr">Metric</span></th><th scope="col">24h</th><th scope="col">7d</th><th scope="col">30d</th></tr></thead>
          <tbody data-summary></tbody>
        </table>
        <p class="note"><small>Rolling periods. Fractions show calls with available quotes.</small></p>
        <p class="note warn" data-coverage></p>
        <details class="fold">
          <summary>Callout history and updates ${ICON.chevron}</summary>
          <div class="fold-body">
            <fieldset class="filters"><legend class="sr">History filters</legend>
              <label>Period <select data-period><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">7 days</option><option value="month">30 days</option></select></label>
              <label>Timezone <select data-zone></select></label>
              <p class="note" data-period-note></p>
            </fieldset>
            <table class="history" data-history><caption class="sr">Original callouts</caption><thead><tr><th scope="col">Token / time</th><th scope="col">Entry cap</th><th scope="col">Current</th><th scope="col">Peak</th></tr></thead><tbody></tbody></table>
            <p class="empty" data-empty hidden>No calls in this period.</p>
            <p><button type="button" class="btn btn-ghost btn-sm btn-block" data-more hidden>Show more</button></p>
            <section class="updates" aria-label="Callout updates">
              <h3>Callout updates</h3>
              <p class="note">Updates are listed by posting time and excluded from this extension’s call count and averages. This is not Pump’s reward formula.</p>
              <div class="field-row">
                <label><span class="sr">Callout</span><select data-update-callout></select></label>
                <button type="button" class="btn btn-ghost" data-load-updates>Load updates</button>
              </div>
              <p class="note" data-update-status aria-live="polite"></p><section data-updates aria-label="Logged updates"></section>
            </section>
          </div>
        </details>
        <details class="fold"><summary>Calculations ${ICON.chevron}</summary>
          <div class="fold-body">
            <p>Entry cap is the USD market cap at the callout. Current and peak multiples come from Pump’s public feed. Each spot token call has equal weight, including losses. Missing values are excluded from that average. These are price moves, not realized returns or reward predictions.</p>
            <p>Performance covers the last 24, 168 and 720 hours, independently of timezone. History filters use calendar days in the selected timezone: Today and Yesterday cover one day; 7 and 30 days include today plus the previous 6 or 29 days. All multiples are measured at the latest refresh, not the end of the selected period.</p>
          </div>
        </details>
      </section>
    </section>`;
  const $ = (selector) => root.querySelector(selector);
  const input = $('input');
  let activity = null;
  let activityStatus = '';
  let updatesLoading = false;
  let loading = false;
  let initializing = true;
  let error = '';
  let destroyed = false;
  let focusRequested = false;
  function save() {
    if (inspect) return;
    void client.save({ profile: state.profile, period: state.period, zone: state.zone }).catch(() => {
      error = 'Preferences could not be saved.'; render();
    });
  }
  function render() {
    if (destroyed) return;
    const snapshot = state.snapshot;
    const now = Date.now();
    $('button[type="submit"]').disabled = loading || initializing || updatesLoading;
    input.disabled = initializing;
    $('[data-refresh]').disabled = loading || updatesLoading;
    $('[data-load-updates]').disabled = loading || updatesLoading || !snapshot?.rows.length;
    $('[data-results]').hidden = !snapshot;
    let status = error;
    if (!status && initializing) status = inspect ? 'Loading profile…' : 'Checking your Pump account…';
    if (!status && loading) status = 'Loading callout history…';
    if (!status && snapshot?.cache?.warning) status = `${snapshot.cache.warning} Showing the saved snapshot.`;
    if (!status && snapshot && !snapshot.complete) status = `Partial history: ${snapshot.issues.join(' ')} Counts and averages cover retrieved calls only.`;
    if (!status && snapshot && now - snapshot.fetchedAt >= STALE_AFTER_MS) status = 'Snapshot is over 5 minutes old. Refresh for current data.';
    $('[role="status"]').textContent = status;
    $('[role="status"]').dataset.tone = error ? 'error' : initializing || loading ? 'busy' : status ? 'warn' : '';
    $('[data-update-status]').textContent = activityStatus;
    $('[data-updates]').replaceChildren();
    if (!snapshot) return;
    const stats = summarize(snapshot.rows, state.period, now, state.zone);
    if (activity) {
      const {first,last} = periodBounds(state.period, now, state.zone);
      const updates = activity.rows.filter(row => {const day=dayKey(row.createdAt,state.zone); return day>=first && day<=last;});
      const heading = document.createElement('h4'); heading.textContent = `Updates logged in this period: ${updates.length}`;
      const note = document.createElement('p'); note.textContent = `Updates loaded for selected callouts only. Updates are excluded from the call count and averages. ${activity.issues.join(' ')}`;
      note.className = 'note';
      const list = document.createElement('ul');
      for (const update of updates.slice(0,100)) {
        const item = document.createElement('li');
        const link = document.createElement('a'); link.href = `https://pump.fun/coin/${encodeURIComponent(update.mint)}?highlight_callout=${encodeURIComponent(update.calloutId)}`;
        link.target='_blank'; link.rel='noopener noreferrer'; link.className = 'mono'; link.textContent = update.mint.slice(0,5)+'…'+update.mint.slice(-4);
        const time = document.createElement('time'); time.dateTime = new Date(update.createdAt).toISOString(); time.textContent = ` · ${new Date(update.createdAt).toLocaleString('en',{timeZone:state.zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
        const text = document.createElement('p'); text.textContent = update.text;
        item.append(link, time, text); list.append(item);
      }
      if (updates.length>100) note.append(' Showing the latest 100 updates.');
      $('[data-updates]').append(heading,note,list);
    }
    $('[data-profile]').textContent = `@${snapshot.profile.username}`;
    $('[data-profile]').href = `https://pump.fun/profile/${encodeURIComponent(snapshot.profile.id)}`;
    $('[data-updated]').textContent = `Updated ${new Date(snapshot.fetchedAt).toLocaleString('en', { timeZone: state.zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${snapshot.cache ? ' · Shared cache · refreshes at most once per 5 minutes' : ''}`;
    $('[data-period-note]').textContent = state.period === 'today' ? `Since midnight (${state.zone})`
      : state.period === 'yesterday' ? `Calls made yesterday (${state.zone}); multiples as of the latest refresh`
      : `Today + the previous ${state.period === 'week' ? 6 : 29} days (${state.zone})`;
    const windows = [24, 168, 720].map(hours => summarizeRolling(snapshot.rows, hours * 3_600_000, now));
    const summaryRows = [
      ['New callouts', value => [`${value.count}${snapshot.complete ? '' : '+'}`]],
      ['Average entry cap', value => [money(value.entry), `${value.entryN}/${value.count}`]],
      ['Average current multiple', value => [multiple(value.current), `${value.currentN}/${value.count}`, tone(value.current)]],
      ['Median current multiple', value => [multiple(value.median), `${value.currentN}/${value.count}`, tone(value.median)]],
      ['Average peak multiple', value => [multiple(value.peak), `${value.peakN}/${value.count}`]],
    ];
    if (windows.some(value => value.excluded)) summaryRows.push(['Non-token calls excluded', value => [`${value.excluded}`]]);
    $('[data-summary]').replaceChildren(...summaryRows.map(([name, format]) => {
      const row = document.createElement('tr');
      const label = document.createElement('th'); label.scope = 'row'; label.textContent = name;
      row.append(label);
      for (const stats of windows) {
        const [value, coverage, change] = format(stats);
        const cell = document.createElement('td'); const strong = document.createElement('strong'); strong.textContent = value; cell.append(strong);
        if (change) strong.className = change;
        if (coverage) {
          const sample = document.createElement('small'); sample.textContent = coverage;
          cell.append(sample);
        }
        row.append(cell);
      }
      return row;
    }));
    $('[data-coverage]').textContent = windows.some(value => value.currentN < value.count || value.entryN < value.count || value.peakN < value.count)
      ? 'Some quotes are missing; see the fractions above.' : '';
    $('[data-history]').hidden = !stats.count;
    $('[data-empty]').hidden = !!stats.count;
    $('[data-empty]').textContent = snapshot.complete ? 'No calls in this period.' : 'No calls retrieved for this period. History is incomplete.';
    $('[data-more]').hidden = state.visible >= stats.count;
    const formatter = new Intl.DateTimeFormat('en', { timeZone: state.zone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    $('[data-history] tbody').replaceChildren(...stats.calls.slice(0, state.visible).map((call) => {
      const row = document.createElement('tr');
      const token = document.createElement('td');
      const link = document.createElement('a');
      link.textContent = call.mint.length > 12 ? `${call.mint.slice(0, 5)}…${call.mint.slice(-4)}` : call.mint || 'Unknown';
      link.title = call.mint;
      if (/^[A-Za-z0-9_-]{1,128}$/.test(call.mint)) link.href = `https://pump.fun/coin/${encodeURIComponent(call.mint)}`;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'mono';
      const time = document.createElement('time'); time.dateTime = new Date(call.createdAt).toISOString(); time.textContent = formatter.format(call.createdAt);
      token.append(link, time); row.append(token);
      for (const [value, change] of [[money(call.entryCap)], [multiple(call.current), tone(call.current)], [multiple(call.peak)]]) {
        const cell = document.createElement('td'); cell.textContent = value; if (change) cell.className = change; row.append(cell);
      }
      return row;
    }));
  }
  function showSnapshot(snapshot) {
    state.snapshot = snapshot; state.visible = 20;
    const selector = $('[data-update-callout]');
    selector.replaceChildren(...snapshot.rows.filter(row => row.supported).map(call => {
      const option = document.createElement('option'); option.value=call.id;
      option.textContent=`${call.mint.slice(0,5)}…${call.mint.slice(-4)} · ${new Date(call.createdAt).toLocaleDateString('en',{timeZone:state.zone})}`;
      return option;
    }));
    const current = snapshot.rows.find(call => call.mint === client.currentMint?.());
    if (current) selector.value = current.id;
  }
  async function load(profile, force = false) {
    if (destroyed || !profile.trim()) return;
    const request = ++state.request;
    loading = true; error = ''; activity=null; activityStatus=''; render();
    try {
      const snapshot = await client.load(profile, { force });
      if (request !== state.request) return;
      showSnapshot(snapshot); state.profile = profile; save();
    } catch (cause) {
      if (request !== state.request) return;
      error = `${cause.message || 'Callouts could not be loaded.'}${state.snapshot ? ` Showing the previous snapshot for @${state.snapshot.profile.username}.` : ''}`;
    } finally { if (request === state.request) { loading = false; render(); } }
  }
  $('form').addEventListener('submit', (event) => {
    event.preventDefault(); if (initializing) return;
    if (input.value.trim() !== state.profile) $('[data-account]').textContent = 'Manually selected profile.';
    void load(input.value, true);
  });
  $('[data-load-updates]').addEventListener('click', async () => {
    const calloutId = $('[data-update-callout]').value;
    if (!calloutId || updatesLoading || loading) return;
    const request = state.request;
    updatesLoading=true; activityStatus='Loading updates for the selected callout…'; render();
    try {
      const value=await client.loadUpdates(state.profile,{calloutId});
      if (destroyed || request !== state.request) return;
      const previous=activity?.rows.filter(row=>row.calloutId!==calloutId) || [];
      activity={...value, issues:[...new Set([...(activity?.issues || []),...value.issues])], rows:[...previous,...value.rows].sort((a,b)=>b.createdAt-a.createdAt)};
      activityStatus=value.cache?.warning || '';
    } catch { activityStatus='Updates could not be loaded. Try again later.'; }
    finally { updatesLoading=false; if (!destroyed) render(); }
  });
  $('[data-refresh]').addEventListener('click', () => { void load(state.profile, true); });
  $('[data-period]').addEventListener('change', (event) => { state.period = event.target.value; state.visible = 20; render(); save(); });
  $('[data-zone]').addEventListener('change', (event) => { state.zone = event.target.value; render(); save(); });
  $('[data-more]').addEventListener('click', () => { state.visible += 20; render(); });
  if (onClose) { $('[data-close]').hidden = false; $('[data-close]').addEventListener('click', onClose); }
  render();
  const ready = (async () => {
    const [saved, account, cached] = await Promise.allSettled([
      client.read(), inspect ? Promise.resolve('') : Promise.resolve().then(() => client.detectProfile?.() || ''),
      Promise.resolve().then(() => client.readSnapshots?.() || []),
    ]);
    if (destroyed) return;
    const preferences = saved.status === 'fulfilled' ? saved.value || {} : {};
    const detected = account.status === 'fulfilled' && typeof account.value === 'string' ? account.value : '';
    state.profile = initialProfile || detected || (typeof preferences.profile === 'string' ? preferences.profile : '');
    if (!inspect && Object.hasOwn(PERIODS, preferences.period)) state.period = preferences.period;
    if (validZone(preferences.zone)) state.zone = preferences.zone;
    $('[data-account]').textContent = inspect ? '' : detected ? 'Your Pump account was detected.'
      : state.profile ? 'Saved profile. Your Pump account could not be detected on this tab.'
      : 'Your Pump account could not be detected. Enter a profile below.';
    initializing = false;
    for (const zone of new Set([localZone(), 'UTC', state.zone])) {
      const option = document.createElement('option'); option.value = zone; option.textContent = zone; $('[data-zone]').append(option);
    }
    $('[data-period]').value = state.period; $('[data-zone]').value = state.zone; input.value = state.profile;
    const snapshots = [initialSnapshot, ...(cached.status === 'fulfilled' && Array.isArray(cached.value) ? cached.value : [])];
    const snapshot = snapshots.filter(validSnapshot).filter(value => snapshotMatches(value, state.profile)).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    if (snapshot) showSnapshot(snapshot);
    render(); if (focusRequested) input.focus();
    if (inspect && state.profile && !state.snapshot) await load(state.profile);
  })();
  const timer = setInterval(() => {
    if (!$('[data-history]').contains(root.getRootNode().activeElement || document.activeElement)) render();
  }, 60_000);
  return { ready, focus: () => { focusRequested = true; if (!initializing) input.focus(); }, destroy: () => { destroyed = true; clearInterval(timer); state.request++; root.replaceChildren(); } };
}
