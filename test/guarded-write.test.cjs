const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {replaceIfUnchanged}=require('../src/guarded-write.cjs');
test('the final save guard preserves edits arriving after the initial read',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-guard-'));try{
  const file=path.join(root,'note.md');await fs.writeFile(file,'original');const previous=await fs.readFile(file);
  await fs.writeFile(file,'external edit');await assert.rejects(replaceIfUnchanged(file,'local edit',previous),/changed while/);
  assert.equal(await fs.readFile(file,'utf8'),'external edit');assert.deepEqual(await fs.readdir(root),['note.md']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
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
