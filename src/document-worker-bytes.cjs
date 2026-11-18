const {isRawAsset}=require('./document-asset-sessions.cjs'),{isMarkedAsUntransferable}=require('node:worker_threads');
const {types}=require('node:util');
const CHUNK=196608,LIMIT=150*1024*1024,task=()=>new Promise(setImmediate);
const expression=(name,args)=>'window.documentTools['+JSON.stringify(name)+']('+args.map(value=>JSON.stringify(value)??'undefined').join(',')+')';
const bytesExpression=(name,args)=>'window.NoteMindDocumentBytes['+JSON.stringify(name)+']('+args.map(value=>JSON.stringify(value)??'undefined').join(',')+')';
const abort=signal=>{if(signal?.aborted)throw Object.assign(Error('Conversion cancelled.'),{name:'AbortError'})};
async function executeBytes(execute,name,args,{signal,yieldTask=task,binaryOutput=false}={}){
 // Renderer exit proves nothing about a Main receiver: keep admission held
 // through any failed detach, and ACK only after that exact backing is gone.
 const receiverFailure={error:null};
 const retireOwned=async bytes=>{while(bytes?.byteLength){try{if(bytes.byteOffset||bytes.byteLength!==bytes.buffer.byteLength||isMarkedAsUntransferable?.(bytes.buffer)||typeof bytes.buffer.transfer!=='function')throw Error('Private document receiver backing cannot be released.');bytes.buffer.transfer(0);if(bytes.byteLength)throw Error('Private document receiver backing was not released.');}catch(error){receiverFailure.error ||=error;await new Promise(resolve=>setTimeout(resolve,25));}}};
 const data=args[0],text=typeof data==='string'&&data.length>=1024*1024,stream=typeof data?.documentByteStream==='function';if(!text&&!stream&&!ArrayBuffer.isView(data))return execute(expression(name,args));const input=text||stream?null:Buffer.from(data.buffer,data.byteOffset,data.byteLength),length=stream?data.byteLength:text?data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0):input.length;if(!Number.isSafeInteger(length)||length<0||length>LIMIT)throw Error('Document conversion accepts up to 150 MB.');let id,published=false;const privateOutputs=[];
 try{abort(signal);id=await execute(bytesExpression('begin',[length]));const upload=async(at,chunk,end)=>{abort(signal);const received=await execute(bytesExpression('write',[id,at,chunk]));if(received!==end)throw Error('Document byte transfer was interrupted.');await yieldTask()};if(stream){let at=0;for await(const part of data.documentByteStream()){if(!ArrayBuffer.isView(part)||!part.byteLength||part.byteLength>CHUNK||at+part.byteLength>length)throw Error('Invalid document source chunk.');await upload(at,Buffer.from(part.buffer,part.byteOffset,part.byteLength).toString('base64'),at+part.byteLength);at+=part.byteLength;}if(at!==length)throw Error('Document source length changed.');}else for(let at=0;at<length;at+=CHUNK){const end=Math.min(length,at+CHUNK),chunk=text?data.slice(at/3*4,Math.min(data.length,(at+CHUNK)/3*4)):input.subarray(at,end).toString('base64');await upload(at,chunk,end)}abort(signal);const result=await execute(expression(name,[{documentByteInput:id},...args.slice(1)]));let total=0,outputs=0;
  const validChunk=chunk=>typeof chunk==='string'&&chunk.length<=128&&chunk.startsWith(id+':')&&/^[1-9][0-9]*$/.test(chunk.slice(id.length+1))&&Number.isSafeInteger(Number(chunk.slice(id.length+1)));
  const collect=async value=>{
   if(!value||typeof value!=='object')return value;
   if(typeof value.documentByteOutput==='string'){
    if(!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>LIMIT||(total+=value.bytes)>LIMIT||++outputs>1000)throw Error('Document output exceeds its limit.');
    const bytes=Buffer.allocUnsafeSlow(value.bytes);privateOutputs.push(bytes);
    for(let at=0;at<bytes.length;){
     abort(signal);const part=await execute(bytesExpression(binaryOutput?'readBinary':'read',[id,value.documentByteOutput,at]));
     if(binaryOutput){
      const chunk=part?.data;
      // This opt-in protocol alone supplies fresh receiver-owned complete views.
      // Reject pooled/shared/partial backings rather than detaching a borrower.
      if(!ArrayBuffer.isView(chunk)||chunk.BYTES_PER_ELEMENT!==1||!types.isArrayBuffer(chunk.buffer)||chunk.byteOffset||chunk.byteLength!==chunk.buffer.byteLength||!chunk.byteLength||chunk.byteLength>CHUNK||isMarkedAsUntransferable?.(chunk.buffer))throw Error('Invalid private document receiver backing.');
      try{
       if(part.offset!==at||!Number.isSafeInteger(part.bytes)||part.bytes!==chunk.byteLength||at+part.bytes>bytes.length||!validChunk(part.chunk))throw Error('Document binary output transfer was interrupted.');
       abort(signal);bytes.set(chunk,at);at+=chunk.byteLength;
      }finally{
       await retireOwned(chunk);
       if(!validChunk(part.chunk))throw Error('Private document chunk acknowledgement is unavailable.');
       if(await execute(bytesExpression('ackBinary',[id,part.chunk]))!==true)throw Error('Private document chunk acknowledgement was interrupted.');
       if(receiverFailure.error)throw Error('Private document receiver cleanup required a retry.',{cause:receiverFailure.error});
      }
     }else{
      if(part.offset!==at||!Number.isSafeInteger(part.bytes)||part.bytes<=0||part.bytes>CHUNK||at+part.bytes>bytes.length||typeof part.data!=='string'||part.data.length>CHUNK/3*4)throw Error('Document output transfer was interrupted.');
      const chunk=Buffer.from(part.data,'base64');try{if(chunk.length!==part.bytes)throw Error('Document output transfer was interrupted.');chunk.copy(bytes,at);at+=chunk.length;}finally{if(!chunk.byteOffset&&chunk.byteLength===chunk.buffer.byteLength&&!isMarkedAsUntransferable?.(chunk.buffer))try{chunk.buffer.transfer?.(0)}catch{}}
     }
     await yieldTask();
    }
    return bytes;
   }
   if(Array.isArray(value)){const out=[];for(const item of value)out.push(await collect(item));return out;}
   const out={};for(const[key,item]of Object.entries(value))Object.defineProperty(out,key,{value:await collect(item),enumerable:true,writable:true,configurable:true});return out;
  };
  const value=await collect(result);published=true;return value;
 }finally{
  const discardOutputs=async()=>{for(const bytes of privateOutputs)if(bytes.byteLength){if(binaryOutput)await retireOwned(bytes);else if(typeof bytes.buffer.transfer==='function')try{bytes.buffer.transfer(0)}catch{}}};
  if(!published)await discardOutputs();
  if(id)try{const receipt=await execute(bytesExpression('release',[id]));if(binaryOutput&&receipt!==undefined)throw Error('Invalid document byte release acknowledgement.');}
  catch(error){if(binaryOutput){await discardOutputs();throw Object.assign(Error('Private document byte cleanup is unconfirmed.'),{code:'DOCUMENT_BYTES_RELEASE_UNCONFIRMED',resourcesReleased:false,cause:error});}}

 }

}
async function withInput(data,run,codec=require('./archive-codec.cjs')){return isRawAsset(data)?codec.withRawAssetBytes(data,bytes=>run(bytes)):run(data)}
function base64(bytes){let value='';for(let at=0;at<bytes.length;at+=CHUNK)value+=bytes.subarray(at,Math.min(bytes.length,at+CHUNK)).toString('base64');return value}
module.exports={executeBytes,withInput,base64,expression,CHUNK};
