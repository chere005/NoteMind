const {parentPort}=require('node:worker_threads');
parentPort.once('message',async packet=>{
 const flag=packet?.cancel instanceof SharedArrayBuffer&&packet.cancel.byteLength===4?new Int32Array(packet.cancel):null;
 const check=()=>{if(!flag)throw Error('Word export cancellation ownership is missing.');if(Atomics.load(flag,0))throw Object.assign(Error('Word export cancelled.'),{name:'AbortError'});};
 try{
  check();if(!packet.doc||Object.keys(packet.doc.assets||{}).length||Object.values(packet.images||{}).some(image=>!image?.source))throw Error('Word packaging requires private media spools.');
  const value=await require('./word-file.cjs').exportWordFile(packet.doc,packet.images,packet.options,{...packet.target,check},{check});
  parentPort.postMessage({id:packet.id,value});
 }catch(error){parentPort.postMessage({id:packet?.id,error:{name:error.name,message:error.message,code:error.code,stack:error.stack}});}
 finally{parentPort.close();}
});
