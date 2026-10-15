import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountPanel} from '../app.js';

test('opening the account panel is local; history and selected-call updates require separate clicks', async () => {
  const {document,window}=parseHTML('<html><body><div id="root"></div></body></html>');
  // Linkedom lacks the native select value setter used by browser controls.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value || this.options[0]?.value || '';},set(value){for(const o of this.options)o.removeAttribute('selected');[...this.options].find(o=>o.value===value)?.setAttribute('selected','');}});
  const oldDocument=globalThis.document;globalThis.document=document;
  let historyCalls=0, updateCalls=0;
  const now=Date.now();
  const client={read:async()=>({}),detectProfile:async()=> 'owner',save:async()=>{},currentMint:()=> 'token',
    load:async()=>{historyCalls++;return {profile:{id:'owner',username:'owner'},rows:[{id:'original',mint:'token',createdAt:now-7*86400000,supported:true,entryCap:100,current:2,peak:3}],complete:true,issues:[],fetchedAt:now};},
    loadUpdates:async(profile,options)=>{assert.equal(options.calloutId,'original');updateCalls++;return {rows:[{id:'update',calloutId:'original',mint:'token',createdAt:now-1000,text:'Today’s update'}],checked:1,issues:[],fetchedAt:now};}};
  let panel;
  try {
    const root=document.querySelector('#root');panel=mountPanel(root,client);await panel.ready;
    assert.equal(root.querySelector('input').value,'owner');
    assert.equal(historyCalls,0);assert.equal(updateCalls,0);
    root.querySelector('form').dispatchEvent(new window.Event('submit',{cancelable:true}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(historyCalls,1);assert.equal(updateCalls,0);
    root.querySelector('[data-load-updates]').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(updateCalls,1);
    assert.match(root.querySelector('[data-updates]').textContent,/Today’s update/);
    assert.deepEqual([...root.querySelector('[data-summary] tr').querySelectorAll('td')].map(cell=>cell.textContent), ['0','0','1']);
  } finally {panel?.destroy();globalThis.document=oldDocument;}
});


test('the performance table shows all rolling periods from one load and stays independent of history filters', async (t) => {
  const {document,window}=parseHTML('<html><body><main id="root"></main></body></html>');
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value || this.options[0]?.value || '';},set(value){for(const o of this.options)o.removeAttribute('selected');[...this.options].find(o=>o.value===value)?.setAttribute('selected','');}});
  const oldDocument=globalThis.document;globalThis.document=document;
  const now=Date.parse('2026-10-15T12:00:00Z');t.mock.method(Date,'now',()=>now);
  let loads=0, updates=0, panel;
  const call=(id,hours,cap,current,peak)=>({id,mint:id,createdAt:now-hours*3_600_000,supported:true,entryCap:cap,current,peak});
  const client={read:async()=>({zone:'UTC'}),detectProfile:async()=> 'owner',save:async()=>{},
    load:async()=>{loads++;return {profile:{id:'owner',username:'owner'},complete:false,issues:['Page limit reached.'],fetchedAt:now,rows:[
      call('recent',1,100,.5,2),call('missing',2,null,null,null),call('week',48,200,1.5,3),call('month',480,300,4,5),
    ]};},loadUpdates:async()=>{updates++;return {rows:[],issues:[]};}};
  try {
    const root=document.querySelector('#root');panel=mountPanel(root,client);await panel.ready;
    root.querySelector('form').dispatchEvent(new window.Event('submit',{cancelable:true}));
    await new Promise(resolve=>setImmediate(resolve));
    const rows=()=>[...root.querySelectorAll('[data-summary] tr')].map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent));
    assert.deepEqual([...root.querySelectorAll('thead th')].slice(0,4).map(th=>th.textContent),['Metric','24h','7d','30d']);
    assert.deepEqual(rows(),[
      ['New callouts','2+','3+','4+'],
      ['Average entry cap','$1001/2','$1502/3','$2003/4'],
      ['Average current multiple','0.50×1/2','1.00×2/3','2.00×3/4'],
      ['Median current multiple','0.50×1/2','1.00×2/3','1.50×3/4'],
      ['Average peak multiple','2.00×1/2','2.50×2/3','3.33×3/4'],
    ]);
    assert.match(root.querySelector('[data-coverage]').textContent,/missing/);
    assert.match(root.querySelector('[role="status"]').textContent,/Partial history/);
    const original=rows();
    const filter=root.querySelector('[data-period]');filter.value='yesterday';filter.dispatchEvent(new window.Event('change'));
    assert.deepEqual(rows(),original);assert.equal(root.querySelector('[data-history] tbody').children.length,0);
    const zone=root.querySelector('[data-zone]');zone.value='UTC';zone.dispatchEvent(new window.Event('change'));
    assert.deepEqual(rows(),original);
    assert.equal(loads,1);assert.equal(updates,0);
  } finally {panel?.destroy();globalThis.document=oldDocument;}
});

test('own and inspected profiles display matching saved snapshots without another lookup', async () => {
  const {document,window}=parseHTML('<html><body><main id="root"></main></body></html>');
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value || this.options[0]?.value || '';},set(value){for(const o of this.options)o.removeAttribute('selected');[...this.options].find(o=>o.value===value)?.setAttribute('selected','');}});
  const oldDocument=globalThis.document;globalThis.document=document;
  const now=Date.now();let loads=0,panel;
  const snapshot={profile:{id:'uuid',username:'owner',address:'wallet'},rows:[{id:'call',mint:'token',supported:true,createdAt:now-1000,entryCap:100,current:2,peak:3}],complete:true,issues:[],fetchedAt:now-600_000};
  const client={read:async()=>({}),save:async()=>{},detectProfile:async()=> 'wallet',readSnapshots:async()=>[snapshot],load:async()=>{loads++;throw new Error('Unexpected network lookup');}};
  try {
    for (const options of [{},{inspect:true,initialProfile:'uuid',initialSnapshot:snapshot}]) {
      const root=document.querySelector('#root');panel=mountPanel(root,client,options);await panel.ready;
      assert.equal(loads,0);assert.equal(root.querySelector('[data-results]').hidden,false);
      assert.equal(root.querySelector('[data-profile]').textContent,'@owner');
      assert.match(root.querySelector('[role="status"]').textContent,/over 5 minutes old/);
      assert.equal(root.querySelector('[data-update-callout]').value,'call');
      assert.deepEqual([...root.querySelector('[data-summary] tr').querySelectorAll('td')].map(cell=>cell.textContent),['1','1','1']);
      panel.destroy();panel=null;
    }
  } finally {panel?.destroy();globalThis.document=oldDocument;}
});
