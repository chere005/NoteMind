const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');

async function withFileLock(file,run){
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
const sameBytes=(a,b)=>a===null?b===null:b!==null&&Buffer.from(a).equals(b);

// Prepare the replacement first, then compare again immediately before its atomic commit.
async function replaceIfUnchanged(file,bytes,expected,{afterCommit}={}){
 const temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});
 try{
  await fs.writeFile(temp,bytes,{flag:'wx'});
  await withFileLock(file,async()=>{
   if(!sameBytes(expected,await readExisting(file)))throw Error('The file changed while it was being saved. Your draft is safe. Reopen it or use Save As to keep both.');
   await fs.rename(temp,file);
   await afterCommit?.();
  });
 }finally{await fs.unlink(temp).catch(()=>{});}
}

module.exports={withFileLock,replaceIfUnchanged,readExisting};
