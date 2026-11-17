const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{NotesStore}=require('../src/notes-store.cjs'),format=require('../src/notepad-format.cjs');
test('a crash between draft archive and companion commits cannot mark new unsaved content clean',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-draft-state-')),store=new NotesStore(root),rename=fs.rename;
 try{
  const saved=await store.draft({path:path.join(root,'original.nm'),text:'saved',assets:{},dirty:false,revision:'old'});const stateFile=path.join(store.recoveryRoot,saved.id+'.json');
  fs.rename=async(from,to)=>{if(to===stateFile)throw Object.assign(Error('interrupted state commit'),{code:'EIO'});return rename(from,to)};
  await assert.rejects(store.draft({...saved,text:'new unsaved writing',dirty:true,revision:'current'}),/interrupted/);fs.rename=rename;
  const recovered=await store.loadDraft(saved.id);assert.equal(recovered.text,'new unsaved writing');assert.equal(recovered.dirty,true);assert.equal(recovered.revision,'current');
  // Matching companion changes made by restore/move operations still apply.
  const archive=format.decode(await fs.readFile(path.join(store.recoveryRoot,saved.id+'.wm'))),state=JSON.parse(archive.files['recovery.json']);
  await fs.writeFile(stateFile,JSON.stringify({...state,revision:'restored revision'}));assert.equal((await store.loadDraft(saved.id)).revision,'restored revision');
 }finally{fs.rename=rename;await fs.rm(root,{recursive:true,force:true});}
});
test('older draft archives continue to use their recovery companion',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-legacy-draft-')),store=new NotesStore(root);
 try{
  const saved=await store.register({text:'legacy',assets:{}});await fs.mkdir(store.recoveryRoot,{recursive:true});
  await fs.writeFile(path.join(store.recoveryRoot,saved.id+'.wm'),format.encode(saved));await fs.writeFile(path.join(store.recoveryRoot,saved.id+'.json'),JSON.stringify({dirty:true,visual:false,revision:'legacy revision'}));
  const recovered=await store.loadDraft(saved.id);assert.equal(recovered.text,'legacy');assert.equal(recovered.dirty,true);assert.equal(recovered.visual,false);assert.equal(recovered.revision,'legacy revision');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
