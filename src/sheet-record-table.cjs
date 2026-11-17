// Transient save lookup: geometry stays in packs and records use fixed-width
// external buffers, rather than one retained object/Map entry per stroke.
const {validRecord}=require('./sheet-order-index.cjs');
const ROW_BYTES=32,BLOCK_ROWS=16384;
class SheetRecordTable{
 constructor(){this.blocks=[];this.refs=[];this.refIds=new Map();this.length=0;this.size=0;this.ordered=true;this.previous=0;this.sorted=null;this.sealed=false;this.last=-1;}
 id(at){return this.blocks[Math.floor(at/BLOCK_ROWS)].readDoubleLE((at%BLOCK_ROWS)*ROW_BYTES);}
 add(record){
  if(this.sealed)throw Error('Drawing record lookup is already complete.');validRecord(record);let chunk=this.refIds.get(record.chunk.sha256);if(chunk===undefined){chunk=this.refs.length;this.refs.push(record.chunk);this.refIds.set(record.chunk.sha256,chunk);}
  if(this.length>=0xffffffff)throw Error('This drawing checkpoint contains too many stroke references.');const at=this.length++,block=Math.floor(at/BLOCK_ROWS),offset=(at%BLOCK_ROWS)*ROW_BYTES;if(!this.blocks[block])this.blocks[block]=Buffer.allocUnsafe(BLOCK_ROWS*ROW_BYTES);const bytes=this.blocks[block];bytes.writeDoubleLE(record.id,offset);bytes.writeUInt32LE(parseInt(record.hash.slice(0,8),16),offset+8);bytes.writeUInt32LE(parseInt(record.hash.slice(8),16),offset+12);bytes.writeUInt32LE(record.points,offset+16);bytes.writeUInt32LE(chunk,offset+20);bytes.writeUInt32LE(record.strokeIndex,offset+24);bytes.writeUInt32LE(record.pressure?1:0,offset+28);if(record.id<=this.previous)this.ordered=false;this.previous=record.id;
 }
 seal({allowDuplicates=false}={}){
  if(this.sealed)return this;this.sealed=true;this.size=this.length;if(this.ordered)return this;
  this.sorted=new Uint32Array(this.length);for(let at=0;at<this.length;at++)this.sorted[at]=at;this.sorted.sort((a,b)=>this.id(a)-this.id(b)||a-b);
  for(let at=1;at<this.length;at++)if(this.id(this.sorted[at])===this.id(this.sorted[at-1])){if(!allowDuplicates)throw Error('Duplicate drawing stroke identity.');this.size--;}
  return this;
 }
 find(id){
  if(!this.sealed)throw Error('Drawing record lookup is incomplete.');if(!Number.isSafeInteger(id)||id<=0)return -1;if(this.ordered&&this.last+1<this.length&&this.id(this.last+1)===id)return ++this.last;
  let low=0,high=this.length;while(low<high){const middle=low+Math.floor((high-low)/2),at=this.sorted?this.sorted[middle]:middle;if(this.id(at)<=id)low=middle+1;else high=middle;}if(!low)return -1;const at=this.sorted?this.sorted[low-1]:low-1;if(this.id(at)!==id)return -1;this.last=at;return at;
 }
 has(id){return this.find(id)!==-1;}
 get(id){const at=this.find(id);if(at===-1)return undefined;const bytes=this.blocks[Math.floor(at/BLOCK_ROWS)],offset=(at%BLOCK_ROWS)*ROW_BYTES;return {id:bytes.readDoubleLE(offset),hash:bytes.readUInt32LE(offset+8).toString(16).padStart(8,'0')+bytes.readUInt32LE(offset+12).toString(16).padStart(8,'0'),points:bytes.readUInt32LE(offset+16),chunk:this.refs[bytes.readUInt32LE(offset+20)],strokeIndex:bytes.readUInt32LE(offset+24),...(bytes.readUInt32LE(offset+28)?{pressure:true}:{})};}
 clear(){this.blocks=[];this.refs=[];this.refIds.clear();this.sorted=null;this.length=this.size=0;this.last=-1;}
}
function assertUniqueStrokeIds(ids){
 if(!Array.isArray(ids)||ids.length>2000000)throw Error('Invalid drawing stroke identities.');for(const id of ids)if(!Number.isSafeInteger(id)||id<=0)throw Error('Duplicate drawing stroke identity.');const sorted=Float64Array.from(ids);sorted.sort();for(let at=1;at<sorted.length;at++)if(sorted[at]===sorted[at-1])throw Error('Duplicate drawing stroke identity.');
}
module.exports={SheetRecordTable,assertUniqueStrokeIds,ROW_BYTES,BLOCK_ROWS};
