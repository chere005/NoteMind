// One disposable worker realm owns immutable Blob wrappers and the URLs derived from them.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={createProtocol:factory};else{const protocol=factory({post:value=>root.postMessage(value)});root.onmessage=event=>protocol.receive(event.data);}})(typeof self==='undefined'?this:self,function({post,BlobClass=Blob,urls=URL}={}){
 const jobs=new Map(),owned=new Set(),MAX_BYTES=199*1024*1024,CHUNK=196608;
 const discard=bytes=>{if(bytes?.byteLength&&bytes.buffer instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0)};
 function receive(packet){let input=packet?.data;
  try{
   if(!packet||!Number.isSafeInteger(packet.id)||packet.id<1)throw Error('Invalid picture worker request.');
   const {id,op}=packet;
   if(op==='begin'){
    if(jobs.has(id)||jobs.size>=16||!Number.isSafeInteger(packet.bytes)||packet.bytes<0||packet.bytes>MAX_BYTES||typeof packet.type!=='string'||packet.type.length>128)throw Error('Invalid picture source.');
    jobs.set(id,{bytes:packet.bytes,type:packet.type,received:0,parts:[]});post({id,ok:true});return;
   }
   if(op==='chunk'){
    const job=jobs.get(packet.job);if(!job||!(input instanceof Uint8Array)||!(input.buffer instanceof ArrayBuffer)||input.byteOffset!==0||input.byteLength!==input.buffer.byteLength||!input.byteLength||input.byteLength>CHUNK||packet.offset!==job.received||job.received+input.byteLength>job.bytes)throw Error('Invalid private picture chunk.');
    const length=input.byteLength;job.parts.push(new BlobClass([input]));job.received+=length;discard(input);input=null;post({id,received:job.received});return;
   }
   if(op==='finish'){
    const job=jobs.get(packet.job);if(!job||job.received!==job.bytes)throw Error('Incomplete picture source.');
    const blob=new BlobClass(job.parts,{type:job.type});if(blob.size!==job.bytes)throw Error('Picture source length changed.');
    const url=urls.createObjectURL(blob);owned.add(url);jobs.delete(packet.job);post({id,url,bytes:blob.size});return;
   }
   if(op==='cancel'){jobs.delete(packet.job);post({id,ok:true});return;}
   if(op==='release'){if(!owned.delete(packet.url))throw Error('Picture URL belongs to another owner.');urls.revokeObjectURL(packet.url);post({id,ok:true});return;}
   throw Error('Invalid picture worker operation.');
  }catch(error){if(Number.isSafeInteger(packet?.job))jobs.delete(packet.job);post({id:packet?.id,error:error.message});}
  finally{discard(input);}
 }
 return{receive,stats:()=>({pending:jobs.size,urls:owned.size})};
});
