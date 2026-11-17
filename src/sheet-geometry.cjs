const graphics=require('./graphics-pane.js'),{hashText}=require('./stroke-signature.js'),{strokeBytes}=require('./sheet-order-index.cjs');
const CHUNK_BYTES=512*1024,META=Buffer.from(JSON.stringify({name:'Drawing data',aspect:1,backdrop:null})),MAGIC=Buffer.from(graphics.BINARY_MAGIC);
const coordinate=value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(value*10000);
function header(metadata,count,points,bodyBytes){const json=Buffer.from(JSON.stringify(metadata)),length=24+json.length+bodyBytes;if(!Number.isInteger(count)||count<0||count>2000000||!Number.isInteger(points)||points<0||points>2000000||!Number.isSafeInteger(bodyBytes)||bodyBytes<0||!Number.isSafeInteger(length)||length>graphics.MAX_BINARY_BYTES)throw Error('This graphics pane is too large.');const bytes=Buffer.allocUnsafe(length);MAGIC.copy(bytes);bytes.writeUInt32LE(json.length,8);bytes.writeUInt32LE(count,12);bytes.writeUInt32LE(points,16);bytes.writeUInt32LE(bytes.length,20);json.copy(bytes,24);return {bytes,offset:24+json.length};}
class FloatChunks{
 constructor(limit=2000000*16){this.limit=limit;this.chunks=[];this.current=null;this.at=0;this.bytes=0;}
 add(value){if(!Number.isFinite(value))throw Error('Invalid drawing number.');if(this.bytes+8>this.limit)throw Error('This graphics pane has too many points.');if(!this.current||this.at===this.current.length){this.current=Buffer.allocUnsafe(Math.min(65536,this.limit-this.bytes));this.chunks.push(this.current);this.at=0;}this.current.writeDoubleLE(value,this.at);this.at+=8;this.bytes+=8;}
 finish(){if(!this.chunks.length)return Buffer.alloc(0);const parts=this.chunks.slice();parts[parts.length-1]=parts.at(-1).subarray(0,this.at);const result=Buffer.concat(parts,this.bytes);this.chunks=[];this.current=null;return result;}
}
class StrokeBinaryBuilder{
 constructor(){this.points=new FloatChunks();this.pressures=new FloatChunks(2000000*8);this.count=0;this.pressureCount=0;this.hasPressure=false;this.colour=null;this.width=null;}
 point(x,y){if(!coordinate(x)||!coordinate(y))throw Error('Invalid graphics point.');this.points.add(x);this.points.add(y);this.count++;}
 pressure(value){if(!Number.isFinite(value))throw Error('Invalid graphics pressure.');this.hasPressure=true;this.pressures.add(value);this.pressureCount++;}
 finish(){
  if(!/^#[0-9a-f]{6}$/i.test(this.colour)||!coordinate(this.width)||this.width<=0||this.hasPressure&&this.pressureCount!==this.count)throw Error('Invalid graphics stroke.');
  const points=this.points.finish(),pressures=this.pressures.finish(),bytes=Buffer.allocUnsafe(16+this.count*(this.hasPressure?24:16)),colour=parseInt(this.colour.slice(1),16);let flags=this.hasPressure?1:0;for(let i=0;i<6;i++)if(/[A-F]/.test(this.colour[i+1]))flags|=1<<(i+1);bytes[0]=colour>>>16;bytes[1]=(colour>>>8)&255;bytes[2]=colour&255;bytes[3]=flags;bytes.writeDoubleLE(this.width,4);bytes.writeUInt32LE(this.count,12);
  if(!this.hasPressure)points.copy(bytes,16);else for(let i=0,at=16;i<this.count;i++,at+=24){points.copy(bytes,at,i*16,i*16+16);pressures.copy(bytes,at+16,i*8,i*8+8);}return {bytes,points:this.count,...(this.hasPressure?{pressure:true}:{})};
 }
}
function inspectChunk(value){
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(value.buffer,value.byteOffset,value.byteLength);graphics.validateBinary(bytes);const metadataLength=bytes.readUInt32LE(8),metadata=JSON.parse(bytes.subarray(24,24+metadataLength)),count=bytes.readUInt32LE(12),points=bytes.readUInt32LE(16),offsets=new Uint32Array(count+1);if(metadata.backdrop)throw Error('Drawing geometry chunks cannot contain backgrounds.');let offset=24+metadataLength;
 for(let i=0;i<count;i++){offsets[i]=offset;offset+=16+bytes.readUInt32LE(offset+12)*(bytes[offset+3]&1?24:16);}offsets[count]=offset;return {bytes,metadata,count,points,offsets};
}
class GeometryBatcher{
 constructor(packs,{chunkBytes=CHUNK_BYTES}={}){this.packs=packs;this.chunkBytes=chunkBytes;this.pending=[];this.bytes=0;this.points=0;}
 async add(entry){if(!entry||!Number.isSafeInteger(entry.id)||entry.id<=0||typeof entry.hash!=='string'||!/^[a-f0-9]{16}$/.test(entry.hash)||!Buffer.isBuffer(entry.bytes)||entry.bytes.length!==strokeBytes(entry))throw Error('Invalid prepared drawing stroke.');let ready=[];if(this.pending.length&&this.bytes+entry.bytes.length>this.chunkBytes)ready=await this.flush();this.pending.push(entry);this.bytes+=entry.bytes.length;this.points+=entry.points;return ready;}
 async flush(){if(!this.pending.length)return [];const output=header(JSON.parse(META),this.pending.length,this.points,this.bytes);let at=output.offset;for(const entry of this.pending){entry.bytes.copy(output.bytes,at);at+=entry.bytes.length;}const chunk=await this.packs.publish(output.bytes),records=this.pending.map((entry,strokeIndex)=>({id:entry.id,hash:entry.hash,points:entry.points,chunk,strokeIndex,...(entry.pressure?{pressure:true}:{})}));this.pending=[];this.bytes=0;this.points=0;return records;}
}
async function* publishStrokes(packs,entries,options){
 const batch=new GeometryBatcher(packs,options);for await(const entry of entries){const stroke=entry.stroke,bytes=graphics.encodeBytes({name:'Drawing data',aspect:1,strokes:[stroke]}),view=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),offset=24+view.readUInt32LE(8),body=view.subarray(offset),record={id:entry.id,hash:hashText(JSON.stringify(stroke)),bytes:body,points:stroke.points.length,...(stroke.pressures?{pressure:true}:{})};yield*await batch.add(record);}yield*await batch.flush();
}
async function* publishEncoded(packs,chunks){for(const packet of chunks){if(!packet||!(packet.bytes instanceof Uint8Array)||!(packet.identityBytes instanceof Uint8Array))throw Error('Invalid encoded drawing chunk.');const chunk=inspectChunk(packet.bytes),identity=Buffer.from(packet.identityBytes.buffer,packet.identityBytes.byteOffset,packet.identityBytes.byteLength);if(identity.length!==chunk.count*16)throw Error('Invalid encoded drawing identities.');const ref=await packs.publish(chunk.bytes);for(let at=0;at<chunk.count;at++){const start=chunk.offsets[at],id=identity.readDoubleLE(at*16);if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid drawing stroke identity.');yield {id,hash:identity.readUInt32LE(at*16+8).toString(16).padStart(8,'0')+identity.readUInt32LE(at*16+12).toString(16).padStart(8,'0'),chunk:ref,strokeIndex:at,points:chunk.bytes.readUInt32LE(start+12),...(chunk.bytes[start+3]&1?{pressure:true}:{})};}}}
const own=bytes=>bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?new Uint8Array(bytes.buffer):Uint8Array.from(bytes);
class GeometryReader{
 constructor(packs,{maxCacheBytes=16*1024*1024}={}){Object.assign(this,{packs,maxCacheBytes});this.cache=new Map();this.cacheBytes=0;this.last=null;}
 async get(ref){if(this.last?.hash===ref.sha256)return this.last.value;let entry=this.cache.get(ref.sha256);if(entry){this.cache.delete(ref.sha256);this.cache.set(ref.sha256,entry);}else{const value=inspectChunk(await this.packs.read(ref,graphics.MAX_BINARY_BYTES)),bytes=value.bytes.length+value.offsets.byteLength;entry={value,bytes};if(bytes<=this.maxCacheBytes){this.cache.set(ref.sha256,entry);this.cacheBytes+=bytes;for(const [hash,old]of this.cache){if(this.cacheBytes<=this.maxCacheBytes)break;this.cache.delete(hash);this.cacheBytes-=old.bytes;}}}this.last={hash:ref.sha256,value:entry.value};return entry.value;}
 async compact(page,index){
  graphics.validate({...page.metadata,strokes:[],backdrop:null});if(typeof page.metadata.name!=='string'||!Number.isSafeInteger(page.binaryBytes)||page.binaryBytes<0)throw Error('Invalid drawing page.');
  const metadata={name:page.metadata.name,aspect:page.metadata.aspect,paper:page.metadata.paper,extent:page.metadata.extent,backdrop:null};if(24+Buffer.byteLength(JSON.stringify(metadata))+page.binaryBytes+page.order.count*16+(page.backdrop?.ref.rawBytes||page.backdrop?.ref.bytes||0)>256*1024*1024)throw Error('This drawing page is too large to load.');const output=header(metadata,page.order.count,page.order.points,page.binaryBytes),identities=new Uint8Array(page.order.count*16),ids=new DataView(identities.buffer);let at=output.offset,position=0;
  for await(const record of index.records(page.order)){
   const chunk=await this.get(record.chunk);if(record.strokeIndex>=chunk.count)throw Error('Invalid drawing chunk offset.');const start=chunk.offsets[record.strokeIndex],end=chunk.offsets[record.strokeIndex+1];if(end-start!==strokeBytes(record)||!!(chunk.bytes[start+3]&1)!==!!record.pressure||at+end-start>output.bytes.length||position>=page.order.count)throw Error('Invalid drawing stroke data.');chunk.bytes.copy(output.bytes,at,start,end);at+=end-start;ids.setFloat64(position*16,record.id,true);ids.setUint32(position*16+8,parseInt(record.hash.slice(0,8),16),true);ids.setUint32(position*16+12,parseInt(record.hash.slice(8),16),true);position++;
  }
  if(at!==output.bytes.length||position!==page.order.count)throw Error('Invalid drawing page totals.');const backdropBytes=page.backdrop?own(await this.packs.read(page.backdrop.ref,150*1024*1024)):null;
  return {metadata:{...page.metadata,pageId:page.pageId,geometryRevision:page.geometryRevision??page.order.ref?.sha256??null,backdrop:null},bytes:own(output.bytes),identityBytes:identities,backdropBytes};
 }
 clear(){this.cache.clear();this.cacheBytes=0;this.last=null;}
}
module.exports={StrokeBinaryBuilder,FloatChunks,GeometryBatcher,GeometryReader,publishStrokes,publishEncoded,inspectChunk,header,own,coordinate,CHUNK_BYTES};
