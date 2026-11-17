const {randomUUID}=require('node:crypto');
class SheetLoadTransport{
 constructor({maxBytes=100*1024*1024,maxSessions=2,chunkBytes=1024*1024,idleMs=30000}={}){Object.assign(this,{maxBytes,maxSessions,chunkBytes,idleMs});this.sessions=new Map();this.owners=new WeakSet();this.bytes=0;}
 touch(session){clearTimeout(session.timer);session.timer=setTimeout(()=>this.release(session.owner,session.id),this.idleMs);session.timer.unref?.();}
 begin(owner,state,{scope='recovery',maxBytes=this.maxBytes,requestId=null,requestScope='sheet'}={}){
  for(const [id,session]of this.sessions)if(session.owner===owner&&session.scope===scope&&(!requestId||session.requestId===requestId))this.release(owner,id);if(!state.encodedSheets)return state;
  const buffers=new Map();let bytes=0,next=0;
  const encodedSheets=state.encodedSheets.map(sheet=>{const packet={...sheet};for(const field of ['bytes','backdropBytes','identityBytes']){const value=sheet[field];if(value==null)continue;if(!ArrayBuffer.isView(value))throw Error('Invalid drawing recovery buffer.');const key=String(next++);buffers.set(key,new Uint8Array(value.buffer,value.byteOffset,value.byteLength));bytes+=value.byteLength;packet[field]={chunked:true,key,bytes:value.byteLength};}return packet;});
  if(this.sessions.size>=this.maxSessions||bytes>maxBytes||bytes>this.maxBytes-this.bytes)throw Error('Drawing recovery is busy. Current drawings remain open.');
  const id=randomUUID(),session={id,owner,scope,buffers,bytes,requestId,requestScope};this.sessions.set(id,session);this.bytes+=bytes;this.touch(session);return {...state,encodedSheets,transferSession:id,chunkBytes:this.chunkBytes};
 }
 beginFor(sender,state,options){if(sender.isDestroyed())throw Error('Drawing recovery window closed.');const owner=sender.id;if(!this.owners.has(sender)){this.owners.add(sender);sender.once('destroyed',()=>this.closeOwner(owner));}return this.begin(owner,state,options);}
 read(owner,id,key,offset){const session=this.sessions.get(id);if(!session||session.owner!==owner)throw Error('Drawing recovery transfer expired. Current drawings remain open.');const bytes=session.buffers.get(key);if(!bytes||!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)throw Error('Invalid drawing recovery chunk.');this.touch(session);return bytes.slice(offset,Math.min(bytes.length,offset+this.chunkBytes));}
 release(owner,id){const session=this.sessions.get(id);if(!session||session.owner!==owner)return false;clearTimeout(session.timer);this.sessions.delete(id);this.bytes-=session.bytes;session.buffers.clear();return true;}
 hasRequest(owner,requestId,scope){for(const session of this.sessions.values())if(session.owner===owner&&session.requestId===requestId&&session.requestScope===scope)return true;return false;}
 cancelRequest(owner,requestId,scope){let released=false;for(const[id,session]of this.sessions)if(session.owner===owner&&session.requestId===requestId&&session.requestScope===scope)released=this.release(owner,id)||released;return released;}
 closeOwner(owner){for(const [id,session]of this.sessions)if(session.owner===owner)this.release(owner,id);}
 dispose(){for(const [id,session]of this.sessions)this.release(session.owner,id);}
}
module.exports={SheetLoadTransport,shared:new SheetLoadTransport({maxBytes:256*1024*1024})};
