// Diagnostic preparation only: hash an immutable fixture with one owned backing.
const filesystem=require('node:fs/promises'),{constants}=require('node:fs'),{createHash}=require('node:crypto');
const SCRATCH_BYTES=196608,identity=stat=>['dev','ino','size','mtimeNs','ctimeNs'].map(key=>String(stat[key])).join(':');
async function hashFixtureOwned(file,{fs=filesystem,signal,onScratch,digest,finalize=true}={}){
 let handle,scratch;const result={bytes:0,reads:0,scratchBytes:SCRATCH_BYTES,scratchAllocations:0,scratchDetached:false,fdClosed:false};
 const check=()=>{if(signal?.aborted)throw Object.assign(Error('Fixture hashing cancelled.'),{name:'AbortError'});};
 try{
  check();handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await handle.stat({bigint:true});if(!before.isFile()||before.size<0||before.size>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid fixture source.');const stamp=identity(before),size=Number(before.size),hash=digest||createHash('sha256');
  scratch=Buffer.allocUnsafeSlow(SCRATCH_BYTES);result.scratchAllocations++;onScratch?.(scratch.buffer);
  while(result.bytes<size){check();const {bytesRead}=await handle.read(scratch,0,Math.min(scratch.length,size-result.bytes),result.bytes);check();if(!bytesRead)throw Error('Fixture source was truncated.');hash.update(scratch.subarray(0,bytesRead));result.bytes+=bytesRead;result.reads++;}
  const [after,named]=await Promise.all([handle.stat({bigint:true}),fs.stat(file,{bigint:true})]);check();if(!after.isFile()||!named.isFile()||identity(after)!==stamp||identity(named)!==stamp)throw Error('Fixture source identity changed.');if(finalize)result.sha256=hash.digest('hex');return result;
 }finally{try{await handle?.close();result.fdClosed=!!handle;}finally{if(scratch?.buffer.byteLength)scratch.buffer.transfer(0);result.scratchDetached=!!scratch&&scratch.buffer.byteLength===0;}}
}
module.exports={hashFixtureOwned,SCRATCH_BYTES};
