const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');

async function withFileLock(file,run){
 return require('./native-file-lock.cjs').runWithNativeLock(file,()=>withPortableFileLock(file,run));
}

async function withPortableFileLock(file,run){
 const lock=file+'.notemind-lock',candidate=lock+'-'+randomUUID();let acquired=false,ownerStat;
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(candidate,JSON.stringify({pid:process.pid}),{flag:'wx'});
 try{
  ownerStat=await fs.stat(candidate);
  for(let n=0;n<250;n++){
   try{await fs.link(candidate,lock);acquired=true;break;}
   catch(error){
    if(error.code!=='EEXIST')throw error;
    const stat=await fs.stat(lock).catch(()=>null);let dead=false;
    try{const owner=JSON.parse(await fs.readFile(lock,'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('Invalid owner');try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')dead=true;}}
    catch{dead=!!stat&&Date.now()-stat.mtimeMs>1000;}
    if(dead&&stat){const current=await fs.stat(lock).catch(()=>null);if(current&&current.ino===stat.ino&&current.dev===stat.dev)await fs.unlink(lock).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  }
  if(!acquired)throw Error('This file is being saved in another window. Your draft is safe.');
  return await run();
 }finally{await fs.unlink(candidate).catch(()=>{});if(acquired){const current=await fs.stat(lock).catch(()=>null);if(current&&current.ino===ownerStat?.ino&&current.dev===ownerStat?.dev)await fs.unlink(lock).catch(()=>{});}}
}

async function readExisting(file){try{return await fs.readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const sameBytes=(a,b)=>a===null?b===null:b!==null&&(Buffer.isBuffer(a)?a:Buffer.from(a)).equals(b);
async function matchesExisting(file,expected){
 if(expected===null){try{await fs.lstat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
 if(Buffer.isBuffer(expected)||ArrayBuffer.isView(expected)||expected instanceof ArrayBuffer)return sameBytes(expected,await readExisting(file));
 if(!expected||typeof expected!=='object')throw Error('Invalid expected file revision.');
 if(!Number.isSafeInteger(expected.bytes)||expected.bytes<0||typeof expected.sha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.sha256))throw Error('Invalid expected file revision.');
 const current=await fingerprintFile(file);return current!==null&&current.bytes===expected.bytes&&current.sha256===expected.sha256;
}
async function fingerprintFile(file){
 let handle;try{handle=await fs.open(file,'r');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 try{
  const before=await handle.stat();if(!before.isFile())throw Error('This file is not a regular document.');
  const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(128*1024);let total=0;
  for(;;){const {bytesRead}=await handle.read(chunk,0,chunk.length,null);if(!bytesRead)break;hash.update(chunk.subarray(0,bytesRead));total+=bytesRead;}
  const after=await handle.stat(),named=await fs.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!named||named.dev!==after.dev||named.ino!==after.ino||total!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('The file changed while it was being saved. Your draft is safe. Reopen it or use Save As to keep both.');
  return {bytes:total,sha256:hash.digest('hex')};
 }finally{await handle.close();}
}

// Prepare the replacement first, then compare again immediately before its atomic commit.
async function replaceIfUnchanged(file,bytes,expected,{beforeCommit,afterCommit}={}){
 const temp=file+'.'+randomUUID()+'.tmp';let committed=false;await fs.mkdir(path.dirname(file),{recursive:true});
 try{
  const handle=await fs.open(temp,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await withFileLock(file,async()=>{
   if(!await matchesExisting(file,expected))throw Error('The file changed while it was being saved. Your draft is safe. Reopen it or use Save As to keep both.');
   // The final cancellation fence is synchronous; verification remains the
   // last asynchronous operation before the atomic publication.
   beforeCommit?.();
   await fs.rename(temp,file);
   committed=true;
   const failures=[];try{await afterCommit?.();}catch(error){failures.push(error);}try{await require('./fs-durability.cjs').syncDirectory(path.dirname(file));}catch(error){failures.push(error);}if(failures.length)throw failures.length===1?failures[0]:new AggregateError(failures,'The file was saved, but final durability or metadata work could not finish.');
  });
 }catch(error){if(committed){if(!(error instanceof Error))error=Error(String(error));error.notemindFileCommitted=true;}throw error;
 }finally{await fs.unlink(temp).catch(()=>{});}
}

module.exports={withFileLock,replaceIfUnchanged,readExisting,fingerprintFile};
