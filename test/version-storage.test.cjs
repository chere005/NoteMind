const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const {NotesStore}=require('../src/notes-store.cjs'),codec=require('../src/archive-codec.cjs'),snapshots=require('../src/snapshot-store.cjs'),format=require('../src/notepad-format.cjs'),markdown=require('../src/markdown-files.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-version-storage-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new NotesStore(root),doc=await store.register({text:'A',assets:{'assets/a.bin':randomBytes(32*1024).toString('base64')},meta:{tags:['test']}});return {root,store,doc};}
test('version history stores unchanged assets once and reads both old archives and new snapshots',async t=>{
 const {root,store,doc}=await fixture(t),canonical=markdown.canonical(doc),legacyFile=path.join(root,'versions','legacy.wm'),bytes=format.encode(canonical);await fs.mkdir(path.dirname(legacyFile),{recursive:true});await fs.writeFile(legacyFile,bytes);
 await store.transaction(index=>index.records[doc.id].versions=[{id:'legacy',label:'Old archive',created:'2026-01-01',hash:hash(JSON.stringify({text:canonical.text,assets:canonical.assets,meta:canonical.meta}))}]);
 await store.version(doc,'Unchanged old archive');assert.equal((await store.versions(doc.id)).length,1);assert.deepEqual(await store.versionDoc(doc.id,'legacy'),{text:canonical.text,assets:canonical.assets,id:canonical.id,title:canonical.title,meta:canonical.meta,created:canonical.created});
 for(let i=0;i<5;i++)await store.version({...doc,text:'Edit '+i},'Autosaved');const history=await store.versions(doc.id);assert.equal(history.length,6);assert.ok(history.slice(1).every(entry=>entry.storage==='snapshot-v1'));
 const current=new NotesStore(root);for(const [i,entry]of history.slice(1).entries()){const restored=await current.versionDoc(doc.id,entry.id);assert.equal(restored.text,'Edit '+i);assert.deepEqual(restored.assets,doc.assets);}
 assert.deepEqual(await fs.readFile(legacyFile),bytes);const folders=await fs.readdir(path.join(root,'objects')),objects=(await Promise.all(folders.map(folder=>fs.readdir(path.join(root,'objects',folder))))).flat();assert.equal(objects.length,1);
 const newFiles=(await fs.readdir(path.join(root,'versions'))).filter(file=>file.endsWith('.snapshot.json')),manifestBytes=(await Promise.all(newFiles.map(file=>fs.stat(path.join(root,'versions',file))))).reduce((n,s)=>n+s.size,0);assert.ok(manifestBytes<5000,'text edits retain compact manifests rather than duplicate the 32 KiB asset');
});
test('version preparation releases the library lock and preserves per-note call order',async t=>{
 const {store,doc}=await fixture(t),other=await store.register({text:'Other',assets:{}});let release,reached,seen=[];const gate=new Promise(resolve=>release=resolve),paused=new Promise(resolve=>reached=resolve),prepare=codec.publishVersion.bind(codec);
 t.mock.method(codec,'publishVersion',async(value,options)=>{seen.push(value.text);if(value.text==='First'){reached();await gate;}return prepare(value,options)});
 const first=store.version({...doc,text:'First'}),second=store.version({...doc,text:'Second'});await paused;
 let timer;try{assert.equal(await Promise.race([store.patch(other.id,{tags:['responsive']}).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),2000)})]),true,'unrelated library operations continue while snapshot work is pending');assert.deepEqual(seen,['First']);}
 finally{clearTimeout(timer);release();await Promise.all([first,second]);}
 const history=await store.versions(doc.id);assert.deepEqual(await Promise.all(history.map(async entry=>(await store.versionDoc(doc.id,entry.id)).text)),['First','Second']);assert.equal(store.versionPending.size,0);
});
test('an unchanged preparation retries if another instance commits different content before its final check',async t=>{
 const {root,store,doc}=await fixture(t);await store.version(doc);const other=new NotesStore(root),prepare=codec.publishVersion.bind(codec);let paused=false,release,reached;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>reached=resolve);
 t.mock.method(codec,'publishVersion',async(value,options)=>{const prepared=await prepare(value,options);if(value.text==='A'&&!paused){paused=true;reached();await gate;}return prepared});
 const returning=store.version(doc);await started;try{await other.version({...doc,text:'B'});}finally{release();}await returning;
 const history=await store.versions(doc.id);assert.deepEqual(await Promise.all(history.map(async entry=>(await store.versionDoc(doc.id,entry.id)).text)),['A','B','A']);
});
test('failed snapshot publication cannot add an unreadable history entry or modify earlier versions',async t=>{
 const {root,store,doc}=await fixture(t);await store.version(doc);const before=await fs.readFile(path.join(root,'index.json')),original=(await store.versions(doc.id))[0],folder=path.join(root,'versions'),held=path.join(root,'versions-held');
 await fs.rename(folder,held);await fs.writeFile(folder,'interrupted destination');
 try{await assert.rejects(store.version({...doc,text:'New content',assets:{'assets/a.bin':Buffer.from('new asset').toString('base64')}}),/exist|directory|EEXIST/i);assert.deepEqual(await fs.readFile(path.join(root,'index.json')),before);assert.equal(store.versionPending.size,0);}
 finally{await fs.unlink(folder);await fs.rename(held,folder);}
 assert.equal((await store.versionDoc(doc.id,original.id)).text,'A');
});
test('title and creation metadata changes remain distinct versions even when body and images are unchanged',async t=>{
 const {store,doc}=await fixture(t);await store.version({...doc,title:'Original title',created:'2026-01-01'});await store.version({...doc,title:'Renamed title',created:'2026-01-01'});await store.version({...doc,title:'Renamed title',created:'2026-02-01'});
 const history=await store.versions(doc.id);assert.equal(history.length,3);const restored=await Promise.all(history.map(entry=>store.versionDoc(doc.id,entry.id)));assert.deepEqual(restored.map(value=>value.title),['Original title','Renamed title','Renamed title']);assert.deepEqual(restored.map(value=>value.created),['2026-01-01','2026-01-01','2026-02-01']);
});
test('title-only edits update the library modification time',async t=>{
 const {store,doc}=await fixture(t);await store.transaction(index=>index.records[doc.id].modified='2026-01-01T00:00:00.000Z');
 await store.register({...doc,title:'Renamed only'});const record=await store.record(doc.id);assert.equal(record.title,'Renamed only');assert.notEqual(record.modified,'2026-01-01T00:00:00.000Z');
});
test('legacy body-only fingerprints cannot hide a title-only rename during migration',async t=>{
 const {root,store,doc}=await fixture(t),old=markdown.canonical({...doc,title:'Old title'}),file=path.join(root,'versions','legacy-title.wm');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,format.encode(old));await store.transaction(index=>index.records[doc.id].versions=[{id:'legacy-title',hash:hash(JSON.stringify({text:old.text,assets:old.assets,meta:old.meta})),label:'Old',created:'2026-01-01'}]);
 await store.version({...doc,title:'New title'});const history=await store.versions(doc.id);assert.equal(history.length,2);assert.equal((await store.versionDoc(doc.id,history[0].id)).title,'Old title');assert.equal((await store.versionDoc(doc.id,history[1].id)).title,'New title');
});
test('stale known-object hints heal missing blobs from current verified source bytes',async t=>{
 const {root,store,doc}=await fixture(t);await store.version(doc);const initial=(await store.versions(doc.id))[0],manifest=JSON.parse(await fs.readFile(snapshots.manifestFile(root,initial.id))),ref=manifest.assets['assets/a.bin'];await fs.unlink(snapshots.objectFile(root,ref.hash));
 await store.version({...doc,text:'After cleanup'});const history=await store.versions(doc.id);assert.equal(history.length,2);assert.deepEqual((await store.versionDoc(doc.id,initial.id)).assets,doc.assets);assert.equal((await store.versionDoc(doc.id,history[1].id)).text,'After cleanup');
});
test('an unchanged history check repairs missing shared bytes without adding a redundant version',async t=>{
 const {root,store,doc}=await fixture(t);await store.version(doc);const initial=(await store.versions(doc.id))[0],manifest=JSON.parse(await fs.readFile(snapshots.manifestFile(root,initial.id))),ref=manifest.assets['assets/a.bin'];await fs.unlink(snapshots.objectFile(root,ref.hash));
 await store.version(doc);assert.equal((await store.versions(doc.id)).length,1);assert.deepEqual((await store.versionDoc(doc.id,initial.id)).assets,doc.assets);
});
