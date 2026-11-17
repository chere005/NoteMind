const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SheetPackStore,validateRef}=require('../src/sheet-pack-store.cjs');
async function fixture(t,options={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-sheet-packs-')),store=new SheetPackStore(root,options);t.after(async()=>{await store.dispose();await fs.rm(root,{recursive:true,force:true});});return {root,store};}
test('many small immutable ranges share bounded physical packs and survive restart',async t=>{
 const {root,store}=await fixture(t,{targetBytes:1024}),refs=[];for(let i=0;i<80;i++)refs.push(await store.publish(Buffer.from('stroke '+i+' '.repeat(20))));const files=(await fs.readdir(root)).filter(file=>file.endsWith('.pack'));assert.ok(files.length<5);assert.equal(store.stats().createdPacks,files.length);
 const reopened=new SheetPackStore(root);t.after(()=>reopened.dispose());for(let i=0;i<refs.length;i++)assert.equal((await reopened.read(refs[i])).toString(),'stroke '+i+' '.repeat(20));
});
test('known unchanged bytes reuse a verified range and old published ranges never change',async t=>{
 const {store}=await fixture(t),data=Buffer.from('original'),first=await store.publish(data),same=await store.publish(data);assert.deepEqual(same,first);for(let i=0;i<20;i++)await store.publish(Buffer.from('next '+i));assert.equal((await store.read(first)).toString(),'original');assert.equal(store.stats().writtenBytes<200,true);
});
test('an oversized single range is isolated without rejecting supported scene bytes',async t=>{
 const {store}=await fixture(t,{targetBytes:100,maxExtentBytes:1000}),large=await store.publish(Buffer.alloc(500,7)),small=await store.publish(Buffer.from('small'));assert.notEqual(large.pack,small.pack);assert.equal((await store.read(large)).length,500);await assert.rejects(store.publish(Buffer.alloc(1001)),/too large/);
});
test('corrupt, truncated and unsafe references fail closed without overwriting earlier bytes',async t=>{
 const {root,store}=await fixture(t),ref=await store.publish(Buffer.from('protected'));await store.closeActive();const file=store.file(ref.pack);await fs.writeFile(file,Buffer.from('corrupted'));await assert.rejects(store.read(ref),/damaged/);await fs.truncate(file,2);await assert.rejects(store.read(ref),/truncated/);assert.throws(()=>validateRef({...ref,pack:'../escape'}),/Invalid/);assert.throws(()=>validateRef({...ref,offset:-1}),/Invalid/);assert.throws(()=>validateRef({...ref,bytes:NaN}),/Invalid/);assert.equal((await fs.readdir(root)).filter(file=>file.endsWith('.pack')).length,1);
});
test('a partial failed append leaves previous ranges readable and later publication uses a new pack',async t=>{
 const {store}=await fixture(t),first=await store.publish(Buffer.from('old')),active=store.active,write=active.handle.write.bind(active.handle);let fail=true;active.handle.write=async(...args)=>{if(fail){fail=false;await write(args[0],args[1],2,args[3]);throw Error('Disk full');}return write(...args);};
 await assert.rejects(store.publish(Buffer.from('unfinished')),/Disk full/);assert.equal((await store.read(first)).toString(),'old');const last=await store.publish(Buffer.from('new'));assert.notEqual(last.pack,first.pack);await store.sync();assert.equal((await store.read(last)).toString(),'new');
});
test('published packs reject external changes before an append and symbolic links on read',async t=>{
 const {root,store}=await fixture(t),ref=await store.publish(Buffer.from('old')),file=store.file(ref.pack);await fs.appendFile(file,'external');await assert.rejects(store.publish(Buffer.from('new')),/outside/);await store.closeActive();const other=path.join(root,'other');await fs.writeFile(other,'old');await fs.unlink(file);await fs.symlink(other,file);await assert.rejects(store.read(ref),/damaged/);
});
test('concurrent publications cannot overlap their immutable ranges',async t=>{
 const {store}=await fixture(t),refs=await Promise.all(Array.from({length:12},(_,i)=>store.publish(Buffer.from('value '+i))));for(let i=0;i<refs.length;i++)assert.equal((await store.read(refs[i])).toString(),'value '+i);assert.equal(new Set(refs.map(ref=>ref.pack+':'+ref.offset)).size,refs.length);
});
test('a changed cached range is revalidated instead of silently replacing its damaged bytes',async t=>{
 const {store}=await fixture(t),data=Buffer.from('original'),ref=await store.publish(data);await store.closeActive();await fs.writeFile(store.file(ref.pack),Buffer.from('corrupt!'));await assert.rejects(store.publish(data),/damaged/);assert.equal(store.stats().createdPacks,1);
});
test('mixed raw and compressed extents preserve bytes with explicit decompression limits',async t=>{
 const zlib=require('node:zlib'),{root,store}=await fixture(t,{encoder:bytes=>({codec:'deflate',bytes:zlib.deflateRawSync(bytes,{level:1})})}),data=Buffer.from('geometry data '.repeat(1000)),compressed=await store.publish(data);assert.equal(compressed.codec,'deflate');assert.equal(compressed.rawBytes,data.length);assert.ok(compressed.bytes<data.length);assert.deepEqual(await store.read(compressed),data);await assert.rejects(store.read({...compressed,rawBytes:10}),/codec|output|larger|size|length/i);
 const raw=new SheetPackStore(root);t.after(()=>raw.dispose());const plain=await raw.publish(Buffer.from('raw block'));assert.equal(plain.codec,'raw');assert.deepEqual(await raw.read(compressed),data);assert.equal((await store.read(plain)).toString(),'raw block');assert.throws(()=>validateRef({...compressed,codec:'unknown'}),/codec/);assert.throws(()=>validateRef({...compressed,rawBytes:Infinity}),/codec/);
});
test('a small decoded range cannot hide an oversized compressed input allocation',()=>{const ref={pack:'10000000-0000-0000-0000-000000000001',sha256:'a'.repeat(64),offset:0,bytes:150*1024*1024,rawBytes:256*1024,codec:'zstd'};assert.throws(()=>validateRef(ref,256*1024),/codec/);assert.throws(()=>validateRef({...ref,bytes:ref.rawBytes},256*1024),/codec/);});
test('candidate synchronization durably flushes all staged packs at one boundary',async t=>{
 const {store}=await fixture(t,{targetBytes:20,maxHints:2});for(let i=0;i<6;i++)await store.publish(Buffer.from('record '+i+' with data'));assert.ok(store.dirtyPacks.size>1);assert.ok(store.statsByPack.size<=2);await store.sync();assert.equal(store.dirtyPacks.size,0);assert.equal(store.directoryDirty,false);
});
