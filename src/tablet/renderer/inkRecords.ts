import graphics from '../../graphics-pane.js'
import {inspectBinaryDrawing} from '../../binary-drawing.js'
import {PersistentInkIdentity} from '../../ink-identity.cjs'
import {createAffineInkIdentity} from '../../affine-ink-identity.cjs'
import {PersistentInkOrder} from '../../ink-order.cjs'

export const MAX_INK_POINTS=2000000
const RADIX=MAX_INK_POINTS+1,MAX_BATCHES=512,MAX_STORED_RECORDS=3000000
export type InkBatch={bytes:Uint8Array;view:DataView;offsets:Uint32Array|null;offsetStart:number;offsetStep:number;boxes:Float64Array|null;boxBits:Uint32Array|null;boxRanks:Uint32Array|null;ids:Float64Array|null;idStart:number;idStep:number;count:number}
export type InkRecord={id:number;view:DataView;at:number;count:number;stride:number;pressure:boolean;width:number;colour:string;box:{x:number;y:number;right:number;bottom:number}}
export const emptyRecord=():InkRecord=>({id:0,view:new DataView(new ArrayBuffer(0)),at:0,count:0,stride:16,pressure:false,width:0,colour:'',box:{x:0,y:0,right:0,bottom:0}})
const validId=(id:number)=>Number.isSafeInteger(id)&&id>0
const discardScratch=(values:Float64Array)=>{if(values.buffer.byteLength&&typeof values.buffer.transfer==='function')values.buffer.transfer(0)}
const locator=(batch:number,index:number)=>batch*RADIX+index
const parts=(value:number)=>{const batch=Math.floor(value/RADIX);return{batch,index:value-batch*RADIX}}
function identityView(value:any){if(!ArrayBuffer.isView(value)||value.byteLength%8||value.byteLength/8>MAX_INK_POINTS)throw Error('Invalid ink identities.');return new DataView(value.buffer,value.byteOffset,value.byteLength)}
const headerAt=(batch:InkBatch,index:number)=>batch.offsets?batch.offsets[index]!:batch.offsetStart+batch.offsetStep*index
const idAt=(batch:InkBatch,index:number)=>batch.ids?batch.ids[index]!:batch.idStart+batch.idStep*index
function bitCount(value:number){value-=value>>>1&0x55555555;value=(value&0x33333333)+(value>>>2&0x33333333);return((value+(value>>>4)&0x0f0f0f0f)*0x01010101)>>>24}
function boxAt(batch:InkBatch,index:number,box:InkRecord['box']){
 const header=headerAt(batch,index),count=batch.view.getUint32(header+12,true)
 if(count<=1){const x=count?batch.view.getFloat64(header+16,true):Infinity,y=count?batch.view.getFloat64(header+24,true):Infinity;box.x=Math.min(Infinity,x);box.y=Math.min(Infinity,y);box.right=count?Math.max(-Infinity,x):-Infinity;box.bottom=count?Math.max(-Infinity,y):-Infinity;return box}
 const word=index>>>5,bit=index&31,rank=batch.boxRanks![word]!+bitCount(batch.boxBits![word]!&(bit?0xffffffff>>>(32-bit):0)),at=rank*4;box.x=batch.boxes![at]!;box.y=batch.boxes![at+1]!;box.right=batch.boxes![at+2]!;box.bottom=batch.boxes![at+3]!;return box
}
function countOf(batches:(InkBatch|null)[],value:number){const batch=Math.floor(value/RADIX),held=batches[batch]!,index=value-batch*RADIX;return held.view.getUint32(headerAt(held,index)+12,true)}
async function batchOf(bytes:Uint8Array,rawIds:any,pause:()=>Promise<void>):Promise<InkBatch>{
 const parsed=await inspectBinaryDrawing(bytes,{yieldControl:pause}),idsView=identityView(rawIds);if(parsed.count!==idsView.byteLength/8)throw Error('Ink identities do not match geometry.');let ids:Float64Array|null=null,boxBits:Uint32Array|null=null,multi=0,work=0,uniform=true,idStart=0,idStep=0;const offsetStart=parsed.offsets[0]!,offsetStep=parsed.count?parsed.offsets[1]!-offsetStart:0
 for(let index=0;index<parsed.count;index++){
  const id=idsView.getFloat64(index*8,true);if(!validId(id))throw Error('Invalid ink identity.');if(!index)idStart=id;else if(index===1)idStep=id-idStart
  if(!ids&&index>1&&id!==idStart+idStep*index){ids=new Float64Array(parsed.count);for(let prior=0;prior<index;prior++){ids[prior]=idsView.getFloat64(prior*8,true);if(++work%8192===0)await pause()}}if(ids)ids[index]=id
  const header=parsed.offsets[index]!;if(parsed.offsets[index+1]!-header!==offsetStep)uniform=false;if(parsed.view.getUint32(header+12,true)>1){boxBits ||= new Uint32Array(Math.ceil(parsed.count/32));boxBits[index>>>5]!|=1<<(index&31);multi++}if(++work%8192===0)await pause()
 }
 const offsets=uniform?null:parsed.offsets;if(uniform&&parsed.offsets.buffer.byteLength&&typeof parsed.offsets.buffer.transfer==='function')parsed.offsets.buffer.transfer(0)
 const boxes=multi?new Float64Array(multi*4):null,boxRanks=boxBits?new Uint32Array(boxBits.length):null,batch:InkBatch={bytes:parsed.bytes,view:parsed.view,offsets,offsetStart,offsetStep,boxes,boxBits,boxRanks,ids,idStart,idStep,count:parsed.count};let dense=0
 if(boxBits)for(let word=0;word<boxBits.length;word++){
  boxRanks![word]=dense;let bits=boxBits[word]!
  while(bits){const bit=31-Math.clz32(bits&-bits),index=word*32+bit,header=headerAt(batch,index),stride=parsed.view.getUint8(header+3)&1?24:16,count=parsed.view.getUint32(header+12,true);let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,at=header+16;for(let point=0;point<count;point++,at+=stride){const x=parsed.view.getFloat64(at,true),y=parsed.view.getFloat64(at+8,true);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);if(++work%8192===0)await pause()}const box=dense++*4;boxes![box]=left;boxes![box+1]=top;boxes![box+2]=right;boxes![box+3]=bottom;bits&=bits-1;if(++work%8192===0)await pause()}
  if(++work%8192===0)await pause()
 }
 return batch
}
type IndexFactory=(table:InkRecordTable)=>any
const emptyEntries={length:0,*[Symbol.iterator](){}}
const indexDefault=(table:InkRecordTable)=>{const stroke=emptyRecord();return{viewKey:'canonical',boundsOf:(value:number)=>table.read(value,stroke,false).box,maxIndexRefs:1000000}}
const rows=(values:Float64Array,table:InkRecordTable,counts?:any)=>({length:values.length,*[Symbol.iterator](){const entry={id:0,locator:0,count:1};for(const value of values){entry.id=table.id(value);entry.locator=value;entry.count=counts?.count(entry.id)??1;yield entry}}})
function* reverseLeaves(node:any):Generator<Float64Array>{if(!node)return;if(!node.height){yield node.values;return}for(let at=node.children.length-1;at>=0;at--)yield*reverseLeaves(node.children[at])}
async function localOrderPatch(previous:InkRecordTable,request:any,pause:()=>Promise<void>){const raw=identityView(request.order),length=raw.byteLength/8,maximum=Math.min(length,previous.length);let prefix=0,suffix=0,work=0;prefixLoop:for(const leaf of previous.order.allLeaves())for(let at=0;at<leaf.length;at++){if(prefix===maximum||previous.id(leaf[at]!)!==raw.getFloat64(prefix*8,true))break prefixLoop;prefix++;if(++work%8192===0)await pause()}suffixLoop:for(const leaf of reverseLeaves(previous.order.root))for(let at=leaf.length-1;at>=0;at--){if(suffix===maximum-prefix||previous.id(leaf[at]!)!==raw.getFloat64((length-suffix-1)*8,true))break suffixLoop;suffix++;if(++work%8192===0)await pause()}const remove=previous.length-prefix-suffix,insertCount=length-prefix-suffix;if(remove+insertCount>16384)return request;const insert=new Float64Array(insertCount);for(let at=0;at<insertCount;at++)insert[at]=raw.getFloat64((prefix+at)*8,true);return{...request,order:undefined,patches:remove||insertCount?[{index:prefix,deleteCount:remove,insert}]:[]}}
export class InkRecordTable{
 batches:(InkBatch|null)[]=[];lookup:any=null;order:any=null;points=0;bytes=0;storedRecords=0;uses=new Uint32Array(0);colours=new Map<number,string>();changedAdded:number[]=[];changedRemoved:number[]=[];fullChange=true;indexFactory:IndexFactory=indexDefault
 get size(){return this.lookup?.size||0}
 get length(){return this.order?.length||0}
 get typedBytes(){return this.length*8+(this.lookup?.stats.typedBytes||0)+this.uses.byteLength+this.batches.reduce((n,batch)=>n+(batch?(batch.offsets?.byteLength||0)+(batch.boxes?.byteLength||0)+(batch.boxBits?.byteLength||0)+(batch.boxRanks?.byteLength||0)+(batch.ids?.byteLength||0):0),0)}
 id(value:number){const batch=Math.floor(value/RADIX);return idAt(this.batches[batch]!,value-batch*RADIX)}
 read(value:number,out:InkRecord,colourNeeded=true){const batch=Math.floor(value/RADIX),held=this.batches[batch]!,index=value-batch*RADIX,header=headerAt(held,index),flags=held.view.getUint8(header+3);out.id=idAt(held,index);out.view=held.view;out.at=header+16;out.count=held.view.getUint32(header+12,true);out.pressure=!!(flags&1);out.stride=out.pressure?24:16;out.width=held.view.getFloat64(header+4,true);if(colourNeeded){const key=(held.view.getUint8(header)*65536+held.view.getUint8(header+1)*256+held.view.getUint8(header+2))*128+flags;let colour=this.colours.get(key);if(!colour){colour='#';for(let n=0;n<3;n++){const hex=held.view.getUint8(header+n).toString(16).padStart(2,'0');for(let digit=0;digit<2;digit++){const c=hex[digit]!;colour+=flags&(1<<(n*2+digit+1))?c.toUpperCase():c}}if(this.colours.size<4096)this.colours.set(key,colour)}out.colour=colour};boxAt(held,index,out.box);return out}
 private account(){const buffers=new Set<ArrayBufferLike>();this.bytes=this.storedRecords=0;for(let i=0;i<this.batches.length;i++){const batch=this.batches[i];if(batch&&this.uses[i]){this.storedRecords+=batch.count;if(!buffers.has(batch.bytes.buffer)){buffers.add(batch.bytes.buffer);this.bytes+=batch.bytes.buffer.byteLength}}else this.batches[i]=null}}
 static async prepare(previous:InkRecordTable|null,request:any,maxBytes:number,pause:()=>Promise<void>,indexFactory:IndexFactory=indexDefault){
  if(previous?.order&&request.order!==undefined&&request.patches===undefined)request=await localOrderPatch(previous,request,pause);const next=new InkRecordTable();next.batches=previous?previous.batches.slice():[];next.indexFactory=indexFactory;let added:any=null,addedBatch:InkBatch|null=null,addedAt=-1,addedValues:Float64Array|null=null;const scratch=new Set<Float64Array>(),own=(value:Float64Array)=>{scratch.add(value);return value}
  try{
  if(request.additions){if(!ArrayBuffer.isView(request.additions)||request.additions.buffer.byteLength>maxBytes)throw Error('Ink cache is too large.');addedBatch=await batchOf(request.additions,request.addIds,pause);addedAt=next.batches.indexOf(null);if(addedAt<0)addedAt=next.batches.length;next.batches[addedAt]=addedBatch;addedValues=own(new Float64Array(addedBatch.count));for(let i=0;i<addedValues.length;i++){if((previous?.lookup?.locator(idAt(addedBatch,i))??-1)>=0)throw Error('Duplicate ink geometry.');addedValues[i]=locator(addedAt,i);if((i+1)%8192===0)await pause()}added=addedBatch.ids?null:createAffineInkIdentity({start:addedBatch.idStart,step:addedBatch.idStep,length:addedBatch.count,locatorStart:locator(addedAt,0)});added ||= await PersistentInkIdentity.build(rows(addedValues,next),{yieldControl:pause})}
  next.uses=new Uint32Array(next.batches.length);const options=()=>({...indexFactory(next),yieldControl:pause})
  if(request.patches!==undefined){
   if(!previous?.order||!Array.isArray(request.patches)||request.patches.length>128||request.order!==undefined)throw Error('Invalid ink order patches.');next.fullChange=false;next.uses.set(previous.uses);next.points=previous.points;let order=previous.order;const currentOptions=options();if(order.viewKey!==currentOptions.viewKey||order.maxIndexRefs!==currentOptions.maxIndexRefs)order=await order.reindex(currentOptions);const changes=new Map<number,{id:number;locator:number;count:number}>();let work=0
   const resolve=(id:number)=>{if(!validId(id))throw Error('Invalid ink identity.');const value=changes.get(id)?.locator??previous.lookup.locator(id),found=value>=0?value:added?.locator(id)??-1;if(found<0)throw Error('Unknown ink geometry.');return found}
   const update=(value:number,delta:number)=>{const id=next.id(value),old=changes.get(id),count=(old?.count??previous.lookup.count(id))+delta;if(count<0||count>MAX_INK_POINTS)throw Error('Invalid ink occurrence count.');changes.set(id,{id,locator:value,count});next.uses[Math.floor(value/RADIX)]+=delta;next.points+=countOf(next.batches,value)*delta;if(next.points<0||next.points>MAX_INK_POINTS)throw Error('Too many ink points.')}
   for(const patch of request.patches){const insert=identityView(patch?.insert),index=patch?.index,remove=patch?.deleteCount;if(!Number.isSafeInteger(index)||index<0||index>order.length||!Number.isSafeInteger(remove)||remove<0||remove>order.length-index||(work+=remove+insert.byteLength/8)>16384)throw Error('Invalid ink order patch budget.');const values=own(new Float64Array(insert.byteLength/8));for(let i=0;i<remove;i++){const value=order.at(index+i);update(value,-1);next.changedRemoved.push(value);if((i+1)%4096===0)await pause()}for(let i=0;i<values.length;i++){const value=resolve(insert.getFloat64(i*8,true));values[i]=value;update(value,1);next.changedAdded.push(value);if((i+1)%4096===0)await pause()}order=await order.splice(index,remove,values,options())}
   next.lookup=await previous.lookup.patch(changes.values(),{yieldControl:pause});next.order=order
  }else{
   const raw=identityView(request.order),values=addedValues&&addedValues.length===raw.byteLength/8?addedValues:own(new Float64Array(raw.byteLength/8));let exactAdded=!!addedValues&&values.length===addedValues.length,reuse=!!previous?.lookup&&values.length===previous.length,counts:(Uint32Array|undefined)[]|null=reuse?[]:null
   // Equal occurrence length plus no count exceeding its old exact multiplicity
   // proves a permutation. Count by immutable binary row (at most 12 MiB), rather
   // than allocating a second full identity lookup for a pure reorder.
   for(let index=0;index<values.length;index++){const expected=exactAdded?addedValues![index]:0,id=raw.getFloat64(index*8,true);if(!validId(id))throw Error('Invalid ink identity.');const value=added?.locator(id)??-1,prior=reuse?previous!.lookup.value(id):0,old=prior?Math.floor(prior/RADIX):previous?.lookup?.locator(id)??-1,resolved=value>=0?value:old;if(resolved<0)throw Error('Unknown ink geometry.');values[index]=resolved;const batch=Math.floor(resolved/RADIX);next.uses[batch]++;next.points+=countOf(next.batches,resolved);if(next.points>MAX_INK_POINTS)throw Error('Too many ink points.');if(reuse){if(value>=0||!prior)reuse=false;else{const local=resolved-batch*RADIX,seen=counts![batch]??(counts![batch]=new Uint32Array(previous!.batches[batch]!.count));if(++seen[local]!>prior-old*RADIX)reuse=false}if(!reuse)counts=null}if(exactAdded&&resolved!==expected)exactAdded=false;if((index+1)%8192===0)await pause()}
   counts=null;next.lookup=exactAdded?added:reuse?previous!.lookup:await PersistentInkIdentity.build(rows(values,next),{yieldControl:pause});next.order=await PersistentInkOrder.build(values,options())
  }
  next.account();if(next.bytes>maxBytes||next.batches.length>MAX_BATCHES||next.storedRecords>MAX_STORED_RECORDS||next.storedRecords>Math.max(4096,next.size*2))return next.compact(maxBytes,pause);return next
  }finally{for(const values of scratch)discardScratch(values)}
 }
 private async compact(maxBytes:number,pause:()=>Promise<void>){
  const prefix=graphics.encodeBytes({name:'Ink',aspect:1,strokes:[]}),ids=new Float64Array(this.size),locations=new Float64Array(this.size),scratch=new Set<Float64Array>([ids,locations]);let count=0,length=prefix.length,points=0
  try{
  for(const entry of this.lookup.entries()){const value=entry.locator,{batch,index}=parts(value),held=this.batches[batch]!;ids[count]=entry.id;locations[count++]=value;length+=headerAt(held,index+1)-headerAt(held,index);points+=countOf(this.batches,value);if(count%4096===0)await pause()}
  if(length>maxBytes||length>graphics.MAX_BINARY_BYTES)throw Error('Ink cache is too large.');const bytes=new Uint8Array(length);bytes.set(prefix);const view=new DataView(bytes.buffer);let at=prefix.length
  for(let index=0;index<count;index++){const value=locations[index]!,{batch:prior,index:local}=parts(value),held=this.batches[prior]!,start=headerAt(held,local),end=headerAt(held,local+1);for(let from=start;from<end;from+=65536){const piece=held.bytes.subarray(from,Math.min(end,from+65536));bytes.set(piece,at);at+=piece.length;if(from+65536<end)await pause()}if((index+1)%4096===0)await pause()}
  discardScratch(locations);view.setUint32(12,count,true);view.setUint32(16,points,true);view.setUint32(20,length,true);const batch=await batchOf(bytes,ids,pause);discardScratch(ids);const next=new InkRecordTable();next.batches=[batch];next.indexFactory=this.indexFactory;next.uses=Uint32Array.of(this.length);next.points=this.points;const unique=Float64Array.from({length:count},(_,i)=>i);scratch.add(unique);next.lookup=await PersistentInkIdentity.build(rows(unique,next,this.lookup),{yieldControl:pause});discardScratch(unique);const order=new Float64Array(this.length);scratch.add(order);let position=0;for(const leaf of this.order.allLeaves())for(const value of leaf){order[position++]=next.lookup.locator(this.id(value));if(position%8192===0)await pause()}next.order=await PersistentInkOrder.build(order,{...next.indexFactory(next),yieldControl:pause});next.fullChange=true;next.account();return next
  }finally{for(const values of scratch)discardScratch(values)}
 }
}
