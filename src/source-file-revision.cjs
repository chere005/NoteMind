const fs=require('node:fs/promises'),{constants}=require('node:fs'),{createHash}=require('node:crypto');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
async function sourceFileRevision(file,{maxBytes=384*1024*1024,onChunk}={}){
 let handle;try{handle=await fs.open(file,constants.O_RDONLY|(constants.O_NONBLOCK||0));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 try{
  const before=await handle.stat({bigint:true});if(!before.isFile())throw Error('The save target is not a regular file.');if(before.size>BigInt(maxBytes))throw Error('The existing Notepad is too large to save safely.');
  const chunk=Buffer.allocUnsafe(256*1024),hash=createHash('sha256');let position=0;
  for(;;){const {bytesRead}=await handle.read(chunk,0,chunk.length,position);if(!bytesRead)break;position+=bytesRead;if(position>maxBytes)throw Error('The existing Notepad is too large to save safely.');hash.update(chunk.subarray(0,bytesRead));if(onChunk)await onChunk(position);}
  const after=await handle.stat({bigint:true}),named=await fs.stat(file,{bigint:true});if(position!==Number(before.size)||!same(before,after)||!same(after,named))throw Error('The file changed while its save revision was being read.');
  return {sha256:hash.digest('hex'),bytes:position};
 }finally{await handle.close();}
}
module.exports={sourceFileRevision};
