const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {replaceIfUnchanged}=require('../src/guarded-write.cjs');
const {createHash}=require('node:crypto');
const revision=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
test('the final save guard preserves edits arriving after the initial read',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-guard-'));try{
  const file=path.join(root,'note.md');await fs.writeFile(file,'original');const previous=await fs.readFile(file);
  await fs.writeFile(file,'external edit');await assert.rejects(replaceIfUnchanged(file,'local edit',previous),/changed while/);
  assert.equal(await fs.readFile(file,'utf8'),'external edit');assert.deepEqual(await fs.readdir(root),['note.md']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('large-file revision guards stream verification without reading the whole target again',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-digest-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'note.nm'),original=Buffer.alloc(1024*1024,17);await fs.writeFile(file,original);
 const read=fs.readFile;t.mock.method(fs,'readFile',async(target,...args)=>{assert.notEqual(target,file,'digest guard must not allocate another full-file buffer');return read(target,...args);});
 await replaceIfUnchanged(file,'saved',revision(original));assert.equal(await read(file,'utf8'),'saved');
 await assert.rejects(replaceIfUnchanged(file,'stale overwrite',revision(original)),/changed while/);assert.equal(await read(file,'utf8'),'saved');
});
test('digest guards reject a same-sized replacement published during streamed verification',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-stream-race-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'note.nm'),original=Buffer.alloc(256*1024,17),replacement=path.join(root,'external.nm');await fs.writeFile(file,original);await fs.writeFile(replacement,Buffer.alloc(original.length,23));
 const open=fs.open;let replaced=false;t.mock.method(fs,'open',async(target,...args)=>{const handle=await open(target,...args);if(target===file){const read=handle.read.bind(handle);handle.read=async(...parameters)=>{const result=await read(...parameters);if(!replaced){replaced=true;await fs.rename(replacement,file);}return result;};}return handle;});
 await assert.rejects(replaceIfUnchanged(file,'stale overwrite',revision(original)),/changed while/);assert.equal((await fs.readFile(file))[0],23);
});
test('concurrent windows cannot both commit against the same old revision',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-windows-'));try{
  const file=path.join(root,'note.nm');await fs.writeFile(file,'original');const previous=await fs.readFile(file);
  const results=await Promise.allSettled([replaceIfUnchanged(file,'first',previous),replaceIfUnchanged(file,'second',previous)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.ok(['first','second'].includes(await fs.readFile(file,'utf8')));assert.deepEqual(await fs.readdir(root),['note.nm']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('creating a file never overwrites an unexpected file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-create-'));try{
  const file=path.join(root,'note.txt');await fs.writeFile(file,'external');await assert.rejects(replaceIfUnchanged(file,'new',null),/changed while/);
  assert.equal(await fs.readFile(file,'utf8'),'external');await fs.unlink(file);await replaceIfUnchanged(file,'new',null);assert.equal(await fs.readFile(file,'utf8'),'new');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('a writable replacement sync failure preserves the original target before publication',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-sync-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'note.pdf');await fs.writeFile(file,'original');const open=fs.open;
 t.mock.method(fs,'open',async(target,...args)=>{const handle=await open(target,...args);if(String(target).endsWith('.tmp'))handle.sync=async()=>{throw Object.assign(Error('replacement sync failed'),{code:'EIO'})};return handle;});
 await assert.rejects(replaceIfUnchanged(file,'replacement',Buffer.from('original')),{code:'EIO'});assert.equal(await fs.readFile(file,'utf8'),'original');assert.deepEqual(await fs.readdir(root),['note.pdf']);
});
test('directory sync failure retains an exact committed result without replaying its callback',async t=>{
 if(process.platform==='win32')return;const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-directory-sync-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'note.pdf');await fs.writeFile(file,'original');const open=fs.open;let committed=0;
 t.mock.method(fs,'open',async(target,...args)=>{const handle=await open(target,...args);if(target===root)handle.sync=async()=>{throw Object.assign(Error('directory sync failed'),{code:'EIO'})};return handle;});
 await assert.rejects(replaceIfUnchanged(file,'replacement',Buffer.from('original'),{afterCommit:()=>committed++}),error=>error.code==='EIO'&&error.notemindFileCommitted===true);assert.equal(committed,1);assert.equal(await fs.readFile(file,'utf8'),'replacement');assert.deepEqual(await fs.readdir(root),['note.pdf']);
});
test('the final publication hook can cancel without replacing the target after verification',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-final-cancel-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'note.pdf');await fs.writeFile(file,'original');let committed=0;
 await assert.rejects(replaceIfUnchanged(file,'replacement',Buffer.from('original'),{beforeCommit(){throw Object.assign(Error('cancelled'),{name:'AbortError'})},afterCommit:()=>committed++}),{name:'AbortError'});assert.equal(committed,0);assert.equal(await fs.readFile(file,'utf8'),'original');assert.deepEqual(await fs.readdir(root),['note.pdf']);
});
