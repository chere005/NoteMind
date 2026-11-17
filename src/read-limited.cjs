const fs=require('node:fs/promises');
const CHUNK=64*1024;
function discard(bytes){if(bytes?.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&bytes.buffer.byteLength&&typeof bytes.buffer.transfer==='function')try{bytes.buffer.transfer(0);}catch{}}
async function resize(data,size,total,signal){
 const next=Buffer.allocUnsafeSlow(size);
 try{for(let at=0;at<total;at+=CHUNK){signal?.throwIfAborted();data.copy(next,at,at,Math.min(total,at+CHUNK));await new Promise(setImmediate);}signal?.throwIfAborted();}
 catch(error){discard(next);throw error;}
 discard(data);return next;
}
// The opened file fills one private allocation directly; growth and shrink
// replace it only when needed, without retaining superseded backing stores.
async function readLimited(file,maxBytes,message,{signal}={}){
 signal?.throwIfAborted();
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw RangeError('Invalid file size limit.');
 let handle,data,probe,failed=false;
 try{
  handle=await fs.open(file,'r');signal?.throwIfAborted();
  const size=async()=>{const stat=await handle.stat({bigint:true});signal?.throwIfAborted();if(!stat.isFile())throw Error('The input is not a regular file.');if(stat.size>BigInt(maxBytes))throw Error(message);return Number(stat.size);};
  data=Buffer.allocUnsafeSlow(await size());let total=0;
  for(;;){
   signal?.throwIfAborted();
   if(total===data.length){
    const current=await size();
    if(current>total){data=await resize(data,Math.min(maxBytes,Math.max(current,total+1,data.length*2)),total,signal);continue;}
    probe ||=Buffer.allocUnsafeSlow(1);const {bytesRead}=await handle.read(probe,0,1,total);signal?.throwIfAborted();if(bytesRead!==0&&bytesRead!==1)throw Error('Invalid file read length.');
    if(!bytesRead){if(await size()>total)continue;break;}
    if(total===maxBytes)throw Error(message);
    data=await resize(data,Math.min(maxBytes,Math.max(total+1,data.length*2,Math.min(1024*1024,maxBytes))),total,signal);data[total++]=probe[0];
   }
   const {bytesRead}=await handle.read(data,total,Math.min(CHUNK,data.length-total),total);signal?.throwIfAborted();
   if(!Number.isSafeInteger(bytesRead)||bytesRead<0||bytesRead>Math.min(CHUNK,data.length-total))throw Error('Invalid file read length.');
   if(!bytesRead){if(await size()>total)continue;break;}total+=bytesRead;
  }
  if(total!==data.length)data=await resize(data,total,total,signal);
  signal?.throwIfAborted();
 }catch(error){failed=true;throw error;}
 finally{discard(probe);if(failed)discard(data);try{await handle?.close();}catch(error){if(!failed){discard(data);throw error;}}}
 try{signal?.throwIfAborted();}catch(error){discard(data);throw error;}return data;
}
module.exports={readLimited};
