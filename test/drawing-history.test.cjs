const {test}=require('node:test'),assert=require('node:assert/strict');
const {DrawingHistoryBudget,DrawingHistory}=require('../src/drawing-history.js'),{recordStrokeAppend}=require('../src/stroke-signature.js');
const stroke=(n=20,value=0)=>({colorHex:'#112233',width:2,points:Array.from({length:n},(_,i)=>({x:value+i*.001,y:.3})),pressures:Array(n).fill(.7)});
function append(history,item){history.mark();const previous=history.current,next=[...previous,item];recordStrokeAppend(previous,next,item);history.setCurrent(next);return next;}
test('complete undo and redo survive the full100-frame limit without extra eviction',()=>{
 const budget=new DrawingHistoryBudget({maxBytes:1024*1024*1024}),history=new DrawingHistory([],{budget}),states=[history.current];for(let i=0;i<120;i++)states.push(append(history,stroke(1,i)));
 for(let i=119;i>=20;i--)assert.equal(history.step(),states[i]);assert.equal(history.step(),null);
 for(let i=21;i<=120;i++)assert.equal(history.step(true),states[i]);assert.equal(history.step(true),null);assert.equal(budget.stats().frames,100);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('large disjoint transforms retain exact current state and the nearest complete undo and redo',()=>{
 const budget=new DrawingHistoryBudget({maxBytes:1000}),history=new DrawingHistory([],{budget}),states=[];for(let i=0;i<10;i++){history.mark();const value=[stroke(100,i)];history.setCurrent(value);states.push(value);}
 assert.equal(history.current,states.at(-1));assert.equal(history.record.past.length,1);assert.equal(history.step(),states.at(-2));assert.equal(history.canRedo,true);assert.equal(history.step(true),states.at(-1));history.dispose();assert.equal(budget.stats().extraBytes,0);assert.equal(budget.stats().resourceBytes,0);
});
test('branching after Undo discards Redo before applying the history limit',()=>{
 const budget=new DrawingHistoryBudget({maxBytes:1024*1024*1024}),history=new DrawingHistory([],{budget});for(let i=0;i<100;i++)append(history,stroke(1,i));for(let i=0;i<50;i++)history.step();append(history,stroke(1,200));assert.equal(history.record.past.length,51);assert.equal(history.record.future.length,0);let undos=0;while(history.step())undos++;assert.equal(undos,51);history.dispose();
});
test('unmodified exports retain history view identity and cannot retain evicted frames internally',()=>{
 const budget=new DrawingHistoryBudget(),history=new DrawingHistory([],{budget});append(history,stroke(1));const first=history.export(),again=history.export();assert.equal(first.past,again.past);assert.equal(first.future,again.future);history.clear();assert.equal(history.export().past.length,0);assert.notEqual(first.past,history.export().past);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('recolouring deduplicates point and pressure arrays while charging distinct wrappers',()=>{
 const budget=new DrawingHistoryBudget(),original=[stroke(10000)],history=new DrawingHistory(original,{budget}),before=budget.stats();history.mark();history.setCurrent(original.map(s=>({...s,colorHex:'#ffffff'})));const after=budget.stats();assert.ok(after.extraBytes<2048,'shared points must not be charged as another10000-point graph');assert.ok(after.resourceBytes-before.resourceBytes<2048);assert.equal(history.step(),original);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('append ownership visits only bounded copied tree paths',()=>{
 const budget=new DrawingHistoryBudget({maxBytes:1024*1024*1024}),original=Array.from({length:4096},()=>stroke(1)),history=new DrawingHistory(original,{budget});history.mark();const next=[...original,stroke(1)];recordStrokeAppend(original,next,next.at(-1));const before=budget.stats().nodeVisits;history.setCurrent(next);assert.ok(budget.stats().nodeVisits-before<300);const markBefore=budget.stats().nodeVisits;history.mark();assert.ok(budget.stats().nodeVisits-markBefore<300);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('removal paths and restored snapshots retain ordering across sparse tree branches',()=>{
 const budget=new DrawingHistoryBudget(),original=Array.from({length:1100},(_,i)=>stroke(1,i)),history=new DrawingHistory(original,{budget});for(const at of [32,0,1090,500]){history.mark();const next=history.current.filter((_,i)=>i!==at);history.prepareRemoval(next,at);history.setCurrent(next);}for(let i=0;i<4;i++)assert.ok(history.step());assert.equal(history.current,original);for(let i=0;i<4;i++)assert.ok(history.step(true));assert.equal(history.current.length,1096);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('global budgets evict old frames across owners and explicit disposal releases ownership',()=>{
 const budget=new DrawingHistoryBudget({maxBytes:20000}),a=new DrawingHistory([],{budget}),b=new DrawingHistory([],{budget});for(let i=0;i<15;i++){for(const h of [a,b]){h.mark();h.setCurrent([stroke(100,i)]);}}assert.equal(a.canUndo,true);assert.equal(b.canUndo,true);assert.ok(budget.stats().extraBytes<20000);const exported=a.export(),copy=new DrawingHistory([],{budget});copy.import(exported);assert.equal(copy.current,exported.strokes);a.dispose();b.dispose();copy.dispose();assert.equal(budget.stats().frames,0);assert.equal(budget.stats().owners,0);assert.equal(budget.stats().resourceBytes,0);
});
test('mixed edits keep accounting nonnegative and preserve every retained step',()=>{
 const budget=new DrawingHistoryBudget({maxBytes:80000,maxStates:12}),history=new DrawingHistory([],{budget});let seed=17;for(let i=0;i<1000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;switch(seed%5){case 0:history.step();break;case 1:history.step(true);break;case 2:history.mark();history.setCurrent(history.current.map(s=>({...s,colorHex:'#ffffff'})));break;default:append(history,stroke(3,i));}const stats=budget.stats();assert.ok(stats.extraBytes>=0);assert.ok(stats.resourceBytes>=stats.extraBytes-stats.frames*96);assert.ok(history.record.past.length+history.record.future.length<=12);}history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('append Undo and Redo transfer shared tree ownership without walking unchanged strokes',()=>{
 const budget=new DrawingHistoryBudget(),original=Array.from({length:4096},()=>stroke(1)),history=new DrawingHistory(original,{budget});append(history,stroke(1));for(let i=0;i<10;i++){const before=budget.stats().nodeVisits;assert.ok(history.step(i%2===1));assert.ok(budget.stats().nodeVisits-before<500);}history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('prepared changes yield ownership work, commit once and preserve complete Undo and Redo',async()=>{
 const budget=new DrawingHistoryBudget({maxBytes:10000}),original=Array.from({length:12000},(_,i)=>stroke(1,i)),history=new DrawingHistory(original,{budget}),next=original.map(s=>({...s,points:s.points.map(p=>({...p,x:p.x+.1}))}));let commits=0,yields=0;
 const changed=await history.change(next,()=>{commits++;history.mark();history.setCurrent(next);},{yieldControl:async()=>{yields++;await new Promise(resolve=>setImmediate(resolve));}});assert.equal(changed,true);assert.equal(commits,1);assert.ok(yields>0);assert.equal(history.current,next);assert.equal(history.record.past.length,1);assert.equal(history.step(),original);assert.equal(history.step(true),next);assert.equal(budget.pendingPreparations,0);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('edits, cancellation and disposal during preparation cannot publish stale geometry',async()=>{
 for(const action of ['edit','abort','dispose']){const budget=new DrawingHistoryBudget(),original=[stroke()],history=new DrawingHistory(original,{budget}),next=[stroke(10,3)],controller=new AbortController();let commits=0;const pending=history.change(next,()=>{commits++;history.mark();history.setCurrent(next);},{signal:controller.signal});if(action==='edit')append(history,stroke(1,4));else if(action==='abort')controller.abort();else history.dispose();assert.equal(await pending,false);assert.equal(commits,0);assert.equal(budget.pendingPreparations,0);history.dispose();assert.equal(budget.stats().resourceBytes,0);}
});
test('a source edit during a yielding ownership acquisition releases the captured roots exactly',async()=>{
 const budget=new DrawingHistoryBudget(),original=Array.from({length:12000},()=>stroke(1)),history=new DrawingHistory(original,{budget}),next=original.map(s=>({...s,colorHex:'#abcdef'}));let changed=false,commits=0;
 assert.equal(await history.change(next,()=>{commits++;history.mark();history.setCurrent(next);},{yieldControl:async()=>{if(!changed&&budget.pendingPreparations){changed=true;append(history,stroke(1));}await new Promise(resolve=>setImmediate(resolve));}}),false);assert.equal(changed,true);assert.equal(commits,0);assert.equal(history.current.length,original.length+1);assert.equal(budget.pendingPreparations,0);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('a preparation error after pinning releases every temporary root',async()=>{
 const budget=new DrawingHistoryBudget(),original=Array.from({length:5000},()=>stroke(1)),history=new DrawingHistory(original,{budget}),next=original.map(s=>({...s,colorHex:'#abcdef'}));let failed=false;await assert.rejects(history.change(next,()=>{throw Error('must not commit');},{yieldControl:async()=>{if(budget.pendingPreparations&&!failed){failed=true;throw Error('pause failed');}}}),/pause failed/);assert.equal(failed,true);assert.equal(history.current,original);assert.equal(budget.pendingPreparations,0);history.dispose();assert.equal(budget.stats().resourceBytes,0);
});
test('async disposal cannot release a newly rehydrated owner of the same immutable geometry',async()=>{
 const budget=new DrawingHistoryBudget(),original=Array.from({length:12000},()=>stroke(1)),history=new DrawingHistory(original,{budget});append(history,stroke(1));const released=history.disposeAsync();assert.equal(history.current.length,0);history.setCurrent(original);await released;assert.equal(history.current,original);assert.equal(history.canUndo,false);assert.ok(budget.stats().resourceBytes>0);await history.disposeAsync();assert.equal(budget.stats().resourceBytes,0);assert.equal(budget.pendingPreparations,0);
});
test('dead-owner pruning queues bounded releases instead of walking scenes in the caller',async()=>{
 const budget=new DrawingHistoryBudget(),owners=Array.from({length:3},()=>new DrawingHistory(Array.from({length:5000},()=>stroke(1)),{budget}));for(const owner of owners)owner.record.owner={deref:()=>undefined};const visits=budget.visits;budget.prune();assert.equal(budget.visits,visits);await budget.releasing;assert.equal(budget.stats().owners,0);assert.equal(budget.stats().resourceBytes,0);assert.equal(budget.pendingPreparations,0);for(const owner of owners)owner.dispose();
});
test('cached nearest-scene point totals survive append, sparse removal and Undo without walking ink',()=>{
 const budget=new DrawingHistoryBudget(),original=Array.from({length:1100},()=>stroke(3)),history=new DrawingHistory(original,{budget});assert.equal(history.retainedGeometryPoints,3300);append(history,stroke(2));assert.equal(history.retainedGeometryPoints,6602);history.mark();const next=history.current.filter((_,i)=>i!==32);history.prepareRemoval(next,32);history.setCurrent(next);assert.equal(history.retainedGeometryPoints,6601);history.step();assert.equal(history.retainedGeometryPoints,9901);const visits=budget.visits;for(let i=0;i<100;i++)assert.equal(history.retainedGeometryPoints,9901);assert.equal(budget.visits,visits);history.dispose();assert.equal(history.retainedGeometryPoints,0);
});
