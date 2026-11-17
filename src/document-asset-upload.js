(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={create:factory};else root.NoteMindAssetUpload={create:factory};})(typeof window==='undefined'?this:window,function(api,{yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 const CHUNK=262144,check=signal=>{if(signal?.aborted)throw Object.assign(Error('Document operation cancelled.'),{name:'AbortError'})};
 async function upload(name,data,chunks,{operation,signal}={}){
  check(signal);
  const pieces=chunks||[data],tail=pieces.at(-1);if(typeof data!=='string'||!data.length||data.length%4||typeof tail!=='string')throw Error('Invalid document asset.');const header={name,...(operation?{operation}:{}),chars:data.length,bytes:data.length/4*3-(tail.endsWith('==')?2:tail.endsWith('=')?1:0)},opened=await api.begin(header),handle=opened?.upload;if(typeof handle!=='string')throw Error('Could not prepare the document image.');let finished=false;
  const release=()=>Promise.resolve().then(()=>api.cancel(handle)).catch(()=>{});
  try{check(signal);let offset=0;for(const piece of pieces){if(typeof piece!=='string'||piece.length%4)throw Error('Invalid document image chunk.');for(let at=0;at<piece.length;at+=CHUNK){check(signal);const part=piece.slice(at,at+CHUNK),answer=await api.write(handle,{offset,data:part});if(answer?.received!==offset+part.length)throw Error('The document image upload was interrupted.');offset+=part.length;await yieldTask()}}check(signal);if(offset!==data.length)throw Error('Incomplete document image.');const answer=await api.finish(handle);if(typeof answer?.token!=='string')throw Error('The document image was not accepted.');check(signal);finished=true;return{token:answer.token,release};}finally{if(!finished)await release()}
 }
 const privateBytes=bytes=>ArrayBuffer.isView(bytes)&&Object.prototype.toString.call(bytes)==='[object Uint8Array]'&&Object.prototype.toString.call(bytes.buffer)==='[object ArrayBuffer]'&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength;
 const discard=bytes=>{if(privateBytes(bytes)&&typeof bytes.buffer.transfer==='function')try{bytes.buffer.transfer(0)}catch{}};
 const base64=bytes=>{if(typeof bytes.toBase64==='function')return bytes.toBase64();let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(binary)};
 async function pull(transfer,token,info,{signal}={}){
  check(signal);
  if(typeof transfer!=='string'||!Number.isSafeInteger(info?.bytes)||info.bytes<0||!Number.isSafeInteger(info?.chars)||info.chars!==4*Math.ceil(info.bytes/3))throw Error('Invalid returned document image.');const chunks=[],owned=typeof api.ack==='function';let offset=0,chars=0;while(offset<info.bytes){check(signal);const answer=await api.read(transfer,token,offset,...(owned?[{owned:true}]:[]));let data;try{
   check(signal);if(!answer||answer.offset!==offset||!Number.isSafeInteger(answer.bytes)||answer.bytes<=0||answer.bytes>196608||offset+answer.bytes>info.bytes)throw Error('The returned document image was interrupted.');
   if(owned){if(answer.kind!=='notemind-asset-chunk-v1'||answer.transfer!==transfer||answer.token!==token||typeof answer.receipt!=='string'||!answer.receipt||answer.receipt.length>128||!privateBytes(answer.data)||answer.data.byteLength!==answer.bytes)throw Error('Invalid document image ownership receipt.');data=base64(answer.data)}else data=answer.data;
   if(typeof data!=='string'||!data.length||data.length>CHUNK||data.length%4)throw Error('The returned document image was interrupted.');chunks.push(data);offset+=answer.bytes;chars+=data.length;
  }finally{if(owned&&answer?.kind==='notemind-asset-chunk-v1'){discard(answer.data);if(typeof answer.receipt==='string')await api.ack(transfer,answer.receipt)}}await yieldTask()}check(signal);if(chars!==info.chars)throw Error('Incomplete returned document image.');let data='';for(const chunk of chunks)data+=chunk;return{data,chunks:Object.freeze(chunks)};
 }

 return{upload,pull,release:transfer=>Promise.resolve().then(()=>api.release(transfer)).catch(()=>{})};
});
