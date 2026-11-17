const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{NotesStore}=require('../src/notes-store.cjs');
test('unchanged version checks and no-op library transactions do not rewrite the index',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-history-dedupe-')),store=new NotesStore(root),rename=fs.rename;let writes=0;
 t.after(()=>fs.rm(root,{recursive:true,force:true}));t.mock.method(fs,'rename',async(from,to)=>{if(to===path.join(root,'index.json'))writes++;return rename(from,to)});
 const doc=await store.register({text:'before',assets:{},meta:{}});await store.version(doc);assert.equal((await store.versions(doc.id)).length,1);writes=0;
 await store.version(doc,'Before save');await store.register(doc);await store.transaction(()=>{});await store.version({...doc,id:'not-registered'});assert.equal(writes,0);
 await store.version({...doc,text:'after'});assert.equal(writes,1);const history=await store.versions(doc.id);assert.equal(history.length,2);
 assert.equal((await store.versionDoc(doc.id,history[0].id)).text,'before');assert.equal((await store.versionDoc(doc.id,history[1].id)).text,'after');
});
