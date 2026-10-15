import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { describeCaller, callerFromCard } from '../feed.js';

// Each window is a row of cells: period, calls, average entry cap, average multiple.
const rows = button => [...button.querySelectorAll('[data-period]')].map(row => [...row.children].map(cell => cell.textContent).join(' · '));
const calls = (button, index = 0) => button.querySelectorAll('[data-period]')[index]?.children[1]?.textContent;

test('caller detection skips the coin link and nested quoted callers in the live Pump card structure', () => {
  const { document } = parseHTML(`<article data-testid="feed-callout-card">
    <a href="/coin/token?highlight_callout=call" aria-label="Open caller's callout"></a>
    <article data-testid="feed-callout-card"><a href="/profile/quoted" aria-label="Open quoted's profile"></a></article>
    <a href="/profile/caller-wallet" aria-label="Open caller's profile"></a>
  </article>`);
  const card = document.querySelector('article');
  assert.equal(callerFromCard(card), 'caller-wallet');
  card.querySelector('a[href="/profile/caller-wallet"]').remove();
  assert.equal(callerFromCard(card), null);
});

const now = Date.parse('2026-10-15T12:00:00Z');
test('one snapshot produces different counts and averages for all three rolling windows', () => {
  const snapshot = { complete: true, fetchedAt: now, rows: [
    { id: 'recent', supported: true, createdAt: now - 3_600_000, entryCap: 100, current: .5, peak: 2 },
    { id: 'week', supported: true, createdAt: now - 2 * 86_400_000, entryCap: 200, current: 1.5, peak: 3 },
    { id: 'month', supported: true, createdAt: now - 20 * 86_400_000, entryCap: 300, current: 4, peak: 5 },
  ] };
  assert.deepEqual(describeCaller(snapshot, now).windows.map(window => window.parts.map(part => part.text).join(' · ')), [
    '24h · 1 · $100 · 0.50×',
    '7d · 2 · $150 · 1.00×',
    '30d · 3 · $200 · 2.00×',
  ]);
  assert.deepEqual(describeCaller(snapshot, now).windows.map(window => window.parts[3].tone), ['loss', '', 'gain']);
});
test('compact caller stats preserve metric meaning, denominators and missing-data warnings', () => {
  const snapshot = {
    complete: false, fetchedAt: now,
    rows: [
      { id: 'one', supported: true, createdAt: now - 1000, entryCap: 32000, current: .5, peak: 2 },
      { id: 'two', supported: true, createdAt: now - 2000, entryCap: null, current: null, peak: null },
    ],
  };
  const stats = describeCaller(snapshot, now);
  assert.deepEqual(stats.windows.map(window => window.period), ['24h', '7d', '30d']);
  for (const window of stats.windows) {
    assert.equal(window.parts.map(part => part.text).join(' · '), `${window.period} · 2+ · $32K · 0.50×`);
    assert.match(window.parts[2].title, /Average entry market cap in USD.*1\/2/);
    assert.match(window.parts[3].title, /Average current multiple.*1\/2/);
  }
  assert.match(stats.title, /Partial history/);
  assert.match(stats.title, /Median 0.50×/);
  const empty = describeCaller({ ...snapshot, complete: true, rows: [] }, now);
  for (const window of empty.windows) {
    assert.equal(window.parts[2].text, '—'); assert.equal(window.parts[3].text, '—'); assert.equal(window.parts[3].tone, '');
  }
});

test('watching a feed makes zero requests; only a caller button click starts a lookup', async () => {
  const { watchFeed } = await import('../feed.js');
  const { document } = parseHTML(`<html><body><article data-testid="coin-callouts-feed-card"><a href="/coin/token" aria-label="Open caller's callout"></a><a href="/profile/caller" aria-label="Open caller's profile"></a></article></body></html>`);
  const oldDocument=globalThis.document, oldObserver=globalThis.MutationObserver;
  globalThis.document=document; globalThis.MutationObserver=document.defaultView.MutationObserver;
  let requests=0, stop;
  try {
    stop=watchFeed({root:document,styleUrl:'panel.css',openProfile:()=>{},client:{load:async()=>{requests++;return {complete:true,rows:[],fetchedAt:Date.now()};}}});
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(requests,0);
    const host=document.querySelector('[data-callout-author-stats]');
    assert.ok(host);
    const button=host.shadowRoot.querySelector('button');
    assert.equal(button.dataset.state,'idle'); assert.match(button.textContent,/Caller stats.*24h · 7d · 30d.*Load/);
    button.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests,1);
    assert.equal(button.dataset.state,'ready'); assert.equal(calls(button),'0');
    assert.equal(button.querySelectorAll('[data-period]').length,3);
    for (const period of ['24h','7d','30d']) assert.ok(button.textContent.includes(period));
  } finally {stop?.();globalThis.document=oldDocument;globalThis.MutationObserver=oldObserver;}
});

test('one lookup populates all author cards and later cards without more requests',async()=>{
  const {watchFeed}=await import('../feed.js');
  const card=profile=>`<article data-testid="feed-callout-card"><a href="/profile/${profile}" aria-label="Open caller's profile"></a></article>`;
  const {document}=parseHTML(`<html><body>${card('caller')}${card('wallet')}${card('other')}</body></html>`);
  const oldDocument=globalThis.document,oldObserver=globalThis.MutationObserver;
  globalThis.document=document;globalThis.MutationObserver=document.defaultView.MutationObserver;
  let requests=0,stop,notify;
  const snapshot={profile:{id:'uuid',username:'caller',address:'wallet'},complete:true,rows:[],fetchedAt:Date.now()};
  const buttons=()=>[...document.querySelectorAll('[data-callout-author-stats]')].map(host=>host.shadowRoot.querySelector('button'));
  try{
    stop=watchFeed({root:document,styleUrl:'panel.css',openProfile:()=>{},client:{subscribeSnapshots:listener=>{notify=listener;return()=>{};},load:async()=>{requests++;return snapshot;}}});
    buttons()[0].click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests,1);
    assert.equal(calls(buttons()[0]), '0');assert.equal(calls(buttons()[1]), '0');
    assert.equal(buttons()[2].dataset.state, 'idle');
    document.body.insertAdjacentHTML('beforeend',card('uuid'));
    await new Promise(resolve=>setTimeout(resolve,140));
    assert.equal(calls(buttons()[3]), '0');assert.equal(requests,1);
    notify({...snapshot,fetchedAt:snapshot.fetchedAt+1000,rows:[{id:'call',createdAt:Date.now()-1000,supported:true,entryCap:100,current:2,peak:3}]});
    assert.equal(calls(buttons()[0]), '1');assert.equal(calls(buttons()[1]), '1');assert.equal(calls(buttons()[3]), '1');
    assert.equal(requests,1);
    const changed=document.querySelectorAll('article')[3].querySelector('a');changed.setAttribute('href','/profile/recycled');
    await new Promise(resolve=>setTimeout(resolve,140));
    assert.equal(buttons()[3].dataset.state, 'idle');assert.equal(requests,1);
  }finally{stop?.();globalThis.document=oldDocument;globalThis.MutationObserver=oldObserver;}
});

test('a newly opened feed paints saved stats without a lookup',async()=>{
  const {watchFeed}=await import('../feed.js');
  const {document}=parseHTML('<html><body><article data-testid="feed-callout-card"><a href="/profile/wallet" aria-label="Open caller profile"></a></article></body></html>');
  const oldDocument=globalThis.document,oldObserver=globalThis.MutationObserver;
  globalThis.document=document;globalThis.MutationObserver=document.defaultView.MutationObserver;
  let stop,requests=0;
  try{
    stop=watchFeed({root:document,styleUrl:'panel.css',openProfile:()=>{},client:{load:async()=>{requests++;},readSnapshots:async()=>[{profile:{id:'uuid',username:'caller',address:'wallet'},rows:[],complete:true,fetchedAt:Date.now()}]}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls(document.querySelector('[data-callout-author-stats]').shadowRoot.querySelector('button')),'0');
    assert.equal(requests,0);
  }finally{stop?.();globalThis.document=oldDocument;globalThis.MutationObserver=oldObserver;}
});

test('other installations populate author cards from batched cache-only reads; misses never load Pump', async () => {
  const { watchFeed } = await import('../feed.js');
  const card = profile => `<article data-testid="feed-callout-card"><a href="/profile/${profile}" aria-label="Open profile"></a></article>`;
  const { document } = parseHTML(`<html><body>${card('caller')}${card('wallet')}${card('absent')}</body></html>`);
  const oldDocument = globalThis.document, oldObserver = globalThis.MutationObserver;
  globalThis.document = document; globalThis.MutationObserver = document.defaultView.MutationObserver;
  let stop, loads = 0;
  const batches = [];
  const buttons = () => [...document.querySelectorAll('[data-callout-author-stats]')].map(host => host.shadowRoot.querySelector('button'));
  try {
    stop = watchFeed({ root: document, styleUrl: 'panel.css', openProfile: () => {}, client: {
      load: async () => { loads++; },
      readShared: async profiles => {
        batches.push(profiles);
        return [{ profile: { id: 'uuid', username: 'caller', address: 'wallet' }, rows: [], complete: true, fetchedAt: Date.now() }];
      },
    } });
    await new Promise(resolve => setTimeout(resolve, 260));
    assert.deepEqual(batches, [['caller', 'wallet', 'absent']]);
    assert.equal(calls(buttons()[0]), '0'); assert.equal(calls(buttons()[1]), '0');
    assert.equal(buttons()[2].dataset.state, 'idle'); assert.equal(loads, 0);
    document.body.insertAdjacentHTML('beforeend', card('caller'));
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(calls(buttons()[3]), '0'); assert.equal(batches.length, 1); assert.equal(loads, 0);
  } finally { stop?.(); globalThis.document = oldDocument; globalThis.MutationObserver = oldObserver; }
});

test('shared-cache failure pauses automatic reads and leaves explicit caller loading usable', async () => {
  const { watchFeed } = await import('../feed.js');
  const { document } = parseHTML('<html><body><article data-testid="feed-callout-card"><a href="/profile/caller" aria-label="Open profile"></a></article></body></html>');
  const oldDocument = globalThis.document, oldObserver = globalThis.MutationObserver;
  globalThis.document = document; globalThis.MutationObserver = document.defaultView.MutationObserver;
  let stop, reads = 0, loads = 0;
  try {
    stop = watchFeed({ root: document, styleUrl: 'panel.css', openProfile: () => {}, client: {
      readShared: async () => { reads++; throw new Error('429'); },
      load: async () => { loads++; return { profile: { id: 'uuid', username: 'caller', address: 'wallet' }, rows: [], complete: true, fetchedAt: Date.now() }; },
    } });
    await new Promise(resolve => setTimeout(resolve, 260));
    document.body.insertAdjacentHTML('beforeend', '<article data-testid="feed-callout-card"><a href="/profile/another" aria-label="Open profile"></a></article>');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(reads, 1); assert.equal(loads, 0);
    const button = document.querySelector('[data-callout-author-stats]').shadowRoot.querySelector('button');
    button.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 1); assert.equal(calls(button), '0');
  } finally { stop?.(); globalThis.document = oldDocument; globalThis.MutationObserver = oldObserver; }
});

test('rolling windows age locally without any history or shared-cache requests', async () => {
  const { watchFeed } = await import('../feed.js');
  const { document } = parseHTML('<html><body><article data-testid="feed-callout-card"><a href="/profile/caller" aria-label="Open profile"></a></article></body></html>');
  const oldDocument = globalThis.document, oldObserver = globalThis.MutationObserver;
  const oldInterval = globalThis.setInterval, oldNow = Date.now;
  globalThis.document = document; globalThis.MutationObserver = document.defaultView.MutationObserver;
  let tick, stop, time = now, requests = 0;
  globalThis.setInterval = callback => { tick = callback; return 0; };
  Date.now = () => time;
  try {
    stop = watchFeed({ root: document, styleUrl: 'panel.css', openProfile: () => {}, client: {
      load: async () => { requests++; },
      readSnapshots: async () => [{ profile: { id: 'uuid', username: 'caller', address: 'wallet' }, complete: true, fetchedAt: now,
        rows: [{ id: 'call', supported: true, createdAt: now - 86_400_000 + 30_000, entryCap: 100, current: 2, peak: 3 }] }],
    } });
    await new Promise(resolve => setImmediate(resolve));
    const button = document.querySelector('[data-callout-author-stats]').shadowRoot.querySelector('button');
    assert.match(rows(button)[0], /^24h · 1 · /);
    time += 60_000; tick();
    assert.deepEqual(rows(button).map(row => row.split(' · ').slice(0, 2).join(' · ')), ['24h · 0', '7d · 1', '30d · 1']);
    assert.equal(requests, 0);
  } finally {
    stop?.(); globalThis.document = oldDocument; globalThis.MutationObserver = oldObserver;
    globalThis.setInterval = oldInterval; Date.now = oldNow;
  }
});

test('stats sit under the caller’s own position card or note, never inside a quoted card', async () => {
  const { watchFeed } = await import('../feed.js');
  const { document } = parseHTML(`<html><body>
    <article data-testid="feed-callout-card" id="position"><a href="/profile/one" aria-label="Open one's profile"></a>
      <p data-testid="callout-note">gm</p><div><div data-testid="callout-position-mini-card" id="mini"></div><div id="actions"></div></div>
    </article>
    <article data-testid="feed-callout-card" id="note"><a href="/profile/two" aria-label="Open two's profile"></a>
      <article data-testid="feed-callout-card"><div data-testid="callout-position-mini-card" id="quoted"></div></article>
      <p data-testid="callout-note" id="two-note">gm</p>
    </article>
    <article data-testid="feed-callout-card" id="bare"><a href="/profile/three" aria-label="Open three's profile"></a></article>
  </body></html>`);
  const oldDocument = globalThis.document, oldObserver = globalThis.MutationObserver;
  globalThis.document = document; globalThis.MutationObserver = document.defaultView.MutationObserver;
  let stop;
  try {
    stop = watchFeed({ root: document, styleUrl: 'card.css', openProfile: () => {}, client: { load: async () => {} } });
    await new Promise(resolve => setTimeout(resolve, 140));
    const isStats = node => node?.hasAttribute('data-callout-author-stats');
    assert.equal(document.querySelectorAll('[data-callout-author-stats]').length, 3);
    assert.ok(isStats(document.querySelector('#mini').nextElementSibling));
    assert.ok(isStats(document.querySelector('#two-note').nextElementSibling));
    assert.ok(!isStats(document.querySelector('#quoted').nextElementSibling));
    assert.ok(isStats(document.querySelector('#bare').firstElementChild));
  } finally { stop?.(); globalThis.document = oldDocument; globalThis.MutationObserver = oldObserver; }
});

test('cached cards open their snapshot immediately; explicit reload updates aliases and preserves data on failure', async () => {
  const { watchFeed } = await import('../feed.js');
  const { document } = parseHTML(`<html><body>${['caller','wallet'].map(profile=>`<article data-testid="feed-callout-card"><a href="/profile/${profile}" aria-label="Open profile"></a></article>`).join('')}</body></html>`);
  const oldDocument=globalThis.document, oldObserver=globalThis.MutationObserver;
  globalThis.document=document;globalThis.MutationObserver=document.defaultView.MutationObserver;
  const snapshot={profile:{id:'uuid',username:'caller',address:'wallet'},rows:[],complete:true,fetchedAt:Date.now()-600_000};
  let stop,resolve,reject;const loads=[],opened=[];
  try {
    stop=watchFeed({root:document,styleUrl:'card.css',openProfile:(...args)=>opened.push(args),client:{
      readSnapshots:async()=>[snapshot],
      load:(profile,options)=>{loads.push({profile,options});return new Promise((yes,no)=>{resolve=yes;reject=no;});},
    }});
    await new Promise(done=>setImmediate(done));
    const hosts=[...document.querySelectorAll('[data-callout-author-stats]')];
    const button=hosts[0].shadowRoot.querySelector('.caller-stats');
    const reload=hosts[0].shadowRoot.querySelector('.reload-stats');
    assert.equal(reload.hidden,false);assert.equal(reload.parentElement,button.parentElement);
    assert.equal(button.contains(reload),false);
    button.click();assert.equal(opened.length,1);assert.equal(opened[0][2],snapshot);assert.equal(loads.length,0);
    reload.click();reload.click();await new Promise(done=>setImmediate(done));
    assert.deepEqual(loads,[{profile:'caller',options:{force:true}}]);
    assert.equal(reload.disabled,true);assert.equal(calls(button),'0');assert.equal(opened.length,1);
    resolve({...snapshot,fetchedAt:Date.now(),rows:[{id:'new',supported:true,createdAt:Date.now()-1000,entryCap:100,current:2,peak:3}]});
    await new Promise(done=>setImmediate(done));
    assert.equal(reload.disabled,false);
    for (const host of hosts) assert.equal(calls(host.shadowRoot.querySelector('.caller-stats')),'1');
    reload.click();await new Promise(done=>setImmediate(done));reject(new Error('Pump is limiting requests.'));
    await new Promise(done=>setImmediate(done));
    assert.equal(calls(button),'1');assert.equal(button.dataset.state,'ready');assert.equal(reload.disabled,false);
    assert.match(reload.title,/Refresh failed.*Showing saved stats/);assert.equal(loads.length,2);
  } finally {stop?.();globalThis.document=oldDocument;globalThis.MutationObserver=oldObserver;}
});
