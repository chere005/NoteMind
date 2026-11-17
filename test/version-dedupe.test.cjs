const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),format=require('../src/notepad-format.cjs'),{NotesStore}=require('../src/notes-store.cjs');
test('unchanged version checks skip archive encoding and retain distinct history',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-history-dedupe-')),store=new NotesStore(root),encode=format.encode;let calls=0;
 format.encode=(...args)=>{calls++;return encode(...args)};
 try{
  const doc=await store.register({text:'before',assets:{},meta:{}});await store.version(doc);assert.equal(calls,1);
  await store.version(doc,'Before save');assert.equal(calls,1);assert.equal((await store.versions(doc.id)).length,1);
  await store.version({...doc,text:'after'});assert.equal(calls,2);const history=await store.versions(doc.id);assert.equal(history.length,2);
  assert.equal((await store.versionDoc(doc.id,history[0].id)).text,'before');assert.equal((await store.versionDoc(doc.id,history[1].id)).text,'after');
  await store.version({...doc,id:'not-registered'});assert.equal(calls,2);
 }finally{format.encode=encode;await fs.rm(root,{recursive:true,force:true});}
});
