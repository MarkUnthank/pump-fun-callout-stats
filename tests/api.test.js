import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, parseProfile } from '../api.js';
import { profileFromLink } from '../feed.js';
import { createLoader } from '../loader.js';

const now = Date.parse('2026-10-15T12:00:00Z');
const user = { userId: 'public-user', username: 'caller', address: 'wallet' };
const row = (id, time = now - 1000) => ({ calloutId: id, coinMint: 'mint', createdAt: time, marketCap: 10000, calloutPrice: 1, multiple: .5, maxMultiplier: 2 });
function fixture(pages) {
  const seen = [];
  const fetcher = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    seen.push(new URL(url));
    if (url.includes('/users/')) return Response.json(user);
    const page = pages.shift();
    if (page instanceof Error) throw page;
    return page instanceof Response ? page : Response.json(page);
  };
  return { fetcher, seen };
}

test('only explicit Pump identities and URLs are accepted', () => {
  assert.equal(parseProfile('@caller'), 'caller');
  assert.equal(parseProfile('https://pump.fun/profile/caller?tab=callouts'), 'caller');
  for (const bad of ['https://evil.test/profile/caller', 'https://pump.fun.evil.test/profile/a', 'https://pump.fun:4430/profile/a', 'https://pump.fun/profile/%2Fadmin', '../admin', 'x?a=b', 'https://user@pump.fun/profile/a']) assert.throws(() => parseProfile(bad));
  assert.equal(profileFromLink('/profile/caller'), 'caller');
  assert.equal(profileFromLink('https://evil.test/profile/caller'), null);
  assert.equal(profileFromLink('/coin/caller'), null);
});

test('short and empty pages still follow their cursor; repeated IDs count once', async () => {
  const { fetcher, seen } = fixture([
    { callouts: [row('one')], nextPageToken: 'next' },
    { callouts: [], nextPageToken: 'third' },
    { callouts: [row('one'), row('two', now - 2000)], nextPageToken: '' },
  ]);
  const snapshot = await loadProfile('caller', { fetcher, now });
  assert.equal(snapshot.complete, true); assert.equal(snapshot.rows.length, 2); assert.equal(snapshot.pages, 3);
  assert.equal(seen[2].searchParams.get('pageToken'), 'next');
  assert.equal(seen[3].searchParams.get('pageToken'), 'third');
});

test('mid-pagination errors retain data and visibly mark it partial', async () => {
  const { fetcher } = fixture([{ callouts: [row('one')], nextPageToken: 'next' }, new Response('', { status: 429 })]);
  const snapshot = await loadProfile('caller', { fetcher, now });
  assert.equal(snapshot.complete, false); assert.equal(snapshot.rows.length, 1); assert.match(snapshot.issues[0], /limiting/);
});

test('cursor loops, malformed records, reordered pages and page caps never claim completeness', async () => {
  for (const pages of [
    [{ callouts: [row('one')], nextPageToken: 'repeat' }, { callouts: [], nextPageToken: 'repeat' }],
    [{ callouts: [row('one', 0)], nextPageToken: '' }],
    [{ callouts: [row('one', now - 2000), row('two')], nextPageToken: '' }],
  ]) {
    const snapshot = await loadProfile('caller', { ...fixture(pages), now });
    assert.equal(snapshot.complete, false); assert.ok(snapshot.issues.length);
  }
  const snapshot = await loadProfile('caller', { ...fixture([{ callouts: [row('one')], nextPageToken: 'more' }]), now, maxPages: 1 });
  assert.equal(snapshot.complete, false); assert.match(snapshot.issues[0], /limited/);
});

test('a fully older page ends a sorted 30-day scan and an empty account is complete', async () => {
  const snapshot = await loadProfile('caller', { ...fixture([{ callouts: [row('old', now - 34 * 86400000)], nextPageToken: 'older' }]), now });
  assert.equal(snapshot.complete, true); assert.equal(snapshot.pages, 1);
  const empty = await loadProfile('caller', { ...fixture([{ callouts: [], nextPageToken: '' }]), now });
  assert.equal(empty.complete, true); assert.equal(empty.rows.length, 0);
});

test('first-page failures and schema changes surface errors instead of zero calls', async () => {
  for (const bad of [{}, new Response('', { status: 500 }), new Error('network')]) {
    await assert.rejects(loadProfile('caller', { ...fixture([bad]), now }));
  }
});

test('feed lookups are cached, deduplicated, force-refreshable and limited to two in flight', async () => {
  let active = 0, maxActive = 0, calls = 0, time = now;
  const load = createLoader(async (name) => {
    active++; calls++; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return { name, fetchedAt: time };
  }, () => time);
  await Promise.all([load('a'), load('a'), load('b'), load('c'), load('d')]);
  assert.equal(calls, 4); assert.equal(maxActive, 2);
  await load('a'); assert.equal(calls, 4);
  await load('a', { force: true }); assert.equal(calls, 5);
  time += 6 * 60 * 1000; await load('a'); assert.equal(calls, 6);
});

test('public requests share pacing and a 429 stops queued traffic until cooldown expires', async () => {
  const { createPacedFetcher } = await import('../api.js');
  let time=0;
  const starts=[];
  const paced=createPacedFetcher(async()=>{starts.push(time); return Response.json({});},{gapMs:400,clock:()=>time,wait:async ms=>{time+=ms;}});
  await Promise.all([paced('a'),paced('b'),paced('c')]);
  assert.deepEqual(starts,[0,400,800]);
  let calls=0;
  const limited=createPacedFetcher(async()=>{calls++;return calls===1 ? new Response('',{status:429,headers:{'retry-after':'90'}}) : Response.json({});},{clock:()=>time,wait:async ms=>{time+=ms;}});
  assert.equal((await limited('a')).status,429);
  await assert.rejects(limited('b'),/limiting requests/);
  assert.equal(calls,1);
  time+=90001;
  assert.equal((await limited('c')).status,200);
});

test('default profile history scan makes at most four requests and marks the cap partial', async () => {
  const {fetcher,seen}=fixture(Array.from({length:4},(_,i)=>({callouts:[row(`row${i}`,now-1000-i)],nextPageToken:`page${i+1}`})));
  const snapshot=await loadProfile('caller',{fetcher,now});
  assert.equal(seen.length,4);
  assert.equal(snapshot.pages,3);
  assert.equal(snapshot.complete,false);
  assert.match(snapshot.issues.join(' '),/limited/);
});
