// Installed only by Main into the initiating page. The persistent worker's
// framework belongs to that page; each byte/bitmap/canvas owner is acknowledged.
function installImageIndexRasterHost(key,workerURL,makeBytes){
 if(Object.hasOwn(window,key))throw Error('Image conversion host already exists.');
 const bytes=makeBytes({entryLimit:50*1024*1024,limit:100*1024*1024,consumeOwned:true}),worker=new Worker(workerURL),jobs=new Map();let serial=0,active=null,broken=null,cancelledNonce=null;
 const error=value=>Object.assign(Error(value?.message||'Image conversion failed.'),{name:value?.name||'Error',code:value?.code});
 worker.onmessage=event=>{const packet=event.data,job=jobs.get(packet?.id);if(!job||active!==job){try{packet?.bytes?.transfer?.(0)}catch{}return;}
  if(packet.released!==true){broken=Error('Image conversion resources have not been released.');job.reject(broken);return;}
  jobs.delete(job.id);active=null;job.drain();
  if(packet.error){try{packet.bytes?.transfer?.(0)}catch{}job.reject(error(packet.error));return;}
  if(!(packet.bytes instanceof ArrayBuffer)||!packet.bytes.byteLength||packet.bytes.byteLength>50*1024*1024||!Number.isSafeInteger(packet.width)||packet.width<1||!Number.isSafeInteger(packet.height)||packet.height<1||packet.width>2400||packet.height>2400||(packet.pixels===true)!==job.pixels||job.pixels&&packet.bytes.byteLength!==packet.width*packet.height*4){try{packet.bytes?.transfer?.(0)}catch{}job.reject(Error('Invalid image conversion output.'));return;}
  try{job.resolve({data:bytes.publishOwned(job.owner,packet.bytes),width:packet.width,height:packet.height,...job.pixels?{pixels:true}:{}});}catch(failure){try{packet.bytes.transfer?.(0)}catch{}job.reject(failure);}
 };
 worker.onerror=event=>{broken=Error(event.message||'Image conversion worker stopped.');active?.reject(broken);};
 const image=(nonce,pixels,input,type,clean,maxDimension,dimensions)=>{
  if(broken)throw broken;if(active)throw Error('An image conversion is already active.');if(cancelledNonce===nonce)throw Object.assign(Error('Image conversion cancelled.'),{name:'AbortError'});
  const owned=bytes.take(input);if(!owned||owned.bytes.byteOffset||owned.bytes.byteLength!==owned.bytes.buffer.byteLength)throw Error('Invalid private image conversion input.');
  const id=++serial;if(!Number.isSafeInteger(id))throw Error('Image conversion request limit reached.');
  let resolve,reject,drain;const result=new Promise((yes,no)=>{resolve=yes;reject=no}),drained=new Promise(yes=>drain=yes),job={id,nonce,pixels,owner:owned.owner,resolve,reject,drain,drained};jobs.set(id,job);active=job;
  try{worker.postMessage({id,bytes:owned.bytes.buffer,type,clean,maxDimension,dimensions,pixels},[owned.bytes.buffer]);}
  catch(failure){try{owned.bytes.buffer.transfer?.(0)}catch{}if(owned.bytes.byteLength){broken=failure;reject(failure);}else{jobs.delete(id);active=null;drain();reject(failure);}}
  return result;
 };
 const tools=nonce=>({image:(...args)=>image(nonce,false,...args),imagePixels:(...args)=>image(nonce,true,...args)});
 const cancel=nonce=>{cancelledNonce=nonce;if(active?.nonce===nonce)worker.postMessage({cancel:active.id});};
 const drain=nonce=>active?.nonce===nonce?active.drained:Promise.resolve();
 const state=Object.freeze({bytes,tools,cancel,drain,stats:()=>({persistentContexts:1,active:!!active,broken:!!broken,...bytes.stats()})});Object.defineProperty(window,key,{value:state,configurable:true});
 return true;
}
if(typeof module==='object'&&module.exports)module.exports={installImageIndexRasterHost};
