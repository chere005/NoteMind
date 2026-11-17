const {test}=require('node:test'),assert=require('node:assert/strict'),registry=require('../src/ink-mutations.js'),{lineStroke}=require('../src/ink-constraints.cjs'),{load}=require('./helpers/tablet-surface.cjs');
const {TabletPage}=load('src/tablet/renderer/tabletPage.ts',{setImmediate,setTimeout,MessageChannel,performance,WeakRef,FinalizationRegistry,AbortController});
const stroke=()=>({colorHex:'#aB34cD',width:2.125,points:[{x:-0,y:-0},{x:.2,y:.7},{x:.4,y:.4}],pressures:[-0,.1234567890123456,.9876543210987654]}),tick=()=>new Promise(setImmediate);

test('preparation publishes one captured append, preserves exact pressure and excludes later pen input',async t=>{
 const page=new TabletPage(1);t.after(()=>page.disposeAsync());const source=stroke();let release;const gate=new Promise(r=>release=r),held=registry.appendInkStroke(page,source,{nativeCanonical:true,prepare:async value=>{await gate;return lineStroke(value)}});assert.equal(registry.hasPendingInkMutations(page),true);
 const snapshot=registry.projectInkSnapshot(page,page.strokes.slice()),later=stroke(),next=registry.appendInkStroke(page,later,{nativeCanonical:true});release();await held;await next;
 const captured=await snapshot;assert.equal(captured.length,1);assert.equal(captured[0],page.strokes[0]);assert.equal(captured[0].pressures,source.pressures);assert.equal(captured[0].colorHex,source.colorHex);assert.ok(Object.is(captured[0].points[0].x,-0));assert.deepEqual(captured[0].points[1],{x:.2,y:.2});assert.equal(page.strokes[1],later);assert.equal(registry.hasPendingInkMutations(page),false);
 await page.undoAsync();assert.equal(page.strokes.length,1);await page.undoAsync();assert.equal(page.strokes.length,0);assert.equal(page.canUndo,false);
});

test('invalid prepared ownership and cancellation release reservations without committing partial ink',async t=>{
 const page=new TabletPage(1);t.after(()=>page.disposeAsync());const capacity=registry.inkCapacity(page);
 for(const prepare of [value=>({...value,points:[]}),value=>({...value,pressures:[...value.pressures]}),value=>({...value,colorHex:'#abcdef'}),value=>({...value,width:3})]){
  await assert.rejects(registry.appendInkStroke(page,stroke(),{prepare}),/ownership/);assert.equal(page.strokes.length,0);assert.equal(page.geometryRetained,false);assert.deepEqual(registry.inkCapacity(page),capacity);
 }
 const abort=new AbortController();let entered;const started=new Promise(r=>entered=r),cancelled=registry.appendInkStroke(page,stroke(),{signal:abort.signal,prepare:async(value,options)=>{entered();await tick();if(options.signal.aborted)throw Object.assign(Error('cancelled'),{name:'AbortError'});return value}});await started;abort.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(page.strokes.length,0);assert.equal(page.geometryRetained,false);assert.deepEqual(registry.inkCapacity(page),capacity);
});

test('owner disposal waits for accepted preparation and releases geometry only afterward',async()=>{
 const page=new TabletPage(1),source=stroke();let release,committed;const gate=new Promise(r=>release=r),pending=registry.appendInkStroke(page,source,{prepare:async value=>{await gate;return lineStroke(value)},onCommit:value=>committed=value});assert.equal(await page.disposeAsync(),false);assert.equal(page.geometryRetained,true);release();await pending;await tick();assert.ok(committed);assert.equal(committed.pressures,source.pressures);assert.equal(page.geometryRetained,false);
});

test('failure waits for owned asynchronous bounds cleanup before releasing admission',async t=>{
 const page=new TabletPage(1);t.after(()=>page.disposeAsync());const source={colorHex:'#123456',width:2,points:Array.from({length:50000},(_,i)=>({x:i/50000,y:.3}))},bounds=require('../src/stroke-bounds.js');let rejectHash,releaseBox,boxStarted;const started=new Promise(r=>boxStarted=r),hash=new Promise((_,r)=>rejectHash=r),box=new Promise(r=>releaseBox=r);t.mock.method(bounds,'strokeBoxAsync',()=>{boxStarted();return box});let finished=false;const pending=registry.appendInkStroke(page,source,{nativeCanonical:true,prepare:value=>({...value,points:value.points.slice()}),finalize:()=>hash}).finally(()=>finished=true);pending.catch(()=>{});await started;rejectHash(Error('fingerprint failed'));await tick();assert.equal(finished,false);assert.equal(page.geometryRetained,true);releaseBox();await assert.rejects(pending,/fingerprint failed/);assert.equal(page.geometryRetained,false);assert.equal(page.strokes.length,0);assert.equal(registry.inkCapacity(page).points,2000000);
});

test('action controller forwards the actual prepared stroke to its commit callback',async t=>{
 const page=new TabletPage(1);t.after(()=>page.disposeAsync());const original=stroke(),controller=registry.createInkActionController(page);let candidate,received;await controller.append(original,{prepare:async value=>(candidate=await lineStroke(value)),onCommit:value=>received=value});assert.notEqual(candidate,original);assert.equal(page.strokes[0],candidate);assert.equal(received,candidate);assert.equal(registry.hasPendingInkMutations(page),false);
});
