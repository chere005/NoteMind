const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{readLimited}=require('../src/read-limited.cjs');
test('oversized imports are rejected before allocating their contents; exact-limit files roundtrip',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-input-limit-'));try{
  const file=path.join(root,'large.pdf'),handle=await fs.open(file,'w');await handle.truncate(1024*1024*1024);await handle.close();
  await assert.rejects(readLimited(file,1024,'Too large'),/Too large/);
  const data=Buffer.alloc(65536,7);await fs.writeFile(file,data);assert.deepEqual(await readLimited(file,data.length,'Too large'),data);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('cancelling an active read closes its stream',async()=>{
 const native=require('node:fs'),create=native.createReadStream,root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-abort-input-'));let stream;
 try{
  const file=path.join(root,'input.pdf'),controller=new AbortController();await fs.writeFile(file,Buffer.alloc(1024*1024));
  native.createReadStream=(...args)=>{stream=create(...args);stream.once('data',()=>controller.abort());return stream};
  await assert.rejects(readLimited(file,1024*1024,'Too large',{signal:controller.signal}),{name:'AbortError'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stream.destroyed,true);assert.equal(stream.closed,true);
 }finally{native.createReadStream=create;await fs.rm(root,{recursive:true,force:true});}
});
test('limits remain enforced after the initial size check and aborts do not leave reads pending',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-growing-input-')),stat=fs.stat;try{
  const file=path.join(root,'growing.pdf');await fs.writeFile(file,Buffer.alloc(1024*1024));fs.stat=async()=>({size:1});
  await assert.rejects(readLimited(file,65536,'Grew too large'),/Grew too large/);
  const controller=new AbortController();controller.abort();await assert.rejects(readLimited(file,1024*1024,'Too large',{signal:controller.signal}),{name:'AbortError'});
 }finally{fs.stat=stat;await fs.rm(root,{recursive:true,force:true});}
});
