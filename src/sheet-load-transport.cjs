const {randomUUID}=require('node:crypto');
class SheetLoadTransport{
 constructor({maxBytes=100*1024*1024,maxSessions=2,chunkBytes=1024*1024,idleMs=30000}={}){Object.assign(this,{maxBytes,maxSessions,chunkBytes,idleMs});this.sessions=new Map();this.owners=new WeakSet();this.bytes=0;this.backings=new WeakMap();}
 touch(session){clearTimeout(session.timer);session.timer=setTimeout(()=>this.release(session.owner,session.id),this.idleMs);session.timer.unref?.();}
 discardBacking(backing){const record=this.backings.get(backing);if(record){record.discard=true;if(record.refs||record.borrowed||!record.complete)return;}if(typeof backing?.transfer==='function')try{backing.transfer(0);}catch{}}
 discardState(state){if(!Array.isArray(state?.encodedSheets))return;for(const sheet of state.encodedSheets)for(const field of ['bytes','backdropBytes','identityBytes']){const bytes=sheet?.[field];if(ArrayBuffer.isView(bytes)&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength)this.discardBacking(bytes.buffer);}}
 begin(owner,state,{scope='recovery',maxBytes=this.maxBytes,requestId=null,requestScope='sheet',consume=false}={}){
  if(!state.encodedSheets)return state;
  try{
   const replaced=[...this.sessions.values()].filter(session=>session.owner===owner&&session.scope===scope&&(!requestId||session.requestId===requestId)),replacedBytes=replaced.reduce((sum,row)=>sum+row.bytes,0),buffers=new Map(),backings=new Map();let bytes=0,next=0;
   const encodedSheets=state.encodedSheets.map(sheet=>{const packet={...sheet};for(const field of ['bytes','backdropBytes','identityBytes']){const value=sheet[field];if(value==null)continue;if(!ArrayBuffer.isView(value))throw Error('Invalid drawing recovery buffer.');const key=String(next++);buffers.set(key,new Uint8Array(value.buffer,value.byteOffset,value.byteLength));bytes+=value.byteLength;packet[field]={chunked:true,key,bytes:value.byteLength};const complete=value.byteOffset===0&&value.byteLength===value.buffer.byteLength;backings.set(value.buffer,(backings.get(value.buffer)??true)&&complete);}return packet;});
   if(this.sessions.size-replaced.length>=this.maxSessions||bytes>maxBytes||bytes>this.maxBytes-this.bytes+replacedBytes)throw Error('Drawing recovery is busy. Current drawings remain open.');
   // Retain candidate aliases before retiring the replaced transfer's ownership.
   for(const [backing,complete]of backings){let record=this.backings.get(backing);if(!record){record={refs:0,borrowed:false,complete:true,discard:false};this.backings.set(backing,record);}record.refs++;record.borrowed ||= !consume;record.complete &&=complete;record.discard ||=consume;}
   for(const previous of replaced)this.release(previous.owner,previous.id);
   const id=randomUUID(),session={id,owner,scope,buffers,backings,bytes,requestId,requestScope};this.sessions.set(id,session);this.bytes+=bytes;this.touch(session);return {...state,encodedSheets,transferSession:id,chunkBytes:this.chunkBytes};
  }catch(error){if(consume)this.discardState(state);throw error;}
 }
 beginFor(sender,state,options){try{if(sender.isDestroyed())throw Error('Drawing recovery window closed.');const owner=sender.id;if(!this.owners.has(sender)){this.owners.add(sender);sender.once('destroyed',()=>this.closeOwner(owner));}return this.begin(owner,state,options);}catch(error){if(options?.consume)this.discardState(state);throw error;}}
 read(owner,id,key,offset){const session=this.sessions.get(id);if(!session||session.owner!==owner)throw Error('Drawing recovery transfer expired. Current drawings remain open.');const bytes=session.buffers.get(key);if(!bytes||!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)throw Error('Invalid drawing recovery chunk.');this.touch(session);return bytes.slice(offset,Math.min(bytes.length,offset+this.chunkBytes));}
 release(owner,id){const session=this.sessions.get(id);if(!session||session.owner!==owner)return false;clearTimeout(session.timer);this.sessions.delete(id);this.bytes-=session.bytes;session.buffers.clear();for(const backing of session.backings.keys()){const record=this.backings.get(backing);if(record){record.refs--;if(record.discard)this.discardBacking(backing);}}session.backings.clear();return true;}
 hasRequest(owner,requestId,scope){for(const session of this.sessions.values())if(session.owner===owner&&session.requestId===requestId&&session.requestScope===scope)return true;return false;}
 cancelRequest(owner,requestId,scope){let released=false;for(const[id,session]of this.sessions)if(session.owner===owner&&session.requestId===requestId&&session.requestScope===scope)released=this.release(owner,id)||released;return released;}
 closeOwner(owner){for(const [id,session]of this.sessions)if(session.owner===owner)this.release(owner,id);}
 dispose(){for(const [id,session]of this.sessions)this.release(session.owner,id);}
}
module.exports={SheetLoadTransport,shared:new SheetLoadTransport({maxBytes:256*1024*1024})};
