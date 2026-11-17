const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const codec=require('../src/archive-codec.cjs'),{NotesStore}=require('../src/notes-store.cjs');
test('recovery archive writes retire acquired encoded output on success and failure while durable bytes stay exact',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-owned-recovery-')),store=new NotesStore(path.join(root,'Notes'),path.join(root,'Recovery')),encode=codec.encode.bind(codec),rename=fs.rename,encoded=[];
 codec.encode=async(...args)=>{const bytes=await encode(...args);encoded.push(bytes);return bytes;};
 t.after(async()=>{codec.encode=encode;fs.rename=rename;await codec.dispose();await fs.rm(root,{recursive:true,force:true});});
 const doc={id:'owned-recovery',text:'Original ink and picture',assets:{'assets/source.bin':Buffer.alloc(40000,19).toString('base64')}};
 await store.draft(doc);assert.ok(encoded.length);assert.ok(encoded.every(bytes=>bytes.byteLength===0));const loaded=await store.loadDraft(doc.id);assert.equal(loaded.text,doc.text);assert.equal(loaded.assets['assets/source.bin'],doc.assets['assets/source.bin']);
 fs.rename=async(from,to)=>{if(to===path.join(root,'Recovery',doc.id+'.wm'))throw Object.assign(Error('Injected recovery write failure'),{code:'EIO'});return rename(from,to);};
 await assert.rejects(store.draft({...doc,text:'Uncommitted edit'}),/Injected recovery write failure/);assert.ok(encoded.every(bytes=>bytes.byteLength===0));fs.rename=rename;assert.equal((await store.loadDraft(doc.id)).text,doc.text);
});
