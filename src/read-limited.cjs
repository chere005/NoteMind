const fs=require('node:fs'),fsp=require('node:fs/promises');
// Check before allocating, and enforce the same limit while reading if the file grows.
async function readLimited(file,maxBytes,message,{signal}={}){
 signal?.throwIfAborted();
 const size=(await fsp.stat(file)).size;if(size>maxBytes)throw Error(message);
 // Fill one owned allocation instead of retaining every chunk beside a final full-size concat.
 let data=Buffer.allocUnsafeSlow(size),total=0;
 for await(const chunk of fs.createReadStream(file,{signal,highWaterMark:64*1024})){
  const next=total+chunk.length;if(next>maxBytes)throw Error(message);
  if(next>data.length){const capacity=Math.min(maxBytes,Math.max(next,data.length*2,Math.min(1024*1024,maxBytes))),grown=Buffer.allocUnsafeSlow(capacity);data.copy(grown,0,0,total);data=grown;}
  chunk.copy(data,total);total=next;
 }
 if(total===data.length)return data;const exact=Buffer.allocUnsafeSlow(total);data.copy(exact,0,0,total);return exact;
}
module.exports={readLimited};
