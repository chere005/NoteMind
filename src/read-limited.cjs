const fs=require('node:fs'),fsp=require('node:fs/promises');
// Check before allocating, and enforce the same limit while reading if the file grows.
async function readLimited(file,maxBytes,message,{signal}={}){
 signal?.throwIfAborted();
 if((await fsp.stat(file)).size>maxBytes)throw Error(message);
 const chunks=[];let total=0;
 for await(const chunk of fs.createReadStream(file,{signal,highWaterMark:64*1024})){
  total+=chunk.length;if(total>maxBytes)throw Error(message);chunks.push(chunk);
 }
 return Buffer.concat(chunks,total);
}
module.exports={readLimited};
