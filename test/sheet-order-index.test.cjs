const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SheetPackStore}=require('../src/sheet-pack-store.cjs'),{SheetOrderIndex,encodeLeaf,decodeLeaf}=require('../src/sheet-order-index.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-sheet-index-')),packs=new SheetPackStore(root),index=new SheetOrderIndex(packs,{maxCacheBytes:128*1024});t.after(async()=>{await packs.dispose();await fs.rm(root,{recursive:true,force:true});});const chunk=await packs.publish(Buffer.from('geometry fixture'));return {packs,index,chunk};}
const record=(id,chunk)=>({id,hash:id.toString(16).padStart(16,'0'),points:2,chunk,strokeIndex:id-1});
test('binary identity leaves preserve exact IDs, fingerprints and references',async t=>{const {chunk}=await fixture(t),records=[record(1,chunk),record(9007199254740991,chunk)];records[1].strokeIndex=1;assert.deepEqual(decodeLeaf(encodeLeaf(records)).records,records);});
test('tail appends write only bounded index nodes and preserve all previous roots',async t=>{
 const {packs,index,chunk}=await fixture(t),records=Array.from({length:600},(_,i)=>record(i+1,chunk)),first=await index.build(records),before=packs.stats().writtenBytes,next=await index.append(first,[record(601,chunk)]),written=packs.stats().writtenBytes-before;
 assert.ok(written<32*1024);assert.equal(next.count,601);assert.equal((await Array.fromAsync(index.records(first))).length,600);assert.deepEqual((await Array.fromAsync(index.records(next))).map(r=>r.id),Array.from({length:601},(_,i)=>i+1));index.clear();assert.equal((await Array.fromAsync(index.records(next))).at(-1).id,601);assert.ok(index.stats().cacheBytes<=128*1024);
});
test('leaf and branch boundaries retain ordering through append splits',async t=>{
 const {index,chunk}=await fixture(t),first=await index.build(Array.from({length:255},(_,i)=>record(i+1,chunk))),next=await index.append(first,Array.from({length:6},(_,i)=>record(i+256,chunk)));assert.equal(next.height,2);assert.deepEqual((await Array.fromAsync(index.records(next))).map(r=>r.id),Array.from({length:261},(_,i)=>i+1));
});
test('streamed index construction retains order without collecting the full reference list',async t=>{
 const {index,chunk}=await fixture(t);async function* entries(){for(let id=1;id<=17000;id++)yield record(id,chunk);}const root=await index.buildFrom(entries());assert.equal(root.count,17000);assert.equal(root.points,34000);let expected=1;for await(const entry of index.records(root))assert.equal(entry.id,expected++);assert.equal(expected,17001);
});
test('corrupt index bytes and impossible descriptors fail before geometry hydration',async t=>{
 const {index,chunk,packs}=await fixture(t),root=await index.build([record(1,chunk)]);index.clear();const handle=await fs.open(packs.file(root.ref.pack),'r+');try{await handle.write(Buffer.from([0]),0,1,root.ref.offset);}finally{await handle.close();}await assert.rejects(Array.fromAsync(index.records(root)),/damaged/);await assert.rejects(index.append({...root,count:2000001},[]),/Invalid/);const bytes=encodeLeaf([record(2,chunk)]);bytes.writeUInt32LE(2,bytes.length-4);assert.throws(()=>decodeLeaf(bytes),/flags/);
});
