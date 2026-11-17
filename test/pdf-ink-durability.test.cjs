const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {PDFInkStore,syncDirectory,atomic}=require('../src/pdf-ink-store.cjs');
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-pdf-durability-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
test('PDF directories share strict POSIX durability and explicit Windows capability',async()=>{
 for(const code of ['EINVAL','ENOTSUP','EISDIR','EPERM','EBADF','EIO']){
  const failure=Object.assign(Error(code),{code});let closed=0;
  await assert.rejects(syncDirectory('/private/pdf',{platform:'darwin',io:{open:async()=>({stat:async()=>({isDirectory:()=>true}),sync:async()=>{throw failure},close:async()=>closed++})}}),error=>error===failure);
  assert.equal(closed,1);
 }
 const result=await syncDirectory('C:\\PDF',{platform:'win32',io:{stat:async()=>({isDirectory:()=>true}),open:()=>assert.fail('Read-only Windows directory handle must not be flushed')}});
 assert.equal(result.unsupported,true);assert.equal(result.synced,false);
});
test('PDF atomic publication retains the old file when its writable inode sync fails',async t=>{
 const directory=await fixture(t),file=path.join(directory,'page.ink');await fs.writeFile(file,'old');const open=fs.open;
 fs.open=async(name,...args)=>{const handle=await open(name,...args);if(name.startsWith(file+'.')&&name.endsWith('.tmp'))handle.sync=async()=>{throw Object.assign(Error('inode sync'),{code:'EIO'})};return handle;};
 try{await assert.rejects(atomic(file,Buffer.from('new')),/inode sync/);assert.equal(await fs.readFile(file,'utf8'),'old');assert.deepEqual(await fs.readdir(directory),['page.ink']);}finally{fs.open=open;}
});
test('PDF atomic publication preserves a committed receipt when directory sync fails',async t=>{
 const directory=await fixture(t),file=path.join(directory,'page.ink'),open=fs.open;await fs.writeFile(file,'old');
 fs.open=async(name,...args)=>{const handle=await open(name,...args);if(name===directory)handle.sync=async()=>{throw Object.assign(Error('directory sync'),{code:'EPERM'})};return handle;};
 try{await assert.rejects(atomic(file,Buffer.from('new')),error=>error.code==='EPERM'&&error.notemindFileCommitted===true);assert.equal(await fs.readFile(file,'utf8'),'new');assert.deepEqual(await fs.readdir(directory),['page.ink']);}finally{fs.open=open;}
});
test('original PDF publication does not disguise destination durability failures as changed source bytes',async t=>{
 const directory=await fixture(t),originals=path.join(directory,'Originals'),source=path.join(directory,'source.pdf'),bytes=Buffer.from('%PDF-private-durability-fixture');await fs.mkdir(originals);await fs.writeFile(source,bytes);const hash=createHash('sha256').update(bytes).digest('hex'),open=fs.open,store=new PDFInkStore(directory);
 fs.open=async(name,...args)=>{const handle=await open(name,...args);if(name===originals)handle.sync=async()=>{throw Object.assign(Error('original directory sync'),{code:'EPERM'})};return handle;};
 try{await assert.rejects(store.ensureOriginal(hash,{sourcePath:source}),error=>error.code==='EPERM');assert.deepEqual(await fs.readFile(source),bytes);assert.deepEqual(await fs.readFile(store.original(hash)),bytes);}finally{fs.open=open;}
});
