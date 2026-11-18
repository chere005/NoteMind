const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const codec=require('../src/archive-codec.cjs'),{NotesStore}=require('../src/notes-store.cjs');
after(()=>codec.dispose());
test('legacy fallback recovery archives retire acquired encoded output on success and failure while durable bytes stay exact',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-owned-recovery-')),store=new NotesStore(path.join(root,'Notes'),path.join(root,'Recovery')),encode=codec.encode.bind(codec),encodeFile=codec.encodeFile,rename=fs.rename,encoded=[];
 codec.encodeFile=undefined;
 codec.encode=async(...args)=>{const bytes=await encode(...args);encoded.push(bytes);return bytes;};
 t.after(async()=>{codec.encode=encode;codec.encodeFile=encodeFile;fs.rename=rename;await fs.rm(root,{recursive:true,force:true});});
 const doc={id:'owned-recovery',text:'Original ink and picture',assets:{'assets/source.bin':Buffer.alloc(40000,19).toString('base64')}};
 await store.draft(doc);assert.ok(encoded.length);assert.ok(encoded.every(bytes=>bytes.byteLength===0));const loaded=await store.loadDraft(doc.id);assert.equal(loaded.text,doc.text);assert.equal(loaded.assets['assets/source.bin'],doc.assets['assets/source.bin']);
 fs.rename=async(from,to)=>{if(to===path.join(root,'Recovery',doc.id+'.wm'))throw Object.assign(Error('Injected recovery write failure'),{code:'EIO'});return rename(from,to);};
 await assert.rejects(store.draft({...doc,text:'Uncommitted edit'}),/Injected recovery write failure/);assert.ok(encoded.every(bytes=>bytes.byteLength===0));fs.rename=rename;assert.equal((await store.loadDraft(doc.id)).text,doc.text);
});
test('default recovery streams exact archive receipts and a failed publication preserves the prior draft without whole encoded output',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-streamed-recovery-')),recovery=path.join(root,'Recovery'),store=new NotesStore(path.join(root,'Notes'),recovery),encode=codec.encode,encodeFile=codec.encodeFile,rename=fs.rename,receipts=[];
 codec.encode=()=>assert.fail('default recovery materialized a complete encoded archive');codec.encodeFile=async(...args)=>{const receipt=await encodeFile.apply(codec,args);receipts.push(receipt);return receipt;};t.after(async()=>{codec.encode=encode;codec.encodeFile=encodeFile;fs.rename=rename;await fs.rm(root,{recursive:true,force:true});});
 const doc={id:'streamed-recovery',text:'Exact streamed recovery',assets:{'assets/source.bin':Buffer.alloc(40000,23).toString('base64')}},file=path.join(recovery,doc.id+'.wm');await store.draft(doc);const committed=await fs.readFile(file);assert.equal(receipts.length,1);assert.equal(receipts[0].committed,true);assert.equal(receipts[0].revision.sha256,createHash('sha256').update(committed).digest('hex'));assert.equal(receipts[0].revision.bytes,committed.length);assert.deepEqual((await store.loadDraft(doc.id)).assets,doc.assets);
 fs.rename=async(from,to)=>{if(to===file)throw Object.assign(Error('Injected streamed recovery publication failure'),{code:'EIO'});return rename(from,to);};await assert.rejects(store.draft({...doc,text:'Uncommitted streamed edit'}),/streamed recovery publication failure/);fs.rename=rename;assert.deepEqual(await fs.readFile(file),committed);assert.equal((await store.loadDraft(doc.id)).text,doc.text);assert.equal(receipts.length,2);assert.deepEqual((await fs.readdir(recovery)).sort(),[doc.id+'.json',doc.id+'.wm']);
});
