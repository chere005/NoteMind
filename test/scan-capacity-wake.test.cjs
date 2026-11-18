const {test}=require('node:test'),assert=require('node:assert/strict'),{acquireWorking}=require('../src/scan-asset-pdf.cjs');
const tick=()=>new Promise(setImmediate);
function fixture(kind='bytes'){
 let listener,calls=0,available=false,off=0;const release=async()=>{};
 const codec={subscribeRawCapacity(fn){listener=fn;return()=>{listener=null;off++}},hasRawAssetScope:()=>true,async acquireScopedRawWorking(){calls++;if(calls>1000)throw Error('Capacity retry spin');if(!available){listener?.({kind:'owners'});throw Object.assign(Error('busy'),{code:'ARCHIVE_RAW_BUSY',capacityKind:kind})}return release}};
 return{codec,release,get calls(){return calls},get off(){return off},get listener(){return listener},available(){available=true},emit(value){listener?.(value)}};
}
test('failed provisional owner retirement cannot repeatedly retry scan byte admission',async()=>{
 const f=fixture(),controller=new AbortController(),pending=acquireWorking(f.codec,controller.signal);await tick();await tick();assert.equal(f.calls,1);assert.ok(f.listener);f.emit({kind:'owners'});await tick();assert.equal(f.calls,1);f.available();f.emit({kind:'bytes'});assert.equal(await pending,f.release);assert.equal(f.calls,2);assert.equal(f.off,2);assert.equal(f.listener,null);
});
test('owner-slot failure and legacy untyped byte notifications preserve wakeups',async()=>{
 for(const kind of['owners','bytes']){const f=fixture(kind);if(kind==='owners'){let calls=0;f.codec.acquireScopedRawWorking=async()=>{if(++calls===1){f.emit({kind:'owners'});throw Object.assign(Error('busy'),{code:'ARCHIVE_RAW_BUSY',capacityKind:'owners'})}return f.release};assert.equal(await acquireWorking(f.codec),f.release);assert.equal(calls,2);}else{const pending=acquireWorking(f.codec);await tick();f.available();f.emit();assert.equal(await pending,f.release);assert.equal(f.calls,2);}}
});
test('scan cancellation rejects its capacity wait and removes its only listener promptly',async()=>{
 const f=fixture(),controller=new AbortController(),pending=acquireWorking(f.codec,controller.signal);await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.calls,1);assert.equal(f.listener,null);assert.equal(f.off,1);
});
