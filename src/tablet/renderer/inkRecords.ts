import graphics from '../../graphics-pane.js'
import {inspectBinaryDrawing} from '../../binary-drawing.js'

export const MAX_INK_POINTS=2000000
const RADIX=MAX_INK_POINTS+1,MAX_BATCHES=512,MAX_STORED_RECORDS=3000000
export type InkBatch={bytes:Uint8Array;view:DataView;offsets:Uint32Array;boxes:Float64Array;ids:Float64Array;count:number}
export type InkRecord={id:number;view:DataView;at:number;count:number;stride:number;pressure:boolean;width:number;colour:string;box:{x:number;y:number;right:number;bottom:number}}
export const emptyRecord=():InkRecord=>({id:0,view:new DataView(new ArrayBuffer(0)),at:0,count:0,stride:16,pressure:false,width:0,colour:'',box:{x:0,y:0,right:0,bottom:0}})
const validId=(id:number)=>Number.isSafeInteger(id)&&id>0
const locator=(batch:number,index:number)=>batch*RADIX+index
const parts=(value:number)=>{const batch=Math.floor(value/RADIX);return{batch,index:value-batch*RADIX}}
function identityView(value:any){if(!ArrayBuffer.isView(value)||value.byteLength%8||value.byteLength/8>MAX_INK_POINTS)throw Error('Invalid ink identities.');return new DataView(value.buffer,value.byteOffset,value.byteLength)}
const hash=(id:number)=>{let value=(id>>>0)^Math.imul(Math.floor(id/4294967296),0x9e3779b1);value=Math.imul(value^(value>>>16),0x85ebca6b);value=Math.imul(value^(value>>>13),0xc2b2ae35);return(value^(value>>>16))>>>0}
/** Slots contain exact locators; IDs stay in their typed binary batch, without a second boxed-key graph. */
class IdentityLookup{
 slots:Float64Array;size=0
 constructor(count:number,private batches:(InkBatch|null)[]){let capacity=4;while(capacity<Math.max(1,count)*1.5)capacity*=2;this.slots=new Float64Array(capacity)}
 id(value:number){const batch=Math.floor(value/RADIX);return this.batches[batch]!.ids[value-batch*RADIX]!}
 get(id:number){const mask=this.slots.length-1;let at=hash(id)&mask;for(;;){const value=this.slots[at]!;if(!value)return -1;if(this.id(value-1)===id)return value-1;at=(at+1)&mask}}
 add(id:number,value:number){const mask=this.slots.length-1;let at=hash(id)&mask;for(;;){const prior=this.slots[at]!;if(!prior){this.slots[at]=value+1;this.size++;return true}if(this.id(prior-1)===id)return false;at=(at+1)&mask}}
}
function countOf(batches:(InkBatch|null)[],value:number){const batch=Math.floor(value/RADIX),held=batches[batch]!,index=value-batch*RADIX;return held.view.getUint32(held.offsets[index]!+12,true)}
async function batchOf(bytes:Uint8Array,rawIds:any,pause:()=>Promise<void>):Promise<InkBatch>{
 const parsed=await inspectBinaryDrawing(bytes,{yieldControl:pause}),idsView=identityView(rawIds);if(parsed.count!==idsView.byteLength/8)throw Error('Ink identities do not match geometry.');const ids=new Float64Array(parsed.count),boxes=new Float64Array(parsed.count*4);let work=0
 for(let index=0;index<parsed.count;index++){const id=idsView.getFloat64(index*8,true);if(!validId(id))throw Error('Invalid ink identity.');ids[index]=id;const header=parsed.offsets[index]!,stride=parsed.view.getUint8(header+3)&1?24:16,count=parsed.view.getUint32(header+12,true);let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,at=header+16;for(let point=0;point<count;point++,at+=stride){const x=parsed.view.getFloat64(at,true),y=parsed.view.getFloat64(at+8,true);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);if(++work%8192===0)await pause()}boxes.set([left,top,right,bottom],index*4);if(++work%8192===0)await pause()}
 return{bytes:parsed.bytes,view:parsed.view,offsets:parsed.offsets,boxes,ids,count:parsed.count}
}
export class InkRecordTable{
 batches:(InkBatch|null)[]=[];lookup=new IdentityLookup(0,this.batches);order=new Float64Array(0);points=0;bytes=0;storedRecords=0;colours=new Map<number,string>()
 get size(){return this.lookup.size}
 get typedBytes(){return this.order.byteLength+this.lookup.slots.byteLength+this.batches.reduce((n,batch)=>n+(batch?batch.offsets.byteLength+batch.boxes.byteLength+batch.ids.byteLength:0),0)}
 id(value:number){return this.lookup.id(value)}
 read(value:number,out:InkRecord,colourNeeded=true){const batch=Math.floor(value/RADIX),held=this.batches[batch]!,index=value-batch*RADIX,header=held.offsets[index]!,flags=held.view.getUint8(header+3);out.id=held.ids[index]!;out.view=held.view;out.at=header+16;out.count=held.view.getUint32(header+12,true);out.pressure=!!(flags&1);out.stride=out.pressure?24:16;out.width=held.view.getFloat64(header+4,true);if(colourNeeded){const key=(held.view.getUint8(header)*65536+held.view.getUint8(header+1)*256+held.view.getUint8(header+2))*128+flags;let colour=this.colours.get(key);if(!colour){colour='#';for(let n=0;n<3;n++){const hex=held.view.getUint8(header+n).toString(16).padStart(2,'0');for(let digit=0;digit<2;digit++){const c=hex[digit]!;colour+=flags&(1<<(n*2+digit+1))?c.toUpperCase():c}}if(this.colours.size<4096)this.colours.set(key,colour)}out.colour=colour};const box=index*4;out.box.x=held.boxes[box]!;out.box.y=held.boxes[box+1]!;out.box.right=held.boxes[box+2]!;out.box.bottom=held.boxes[box+3]!;return out}
 static async prepare(previous:InkRecordTable|null,request:any,maxBytes:number,pause:()=>Promise<void>){
  const rawOrder=identityView(request.order),next=new InkRecordTable();next.batches=previous?previous.batches.slice():[];let added:IdentityLookup|null=null
  if(request.additions){const batch=await batchOf(request.additions,request.addIds,pause);let index=next.batches.indexOf(null);if(index<0)index=next.batches.length;next.batches[index]=batch;added=new IdentityLookup(batch.count,next.batches);for(let at=0;at<batch.count;at++){const id=batch.ids[at]!;if((previous?.lookup.get(id)??-1)>=0||!added.add(id,locator(index,at)))throw Error('Duplicate ink geometry.');if((at+1)%8192===0)await pause()}}
  next.lookup=new IdentityLookup(rawOrder.byteLength/8,next.batches);next.order=new Float64Array(rawOrder.byteLength/8);const usedBatches=new Uint8Array(next.batches.length)
  for(let index=0;index<next.order.length;index++){const id=rawOrder.getFloat64(index*8,true);if(!validId(id))throw Error('Invalid ink identity.');const value=added?.get(id)??-1,resolved=value>=0?value:previous?.lookup.get(id)??-1;if(resolved<0)throw Error('Unknown ink geometry.');next.order[index]=resolved;next.points+=countOf(next.batches,resolved);if(next.points>MAX_INK_POINTS)throw Error('Too many ink points.');next.lookup.add(id,resolved);usedBatches[Math.floor(resolved/RADIX)]=1;if((index+1)%8192===0)await pause()}
  const buffers=new Set<ArrayBufferLike>();for(let index=0;index<next.batches.length;index++){const batch=next.batches[index];if(batch&&usedBatches[index]){next.storedRecords+=batch.count;if(!buffers.has(batch.bytes.buffer)){buffers.add(batch.bytes.buffer);next.bytes+=batch.bytes.buffer.byteLength}}else next.batches[index]=null}
  if(next.bytes>maxBytes||next.batches.length>MAX_BATCHES||next.storedRecords>MAX_STORED_RECORDS||next.storedRecords>Math.max(4096,next.size*2))return next.compact(maxBytes,pause)
  return next
 }
 private async compact(maxBytes:number,pause:()=>Promise<void>){
  const prefix=graphics.encodeBytes({name:'Ink',aspect:1,strokes:[]}),ids=new Float64Array(this.size),locations=new Float64Array(this.size),order=new Float64Array(this.order.length),batches:(InkBatch|null)[]=[],seen=new IdentityLookup(this.size,this.batches);let count=0,length=prefix.length,points=0
  for(let index=0;index<this.order.length;index++){const value=this.order[index]!,id=this.id(value);if(seen.add(id,value)){const {batch,index:local}=parts(value),held=this.batches[batch]!;ids[count]=id;locations[count++]=value;length+=held.offsets[local+1]!-held.offsets[local]!;points+=countOf(this.batches,value)}if((index+1)%8192===0)await pause()}
  if(length>maxBytes||length>graphics.MAX_BINARY_BYTES)throw Error('Ink cache is too large.');const bytes=new Uint8Array(length);bytes.set(prefix);const view=new DataView(bytes.buffer),offsets=new Uint32Array(count+1),boxes=new Float64Array(count*4),batch:InkBatch={bytes,view,offsets,boxes,ids,count};batches.push(batch);const lookup=new IdentityLookup(count,batches);let at=prefix.length
  for(let index=0;index<count;index++){const value=locations[index]!,{batch:prior,index:local}=parts(value),held=this.batches[prior]!,start=held.offsets[local]!,end=held.offsets[local+1]!;offsets[index]=at;for(let from=start;from<end;from+=65536){const piece=held.bytes.subarray(from,Math.min(end,from+65536));bytes.set(piece,at);at+=piece.length;if(from+65536<end)await pause()}boxes.set(held.boxes.subarray(local*4,local*4+4),index*4);lookup.add(ids[index]!,index);if((index+1)%4096===0)await pause()}
  offsets[count]=at;view.setUint32(12,count,true);view.setUint32(16,points,true);view.setUint32(20,length,true);for(let index=0;index<order.length;index++){order[index]=lookup.get(this.id(this.order[index]!));if((index+1)%8192===0)await pause()}const next=new InkRecordTable();Object.assign(next,{batches,lookup,order,points:this.points,bytes:length,storedRecords:count});return next
 }
}
