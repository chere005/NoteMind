// Small immutable order nodes let an append replace only the tail path.
const {validateRef}=require('./sheet-pack-store.cjs');
const LEAF=256,FANOUT=64,MAX_STROKES=2000000,MAX_POINTS=2000000,MAX_NODE=256*1024,MAGIC=Buffer.from('NMSIDX1\n');
const FILTER_BYTES=256;
function addPack(filter,pack){const bytes=Buffer.from(pack.replaceAll('-',''),'hex');for(let at=0;at<6;at+=2){const bit=bytes.readUInt16LE(at)&2047;filter[bit>>3]|=1<<(bit&7);}}
function packFilter(ref,children,records){const value=Buffer.alloc(FILTER_BYTES);addPack(value,ref.pack);if(records)for(const pack of new Set(records.map(record=>record.chunk.pack)))addPack(value,pack);else for(const child of children){if(!child.packFilter)return null;const bytes=Buffer.from(child.packFilter,'base64');for(let at=0;at<FILTER_BYTES;at++)value[at]|=bytes[at];}return value.toString('base64');}
function mayContain(root,packs){if(!root.packFilter)return true;const bytes=Buffer.from(root.packFilter,'base64');for(const pack of packs){const probe=Buffer.alloc(FILTER_BYTES);addPack(probe,pack);let found=true;for(let at=0;at<FILTER_BYTES;at++)if((probe[at]&bytes[at])!==probe[at]){found=false;break;}if(found)return true;}return false;}
const hashOK=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value);
function validRecord(record){if(!record||!Number.isSafeInteger(record.id)||record.id<=0||!hashOK(record.hash)||!Number.isInteger(record.points)||record.points<0||record.points>MAX_POINTS||record.pressure!=null&&typeof record.pressure!=='boolean'||!Number.isInteger(record.strokeIndex)||record.strokeIndex<0||record.strokeIndex>=MAX_STROKES)throw Error('Invalid drawing stroke reference.');validateRef(record.chunk);return record;}
const strokeBytes=record=>16+record.points*(record.pressure?24:16);
function descriptor(value){if(!value||!Number.isInteger(value.count)||value.count<0||value.count>MAX_STROKES||!Number.isInteger(value.points)||value.points<0||value.points>MAX_POINTS||!Number.isInteger(value.height)||value.height<0||value.height>8||!value.count&&(value.points||value.ref||value.height)||value.count&&!value.height||value.packFilter!=null&&(typeof value.packFilter!=='string'||Buffer.from(value.packFilter,'base64').length!==FILTER_BYTES||Buffer.from(value.packFilter,'base64').toString('base64')!==value.packFilter))throw Error('Invalid drawing order root.');if(value.count)validateRef(value.ref,MAX_NODE);return value;}
const empty=()=>({ref:null,count:0,points:0,height:0});
function encodeLeaf(records){
 if(!records.length||records.length>LEAF)throw Error('Invalid drawing order leaf.');const chunks=[],byHash=new Map();let points=0;
 for(const record of records){validRecord(record);points+=record.points;if(points>MAX_POINTS)throw Error('This graphics pane has too many points.');if(!byHash.has(record.chunk.sha256)){byHash.set(record.chunk.sha256,chunks.length);chunks.push(record.chunk);}}
 const metadata=Buffer.from(JSON.stringify({chunks})),bytes=Buffer.allocUnsafe(24+metadata.length+records.length*32);MAGIC.copy(bytes);bytes.writeUInt32LE(metadata.length,8);bytes.writeUInt32LE(records.length,12);bytes.writeDoubleLE(points,16);metadata.copy(bytes,24);let offset=24+metadata.length;
 for(const record of records){bytes.writeDoubleLE(record.id,offset);bytes.writeUInt32LE(parseInt(record.hash.slice(0,8),16),offset+8);bytes.writeUInt32LE(parseInt(record.hash.slice(8),16),offset+12);bytes.writeUInt32LE(record.points,offset+16);bytes.writeUInt32LE(byHash.get(record.chunk.sha256),offset+20);bytes.writeUInt32LE(record.strokeIndex,offset+24);bytes.writeUInt32LE(record.pressure?1:0,offset+28);offset+=32;}
 if(bytes.length>MAX_NODE)throw Error('Drawing order leaf is too large.');return bytes;
}
function decodeLeaf(bytes){
 if(bytes.length<24||!bytes.subarray(0,8).equals(MAGIC))throw Error('Invalid drawing order leaf.');const length=bytes.readUInt32LE(8),count=bytes.readUInt32LE(12),points=bytes.readDoubleLE(16);if(!count||count>LEAF||length>MAX_NODE||24+length+count*32!==bytes.length)throw Error('Invalid drawing order leaf size.');
 const metadata=JSON.parse(bytes.subarray(24,24+length).toString('utf8'));if(!Array.isArray(metadata.chunks)||!metadata.chunks.length||metadata.chunks.length>LEAF)throw Error('Invalid drawing chunk index.');metadata.chunks.forEach(ref=>validateRef(ref));const records=[];let offset=24+length,seen=0;
 for(let i=0;i<count;i++){const chunk=metadata.chunks[bytes.readUInt32LE(offset+20)],flags=bytes.readUInt32LE(offset+28),record={id:bytes.readDoubleLE(offset),hash:bytes.readUInt32LE(offset+8).toString(16).padStart(8,'0')+bytes.readUInt32LE(offset+12).toString(16).padStart(8,'0'),points:bytes.readUInt32LE(offset+16),chunk,strokeIndex:bytes.readUInt32LE(offset+24),...(flags&1?{pressure:true}:{})};if(flags>1)throw Error('Invalid drawing order flags.');validRecord(record);records.push(record);seen+=record.points;offset+=32;}
 if(seen!==points||seen>MAX_POINTS)throw Error('Invalid drawing point count.');return {kind:'leaf',height:1,count,points,records};
}
// Read-only signatures need every validation proof, but not a graph of stroke
// records or newly formatted per-stroke hash strings. Validate the complete
// bounded leaf before publishing any words to the caller.
function inspectLeafFingerprints(bytes,check=()=>{}){
 if(bytes.length<24||!bytes.subarray(0,8).equals(MAGIC))throw Error('Invalid drawing order leaf.');const length=bytes.readUInt32LE(8),count=bytes.readUInt32LE(12),points=bytes.readDoubleLE(16);if(!count||count>LEAF||length>MAX_NODE||24+length+count*32!==bytes.length)throw Error('Invalid drawing order leaf size.');
 const metadata=JSON.parse(bytes.subarray(24,24+length).toString('utf8'));if(!Array.isArray(metadata.chunks)||!metadata.chunks.length||metadata.chunks.length>LEAF)throw Error('Invalid drawing chunk index.');metadata.chunks.forEach(ref=>validateRef(ref));const used=new Set();let seen=0;
 for(let at=24+length,end=bytes.length;at<end;at+=32){check();const id=bytes.readDoubleLE(at),n=bytes.readUInt32LE(at+16),chunk=bytes.readUInt32LE(at+20),stroke=bytes.readUInt32LE(at+24),flags=bytes.readUInt32LE(at+28);if(!Number.isSafeInteger(id)||id<=0||n>MAX_POINTS||chunk>=metadata.chunks.length||stroke>=MAX_STROKES||flags>1)throw Error('Invalid drawing stroke reference.');seen+=n;used.add(chunk);}
 if(seen!==points||seen>MAX_POINTS)throw Error('Invalid drawing point count.');return{count,points,offset:24+length,chunks:metadata.chunks,used};
}
// Cache decoded ownership, not wire bytes. Allow for wide/cons strings, boxed
// numbers, spare array capacity and property storage; shared chunk refs count once.
function retainedNodeBytes(node,limit=Infinity){
 const seen=new Set(),pending=[node];let bytes=0;
 while(pending.length){const value=pending.pop();if(value==null||typeof value==='boolean')continue;if(typeof value==='string'){bytes+=64+value.length*2;}else if(typeof value==='number'){bytes+=16;}else if(typeof value!=='object')return Infinity;else if(!seen.has(value)){seen.add(value);if(ArrayBuffer.isView(value)){bytes+=128;pending.push(value.buffer);}else if(value instanceof ArrayBuffer){bytes+=128+value.byteLength;}else{const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);if(!array&&prototype!==Object.prototype&&prototype!==null)return Infinity;bytes+=array?64+value.length*16:128;if(bytes>limit)return bytes;for(const key of Reflect.ownKeys(value)){if(array&&key==='length')continue;const property=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!property||!Object.hasOwn(property,'value'))return Infinity;if(!array||!(/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<value.length))bytes+=32+key.length*2;if(bytes>limit)return bytes;pending.push(property.value);}}}if(bytes>limit)return bytes;
 }return bytes;
}
class SheetOrderIndex{
 constructor(packs,{maxCacheBytes=8*1024*1024,maxCacheEntries=512}={}){Object.assign(this,{packs,maxCacheBytes,maxCacheEntries});this.cache=new Map();this.cacheBytes=0;this.cacheRecords=0;}
 remember(ref,node){const prior=this.cache.get(ref.sha256),bytes=320+retainedNodeBytes(node,this.maxCacheBytes);if(prior){this.cacheBytes-=prior.bytes;this.cacheRecords-=prior.records;}this.cache.delete(ref.sha256);if(bytes>this.maxCacheBytes||this.maxCacheEntries<=0)return;const records=node.records?.length||0;this.cache.set(ref.sha256,{node,bytes,records});this.cacheBytes+=bytes;this.cacheRecords+=records;for(const [hash,value]of this.cache){if(this.cacheBytes<=this.maxCacheBytes&&this.cache.size<=this.maxCacheEntries)break;this.cache.delete(hash);this.cacheBytes-=value.bytes;this.cacheRecords-=value.records;}}
 async leaf(records){const ref=await this.packs.publish(encodeLeaf(records)),node={kind:'leaf',height:1,count:records.length,points:records.reduce((n,r)=>n+r.points,0),records:records.slice()};this.remember(ref,node);return {ref,count:node.count,points:node.points,height:1,packFilter:packFilter(ref,null,records)};}
 async branch(children){
  if(!children.length||children.length>FANOUT)throw Error('Invalid drawing index branch.');const height=children[0].height+1,count=children.reduce((n,c)=>n+c.count,0),points=children.reduce((n,c)=>n+c.points,0);for(const child of children){descriptor(child);if(child.height!==height-1)throw Error('Invalid drawing index height.');}
  const node={format:'notemind-sheet-index',version:1,kind:'branch',height,count,points,children};descriptor({ref:children[0].ref,count,points,height});const ref=await this.packs.publishJSON(node,MAX_NODE);this.remember(ref,node);return {ref,count,points,height,packFilter:packFilter(ref,children)};
 }
 async node(root,options={}){
  options.work?.check();descriptor(root);if(!root.count)return null;let value=this.cache.get(root.ref.sha256)?.node;
  if(options.requireBranch&&value&&value.kind!=='branch')throw Error('Invalid drawing order branch.');
  if(!value){const bytes=await this.packs.read(root.ref,MAX_NODE,options);options.work?.check();if(bytes.subarray(0,8).equals(MAGIC)){if(options.requireBranch)throw Error('Invalid drawing order branch.');value=decodeLeaf(bytes);}else{
   value=JSON.parse(bytes.toString('utf8'));if(!value||value.format!=='notemind-sheet-index'||value.version!==1||value.kind!=='branch'||!Array.isArray(value.children)||!value.children.length||value.children.length>FANOUT)throw Error('Invalid drawing order branch.');
   let count=0,points=0;for(const child of value.children){descriptor(child);if(child.height!==value.height-1)throw Error('Invalid drawing index height.');count+=child.count;points+=child.points;}if(count!==value.count||points!==value.points)throw Error('Invalid drawing index totals.');
  }this.remember(root.ref,value);}
  if(value.count!==root.count||value.points!==root.points||value.height!==root.height)throw Error('Invalid drawing order descriptor.');if(root.packFilter&&packFilter(root.ref,value.children,value.records)!==root.packFilter)throw Error('Invalid drawing pack membership.');return value;
 }
 async build(records){
  if(!Array.isArray(records)||records.length>MAX_STROKES)throw Error('This graphics pane has too many strokes.');if(!records.length)return empty();let level=[];for(let at=0;at<records.length;at+=LEAF)level.push(await this.leaf(records.slice(at,at+LEAF)));while(level.length>1){const next=[];for(let at=0;at<level.length;at+=FANOUT)next.push(await this.branch(level.slice(at,at+FANOUT)));level=next;}return level[0];
 }
 builder(){
  const levels=[],leaf=[];let count=0,points=0;
  const add=async(node,level=0)=>{(levels[level]||=[]).push(node);if(levels[level].length===FANOUT){const branch=await this.branch(levels[level]);levels[level]=[];await add(branch,level+1);}};
  let done=false;return {add:async record=>{if(done)throw Error('Drawing index is already complete.');validRecord(record);if(++count>MAX_STROKES||(points+=record.points)>MAX_POINTS)throw Error('This graphics pane is too large.');leaf.push(record);if(leaf.length===LEAF){await add(await this.leaf(leaf));leaf.length=0;}},finish:async()=>{
  if(done)throw Error('Drawing index is already complete.');done=true;
  if(leaf.length)await add(await this.leaf(leaf));if(!count)return empty();
  for(let level=0;level<levels.length;level++)if(levels[level]?.length){const higher=levels.slice(level+1).some(nodes=>nodes?.length);if(!higher&&levels[level].length===1)return levels[level][0];const next=await this.branch(levels[level]);levels[level]=[];await add(next,level+1);}
  throw Error('Drawing index could not be completed.');
  }};
 }
 async buildFrom(records){const builder=this.builder();for await(const record of records)await builder.add(record);return builder.finish();}
 async append(root,records){
  descriptor(root);if(!records.length)return root;if(!root.count)return this.build(records);if(root.count+records.length>MAX_STROKES||root.points+records.reduce((n,r)=>n+validRecord(r).points,0)>MAX_POINTS)throw Error('This graphics pane is too large.');
  const appendAt=async current=>{const node=await this.node(current);if(node.kind==='leaf'){const combined=[...node.records,...records],next=[];for(let at=0;at<combined.length;at+=LEAF)next.push(await this.leaf(combined.slice(at,at+LEAF)));return next;}
   const children=node.children.slice(),tail=children.pop(),updated=await appendAt(tail),combined=[...children,...updated],next=[];for(let at=0;at<combined.length;at+=FANOUT)next.push(await this.branch(combined.slice(at,at+FANOUT)));return next;};
  let level=await appendAt(root);while(level.length>1){const next=[];for(let at=0;at<level.length;at+=FANOUT)next.push(await this.branch(level.slice(at,at+FANOUT)));level=next;}return level[0];
 }
 async *records(root,ancestors=new Set(),options={}){
  options.work?.check();descriptor(root);if(!root.count)return;if(ancestors.has(root.ref.sha256))throw Error('Cyclic drawing index.');const path=new Set(ancestors);path.add(root.ref.sha256);const node=await this.node(root,options);options.work?.check();if(node.kind==='leaf'){for(const record of node.records){options.work?.check();yield record;if(options.work?.poll())await options.work.pause();}return;}for(const child of node.children){options.work?.check();yield*this.records(child,path,options);}
 }
 async visitFingerprintWords(root,visit,options={}){
  if(typeof visit!=='function')throw Error('Invalid drawing fingerprint visitor.');let work=0;
  const check=()=>{if(options.signal?.aborted)throw Object.assign(Error('Drawing signature cancelled.'),{name:'AbortError'});options.work?.check();};
  const walk=async(current,ancestors)=>{
   check();descriptor(current);if(!current.count)return;if(ancestors.has(current.ref.sha256))throw Error('Cyclic drawing index.');const path=new Set(ancestors);path.add(current.ref.sha256);
   if(current.height===1){
    const bytes=await this.packs.read(current.ref,MAX_NODE,options);check();const leaf=inspectLeafFingerprints(bytes,check);if(leaf.count!==current.count||leaf.points!==current.points)throw Error('Invalid drawing order descriptor.');
    if(current.packFilter){const filter=Buffer.alloc(FILTER_BYTES);addPack(filter,current.ref.pack);for(const index of leaf.used)addPack(filter,leaf.chunks[index].pack);if(filter.toString('base64')!==current.packFilter)throw Error('Invalid drawing pack membership.');}
    check();for(let at=leaf.offset;at<bytes.length;at+=32){check();visit(bytes.readUInt32LE(at+8),bytes.readUInt32LE(at+12));}
    work+=leaf.count;if(work>=8192||options.work?.poll()){work=0;await(options.work?.pause?options.work.pause():options.yieldControl?options.yieldControl():new Promise(setImmediate));check();}return;
   }
   const node=await this.node(current,{...options,requireBranch:true});check();for(const child of node.children)await walk(child,path);
  };
  await walk(root,new Set());check();
 }
 stats(){return {cacheBytes:this.cacheBytes,cacheEntries:this.cache.size,cacheRecords:this.cacheRecords};}
 clear(){this.cache.clear();this.cacheBytes=0;this.cacheRecords=0;}
}
module.exports={SheetOrderIndex,encodeLeaf,decodeLeaf,inspectLeafFingerprints,retainedNodeBytes,validRecord,strokeBytes,descriptor,empty,mayContain,packFilter,LEAF,FANOUT,MAX_STROKES,MAX_POINTS,MAX_NODE};
