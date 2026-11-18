// Private converter bridge. Default base64 and opt-in ACKed binary chunks are bounded; borrowed outputs stay borrowed.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.NoteMindDocumentBytes=factory()})(typeof window==='undefined'?this:window,function({limit=320*1024*1024,entryLimit=150*1024*1024,consumeOwned=false,decodeOwnedBase64=false,uuid=()=>crypto.randomUUID(),decode=(consumeOwned&&decodeOwnedBase64?s=>{
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',canonical=s.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(s)&&(!s.endsWith('==')||alphabet.indexOf(s[s.length-3])%16===0)&&(!s.endsWith('=')||s.endsWith('==')||alphabet.indexOf(s[s.length-2])%4===0);
  if(canonical&&typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(s);
  // Noncanonical input keeps atob's accepted bytes and exact error behavior.
  const text=atob(s),bytes=new Uint8Array(text.length);for(let at=0;at<text.length;at++)bytes[at]=text.charCodeAt(at);return bytes;
 }:s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))),encode=bytes=>{let s='';for(let at=0;at<bytes.length;at+=8192)s+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(s)}}={}){
 const sessions=new Map();let used=0,cleanupFailures=0;const CHUNK=196608;
 const session=(id,allowClosing=false)=>{const item=sessions.get(id);if(!item||item.closing&&!allowClosing)throw Error('Document byte transfer is unavailable.');return item};
 function discard(buffer){if(buffer instanceof ArrayBuffer&&buffer.byteLength&&typeof buffer.transfer==='function')try{buffer.transfer(0)}catch{}}
 function finish(item){for(const buffer of item.owned){discard(buffer);if(consumeOwned&&buffer.byteLength)throw Error('Private document backing could not be released.');}sessions.delete(item.id);used-=item.charged;clearTimeout(item.timer);item.owned.clear();item.input=null;item.outputs.clear();item.closed?.()}
 function release(id){const item=sessions.get(id);if(!item)return;if(!item.pending)return finish(item);if(!item.closing){clearTimeout(item.timer);item.closing=new Promise(resolve=>item.closed=resolve);}return item.closing;}
 function expire(item,delay){clearTimeout(item.timer);const failed=()=>{cleanupFailures++;if(sessions.get(item.id)===item)expire(item,25)};item.timer=setTimeout(()=>{try{release(item.id)?.catch?.(failed)}catch{failed()}},delay);item.timer.unref?.()}
 function touch(item){expire(item,15*60*1000)}
 function begin(total,ownedId){
  if(!Number.isSafeInteger(total)||total<0||total>entryLimit)throw Error('Document byte transfer exceeds its limit.');
  if(ownedId!==undefined&&(!consumeOwned||typeof ownedId!=='string'||!ownedId.length||ownedId.length>128||!/^[A-Za-z0-9:-]+$/.test(ownedId)))throw Error('Invalid private document transfer identity.');
  const id=ownedId??uuid(),existing=sessions.get(id);
  if(existing){if(ownedId!==undefined&&!existing.closing&&existing.input?.length===total&&existing.at===0&&existing.next===0)return id;throw Error('Document transfer identity is already in use.');}
  if(sessions.size>=2||used+total>limit)throw Error('Document byte transfer exceeds its limit.');
  const item={id,input:new Uint8Array(total),at:0,charged:total,outputs:new Map(),next:0,owned:new Set()};if(consumeOwned)item.owned.add(item.input.buffer);sessions.set(id,item);used+=total;touch(item);return id;
 }
 function write(id,offset,data){const item=session(id);if(!item.input||offset!==item.at||typeof data!=='string'||data.length>CHUNK/3*4)throw Error('Invalid document byte chunk.');const bytes=decode(data);try{if(!bytes.length||bytes.length>CHUNK||item.at+bytes.length>item.input.length)throw Error('Invalid document byte chunk.');item.input.set(bytes,item.at);item.at+=bytes.length;touch(item);return item.at}finally{if(consumeOwned&&!bytes.byteOffset&&bytes.byteLength===bytes.buffer.byteLength)discard(bytes.buffer)}}
 function writeBinary(id,offset,data){const item=session(id);if(!consumeOwned||!item.input||offset!==item.at||!ArrayBuffer.isView(data)||data.BYTES_PER_ELEMENT!==1||!data.byteLength||data.byteLength>CHUNK||item.at+data.byteLength>item.input.length)throw Error('Invalid private document DATA chunk.');item.input.set(data,item.at);item.at+=data.byteLength;touch(item);return item.at}
 function take(value){if(!value||typeof value!=='object'||typeof value.documentByteInput!=='string')return null;const item=session(value.documentByteInput);if(!item.input||item.at!==item.input.length)throw Error('Document byte transfer is incomplete.');const bytes=item.input;item.input=null;touch(item);return{bytes,owner:item.id}}
 function put(owner,bytes,owned){const item=session(owner);if(!(bytes instanceof Uint8Array)||bytes.length>entryLimit||used+bytes.length>limit)throw Error('Document output exceeds its limit.');const token=String(++item.next);item.outputs.set(token,bytes);if(owned)item.owned.add(bytes.buffer);item.charged+=bytes.length;used+=bytes.length;touch(item);return{documentByteOutput:token,bytes:bytes.length}}
 function read(id,token,offset){const item=session(id),bytes=item.outputs.get(token);if(!bytes||!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)throw Error('Invalid document output offset.');const end=Math.min(bytes.length,offset+CHUNK);touch(item);return{offset,data:encode(bytes.subarray(offset,end)),bytes:end-offset}}
 function readBinary(id,token,offset,request){
  if(!consumeOwned)throw Error('Private binary output is unavailable.');const item=session(id),bytes=item.outputs.get(token);
  if(item.closing||!bytes||!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)throw Error('Invalid private document output offset.');
  const sequence=request===undefined?(item.nextChunk||0)+1:typeof request==='string'&&request.startsWith(id+':')&&/^[1-9][0-9]*$/.test(request.slice(id.length+1))?Number(request.slice(id.length+1)):NaN;
  if(!Number.isSafeInteger(sequence))throw Error('Invalid private document chunk request.');const tokenId=id+':'+sequence;
  if(item.pending){if(item.pending.chunk!==tokenId||item.pending.token!==token||item.pending.offset!==offset)throw Error('A private document chunk is already pending.');touch(item);return{chunk:tokenId,offset,bytes:item.pending.data.byteLength,data:item.pending.data};}
  if(sequence<=(item.nextChunk||0))throw Error('Private document chunk request was already acknowledged.');
  const end=Math.min(bytes.length,offset+CHUNK),data=new Uint8Array(end-offset);data.set(bytes.subarray(offset,end));item.nextChunk=sequence;item.pending={chunk:tokenId,token,offset,data};item.owned.add(data.buffer);touch(item);
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
 return{begin,write,writeBinary,take,publish:(owner,bytes)=>put(owner,bytes,false),publishOwned:(owner,buffer)=>{if(!(buffer instanceof ArrayBuffer))throw Error('Invalid private document output.');return put(owner,new Uint8Array(buffer),true)},read,readBinary,ackBinary,release,stats:()=>({sessions:sessions.size,bytes:used,cleanupFailures,pendingBinaryChunks:[...sessions.values()].reduce((sum,item)=>sum+!!item.pending,0)})};
});
