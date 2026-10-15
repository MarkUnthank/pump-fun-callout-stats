import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSnapshots,snapshotMatches,createSnapshotPublisher,SNAPSHOT_CACHE_KEY} from '../cache.js';
const snapshot=(id,time=100)=>({profile:{id,username:`user-${id}`,address:`wallet-${id}`},rows:[],fetchedAt:time});

test('cached snapshots match UUID, wallet or username; older responses cannot replace newer data',()=>{
  const fresh=snapshot('one',200), old=snapshot('one',100);
  for(const alias of ['one','wallet-one','USER-ONE']) assert.ok(snapshotMatches(fresh,alias));
  assert.equal(snapshotMatches(fresh,'wallet-other'),false);
  assert.deepEqual(mergeSnapshots([fresh],old),[fresh]);
  assert.equal(mergeSnapshots(Array.from({length:30},(_,i)=>snapshot(String(i),i)),snapshot('new',100)).length,20);
});

test('parallel loads publish both authors without losing snapshots',async()=>{
  let saved={};
  const storage={get:async()=>structuredClone(saved),set:async(value)=>{saved=structuredClone(value);}};
  const publish=createSnapshotPublisher(storage);
  await Promise.all([publish(snapshot('one')),publish(snapshot('two'))]);
  assert.equal(saved[SNAPSHOT_CACHE_KEY].length,2);
});
