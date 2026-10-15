import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUpdates } from '../updates.js';
import { summarize } from '../stats.js';

const snapshot = {profile:{id:'owner',address:'wallet'}, rows:[{id:'original',mint:'token',supported:true,createdAt:Date.parse('2026-10-08T12:00:00Z'),entryCap:100,current:2,peak:3}]};
const row = {id:'update',userId:'owner',createdAt:'2026-10-15T12:00:00Z',content:'New update',parentMessageId:null};
test('author updates retain their own date without adding callouts or changing averages', async () => {
  const fetcher = async url => {
    assert.match(url, /original\/replies\?limit=200&filter=AUTHOR_ONLY$/);
    return Response.json({replies:[row,row,{...row,id:'comment',userId:'other'},{...row,id:'nested',parentMessageId:'parent'},{...row,id:'deleted',tombstone:true}]});
  };
  const before=structuredClone(snapshot.rows);
  const result=await loadUpdates(snapshot,{fetcher});
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].createdAt,Date.parse(row.createdAt));
  assert.equal(result.rows[0].calloutId,'original');
  assert.deepEqual(snapshot.rows,before);
  assert.equal(summarize(snapshot.rows,'today',Date.parse('2026-10-15T18:00:00Z'),'UTC').count,0);
  assert.equal(summarize(snapshot.rows,'month',Date.parse('2026-10-15T18:00:00Z'),'UTC').current,2);
});
test('failed update requests are visible and cannot masquerade as complete empty history', async () => {
  const result=await loadUpdates(snapshot,{fetcher:async()=>{throw new Error('offline');}});
  assert.equal(result.checked,0);
  assert.match(result.issues.join(' '),/could not be loaded/);
});
