// Private converter bridge. Default base64 and opt-in ACKed binary chunks are bounded; borrowed outputs stay borrowed.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.NoteMindDocumentBytes=factory()})(typeof window==='undefined'?this:window,function({limit=320*1024*1024,entryLimit=150*1024*1024,consumeOwned=false,uuid=()=>crypto.randomUUID(),decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)),encode=bytes=>{let s='';for(let at=0;at<bytes.length;at+=8192)s+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(s)}}={}){
 const sessions=new Map();let used=0;const CHUNK=196608;
 const session=(id,allowClosing=false)=>{const item=sessions.get(id);if(!item||item.closing&&!allowClosing)throw Error('Document byte transfer is unavailable.');return item};
 function discard(buffer){if(buffer instanceof ArrayBuffer&&buffer.byteLength&&typeof buffer.transfer==='function')try{buffer.transfer(0)}catch{}}
 function finish(item){for(const buffer of item.owned){discard(buffer);if(consumeOwned&&buffer.byteLength)throw Error('Private document backing could not be released.');}sessions.delete(item.id);used-=item.charged;clearTimeout(item.timer);item.owned.clear();item.input=null;item.outputs.clear();item.closed?.()}
 function release(id){const item=sessions.get(id);if(!item)return;if(!item.pending)return finish(item);if(!item.closing){clearTimeout(item.timer);item.closing=new Promise(resolve=>item.closed=resolve);}return item.closing;}
 function touch(item){clearTimeout(item.timer);item.timer=setTimeout(()=>release(item.id),15*60*1000);item.timer.unref?.()}
 function begin(total){if(!Number.isSafeInteger(total)||total<0||total>entryLimit||sessions.size>=2||used+total>limit)throw Error('Document byte transfer exceeds its limit.');const id=uuid(),item={id,input:new Uint8Array(total),at:0,charged:total,outputs:new Map(),next:0,owned:new Set()};if(consumeOwned)item.owned.add(item.input.buffer);sessions.set(id,item);used+=total;touch(item);return id}
 function write(id,offset,data){const item=session(id);if(!item.input||offset!==item.at||typeof data!=='string'||data.length>CHUNK/3*4)throw Error('Invalid document byte chunk.');const bytes=decode(data);try{if(!bytes.length||bytes.length>CHUNK||item.at+bytes.length>item.input.length)throw Error('Invalid document byte chunk.');item.input.set(bytes,item.at);item.at+=bytes.length;touch(item);return item.at}finally{if(consumeOwned&&!bytes.byteOffset&&bytes.byteLength===bytes.buffer.byteLength)discard(bytes.buffer)}}
 function take(value){if(!value||typeof value!=='object'||typeof value.documentByteInput!=='string')return null;const item=session(value.documentByteInput);if(!item.input||item.at!==item.input.length)throw Error('Document byte transfer is incomplete.');const bytes=item.input;item.input=null;touch(item);return{bytes,owner:item.id}}
 function put(owner,bytes,owned){const item=session(owner);if(!(bytes instanceof Uint8Array)||bytes.length>entryLimit||used+bytes.length>limit)throw Error('Document output exceeds its limit.');const token=String(++item.next);item.outputs.set(token,bytes);if(owned)item.owned.add(bytes.buffer);item.charged+=bytes.length;used+=bytes.length;touch(item);return{documentByteOutput:token,bytes:bytes.length}}
 function read(id,token,offset){const item=session(id),bytes=item.outputs.get(token);if(!bytes||!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)throw Error('Invalid document output offset.');const end=Math.min(bytes.length,offset+CHUNK);touch(item);return{offset,data:encode(bytes.subarray(offset,end)),bytes:end-offset}}
 function readBinary(id,token,offset){
  if(!consumeOwned)throw Error('Private binary output is unavailable.');const item=session(id),bytes=item.outputs.get(token);
  if(item.closing||item.pending||!bytes||!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)throw Error('Invalid private document output offset.');
  const end=Math.min(bytes.length,offset+CHUNK),chunk=(item.nextChunk||0)+1;if(!Number.isSafeInteger(chunk))throw Error('Private document chunk limit reached.');
  const data=new Uint8Array(end-offset);data.set(bytes.subarray(offset,end));item.nextChunk=chunk;const tokenId=id+':'+chunk;item.pending={chunk:tokenId,data};item.owned.add(data.buffer);touch(item);
  return{chunk:tokenId,offset,bytes:data.byteLength,data};
 }
 function ackBinary(id,chunk){
  const item=session(id,true);if(typeof chunk!=='string'||chunk.length>128||!chunk.startsWith(id+':'))throw Error('Invalid private document chunk acknowledgement.');
  if(!item.pending){if(item.lastAck===chunk)return true;throw Error('Unknown private document chunk acknowledgement.');}
  if(item.pending.chunk!==chunk)throw Error('Foreign private document chunk acknowledgement.');
  const buffer=item.pending.data.buffer;discard(buffer);if(buffer.byteLength)throw Error('Private document chunk backing could not be released.');
  item.owned.delete(buffer);item.pending=null;item.lastAck=chunk;
  if(item.closing)finish(item);return true;
 }
 return{begin,write,take,publish:(owner,bytes)=>put(owner,bytes,false),publishOwned:(owner,buffer)=>{if(!(buffer instanceof ArrayBuffer))throw Error('Invalid private document output.');return put(owner,new Uint8Array(buffer),true)},read,readBinary,ackBinary,release,stats:()=>({sessions:sessions.size,bytes:used,pendingBinaryChunks:[...sessions.values()].reduce((sum,item)=>sum+!!item.pending,0)})};
});
