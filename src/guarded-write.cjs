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
 if(!expected||Buffer.isBuffer(expected)||ArrayBuffer.isView(expected)||expected instanceof ArrayBuffer)return sameBytes(expected,await readExisting(file));
 if(!Number.isSafeInteger(expected.bytes)||expected.bytes<0||typeof expected.sha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.sha256))throw Error('Invalid expected file revision.');
 let handle;try{handle=await fs.open(file,'r');}catch(error){if(error.code==='ENOENT')return false;throw error;}
 try{
  const before=await handle.stat();if(!before.isFile()||before.size!==expected.bytes)return false;
  const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(128*1024);let total=0;
  for(;;){const {bytesRead}=await handle.read(chunk,0,chunk.length,null);if(!bytesRead)break;hash.update(chunk.subarray(0,bytesRead));total+=bytesRead;if(total>expected.bytes)return false;}
  const after=await handle.stat(),named=await fs.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});return named&&named.dev===after.dev&&named.ino===after.ino&&total===expected.bytes&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&hash.digest('hex')===expected.sha256;
 }finally{await handle.close();}
}

// Prepare the replacement first, then compare again immediately before its atomic commit.
async function replaceIfUnchanged(file,bytes,expected,{afterCommit}={}){
 const temp=file+'.'+randomUUID()+'.tmp';let committed=false;await fs.mkdir(path.dirname(file),{recursive:true});
 try{
  await fs.writeFile(temp,bytes,{flag:'wx'});
  await withFileLock(file,async()=>{
   if(!await matchesExisting(file,expected))throw Error('The file changed while it was being saved. Your draft is safe. Reopen it or use Save As to keep both.');
   await fs.rename(temp,file);
   committed=true;
   await afterCommit?.();
  });
 }catch(error){if(committed){if(!(error instanceof Error))error=Error(String(error));error.notemindFileCommitted=true;}throw error;
 }finally{await fs.unlink(temp).catch(()=>{});}
}

module.exports={withFileLock,replaceIfUnchanged,readExisting};
