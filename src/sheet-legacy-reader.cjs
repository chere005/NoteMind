// Legacy migration visits scalar tokens twice; it never assembles a point graph.
const {legacyTokenBatches,CanonicalJSON,JSONValue,sha,textSHA,MAX_METADATA_BYTES}=require('./sheet-json-tokens.cjs');
const {sheetRevision,sameSheetRevision}=require('./sheet-revision.cjs'),{metadata,signature}=require('./sheet-schema.cjs');
const {StrokeBinaryBuilder,GeometryBatcher}=require('./sheet-geometry.cjs'),{hashText,hashWriter}=require('./stroke-signature.js');
const MAX_BACKGROUND=150*1024*1024,MAX_PAGES=10000;
class ValueBoundary{
 constructor(visit){this.visit=visit;this.depth=0;this.started=false;this.done=false;}
 after(token){const name=token.name;if(name==='startObject'||name==='startArray'){this.depth++;this.started=true;}else if(name==='endObject'||name==='endArray'){this.depth--;if(!this.depth)this.done=true;}else if(!this.depth&&(name==='endString'||name==='numberValue'||name==='nullValue'||name==='trueValue'||name==='falseValue'))this.done=true;}
 token(token){const result=this.visit(token);if(result?.then)return result.then(()=>this.after(token));this.after(token);}
}
async function visitPages(file,visitor,onBytes){
 let depth=0,page=null,key=null,active=null,pages=0,root=false;
 for await(const batch of legacyTokenBatches(file,{onBytes}))for(const token of batch){
  const name=token.name;
  if(active){const result=active.token(token);if(result?.then)await result;if(active.done){await visitor.endProperty?.(page,key);active=null;key=null;}if(name==='startObject'||name==='startArray')depth++;else if(name==='endObject'||name==='endArray')depth--;continue;}
  if(name==='startArray'&&!root){root=true;depth=1;continue;}
  if(depth===1&&name==='startObject'){if(++pages>MAX_PAGES)throw Error('Too many saved drawing pages.');page=await visitor.startPage(pages-1);depth++;continue;}
  if(depth===2&&name==='keyValue'){if(page.keys.has(token.value))throw Error('Duplicate drawing page property.');page.keys.add(token.value);key=token.value;continue;}
  if(depth===2&&key!==null){active=new ValueBoundary(await visitor.property(page,key));await active.token(token);if(active.done){await visitor.endProperty?.(page,key);active=null;key=null;}if(name==='startObject'||name==='startArray')depth++;else if(name==='endObject'||name==='endArray')depth--;continue;}
  if(depth===2&&name==='endObject'){await visitor.endPage(page);page=null;depth--;continue;}
  if(depth===1&&name==='endArray'){depth--;continue;}
  throw Error('Invalid saved drawing sheets.');
 }
 if(!root||depth||active||!pages)throw Error('Invalid saved drawing sheets.');return pages;
}
function backgroundSink(packs,{onlyPNG=false}={}){
 let bytes=0,parts=[],hash,head='',body=false,nonempty=false,isNull=false;const canonical=sha(),json=new CanonicalJSON(piece=>canonical.update(piece));
 return {token(token){json.token(token);if(token.name==='nullValue'){isNull=true;return;}if(token.name==='startString'||token.name==='endString')return;if(token.name!=='stringChunk')throw Error('Invalid drawing background.');let text=token.value;bytes+=Buffer.byteLength(text);if(bytes>MAX_BACKGROUND)throw Error('Drawing background is too large.');hash=hashText(text,hash);parts.push(Buffer.from(text));if(!body){head+=text;const comma=head.indexOf(',');if(comma<0){if(head.length>128)throw Error('Invalid drawing background.');return;}if(!/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,$/i.test(head.slice(0,comma+1)))throw Error('Invalid drawing background.');if(onlyPNG&&head.slice(0,comma+1)!=='data:image/png;base64,')throw Error('Invalid saved camera picture.');text=head.slice(comma+1);head='';body=true;}if(text){if(!/^[a-z0-9+/=\r\n]+$/i.test(text))throw Error('Invalid drawing background.');nonempty=true;}},async finish(){const digest=canonical.digest('hex');if(isNull)return {value:null,digest};if(!body||!nonempty)throw Error('Invalid drawing background.');const data=Buffer.concat(parts,bytes);parts=[];return {value:{ref:await packs.publish(data),hash,bytes},digest};}};
}
function textSink(){let short='',length=0,hash=sha(),pending='',isString=false,isNull=false;const write=text=>{let value=pending+text;pending='';if(value.length&&/[\uD800-\uDBFF]/.test(value.at(-1))){pending=value.at(-1);value=value.slice(0,-1);}hash.update(value);};return {token(token){if(token.name==='startString'){isString=true;return;}if(token.name==='endString'){if(pending)hash.update(pending);return;}if(token.name==='nullValue'){isNull=true;return;}if(token.name!=='stringChunk')throw Error('Invalid saved drawing signature.');length+=token.value.length;if(length<=256)short+=token.value;write(token.value);},finish(){return {value:isString&&length<=256?short:null,digest:isString?hash.digest('hex'):null,isNull};}};}
async function scanLegacy(file,packs,{index,nextStroke=1,maxMetadataBytes=16*1024*1024,legacyKind='sheet'}={}){
 const before=await sheetRevision(file);if(!before)return null;const fileHash=sha(),pages=[];let needsSecondPass=false,metadataBytes=0;
 await visitPages(file,{
  startPage:at=>({at,keys:new Set(),meta:Object.create(null),metadataBytes:0,properties:[],backdrop:null,saved:null}),
  property(page,key){let sink;if(key===(legacyKind==='camera'?'picture':'backdrop'))sink=backgroundSink(packs,{onlyPNG:legacyKind==='camera'});else if(key==='saved')sink=textSink();else{const digest=textSHA(),canonical=new CanonicalJSON(piece=>digest.update(piece)),value=key==='strokes'?null:new JSONValue({maxBytes:Math.min(MAX_METADATA_BYTES-page.metadataBytes,maxMetadataBytes-metadataBytes)-key.length*2-32}),geometry=key==='strokes'&&index?new LegacyGeometry(packs,index,()=>nextStroke++):null;sink={token(token){canonical.token(token);value?.token(token);return geometry?.token(token);},async finish(){if(geometry)page.geometry=await geometry.finish();return {value:value?.root,metadataBytes:value?value.bytes+key.length*2+32:0,digest:digest.digest('hex')};}};}page.sink=sink;return token=>sink.token(token);},
  async endProperty(page,key){const result=await page.sink.finish();page.metadataBytes+=result.metadataBytes||0;metadataBytes+=result.metadataBytes||0;if(key===(legacyKind==='camera'?'picture':'backdrop'))page.backdrop=result.value;else if(key==='saved')page.saved=result;else if(key!=='strokes')Object.defineProperty(page.meta,key,{value:result.value,enumerable:true});if(key!=='saved'&&key!=='pageId')page.properties.push([key,result.digest]);},
  async endPage(page){if(!page.keys.has('strokes'))throw Error('Invalid drawing strokes.');if(legacyKind==='camera'&&!page.keys.has('picture'))throw Error('Saved camera page picture is missing.');page.metadata=metadata(legacyKind==='camera'?require('./camera-schema.cjs').cameraMetadata(page.meta):page.meta);page.semantic=sha().update(JSON.stringify(page.properties.sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');if(page.geometry){const current=await signature(page.metadata,page.geometry.order,index,page.backdrop?.hash||null);page.metadata.saved=page.saved?.value?.startsWith('nm2:')?page.saved.value:null;if(page.saved?.digest&&!page.saved?.value?.startsWith('nm2:'))needsSecondPass=true;page.materialized={metadata:page.metadata,order:page.geometry.order,binaryBytes:page.geometry.binaryBytes,backdrop:page.backdrop,signature:current,legacySemantic:page.semantic};delete page.geometry;}delete page.sink;delete page.meta;delete page.properties;delete page.keys;pages.push(page);}
 },bytes=>fileHash.update(bytes));
 const after=await sheetRevision(file);if(!sameSheetRevision(before,after))throw Error('Saved drawing sheets changed while migrating.');return {revision:after,sha256:fileHash.digest('hex'),pages,nextStroke,needsSecondPass};
}
class LegacyGeometry{
 constructor(packs,index,allocate){this.batch=new GeometryBatcher(packs);this.builder=index.builder();this.allocate=allocate;this.stroke=null;this.depth=0;this.array=false;this.complete=false;this.count=0;this.binaryBytes=0;}
 token(token){const name=token.name;if(!this.array){if(name!=='startArray'||this.complete)throw Error('Invalid drawing strokes.');this.array=true;return;}if(!this.stroke){if(name==='endArray'){this.array=false;this.complete=true;return;}if(name!=='startObject')throw Error('Invalid graphics stroke.');this.stroke=new StreamedStroke();this.depth=0;}this.stroke.token(token);if(name==='startObject'||name==='startArray')this.depth++;else if(name==='endObject'||name==='endArray')this.depth--;if(!this.depth){const built=this.stroke.finish();this.stroke=null;if(++this.count>2000000)throw Error('This graphics pane has too many strokes.');this.binaryBytes+=built.bytes.length;return this.batch.add({...built,id:this.allocate()}).then(async records=>{for(const record of records)await this.builder.add(record);});}}
 async finish(){if(!this.complete||this.array||this.stroke)throw Error('Invalid drawing strokes.');for(const record of await this.batch.flush())await this.builder.add(record);return {order:await this.builder.finish(),binaryBytes:this.binaryBytes};}
}
class StreamedStroke{
 constructor(){this.builder=new StrokeBinaryBuilder();this.depth=0;this.key=null;this.mode=null;this.point=null;this.pointKey=null;this.seen=new Set();this.hash=hashWriter();this.canonical=new CanonicalJSON(piece=>this.hash.write(piece));this.scalar=null;}
 token(token){
  this.canonical?.token(token);const n=token.name;
  if(n==='startObject'){this.depth++;if(this.depth===3&&this.mode==='points')this.point={};else if(this.depth!==1)throw Error('Invalid graphics point.');return;}
  if(n==='endObject'){if(this.depth===3){if(!this.point||!Object.hasOwn(this.point,'x')||!Object.hasOwn(this.point,'y'))throw Error('Invalid graphics point.');this.builder.point(this.point.x,this.point.y);this.point=null;}this.depth--;return;}
  if(n==='keyValue'){if(this.depth===1){if(this.seen.has(token.value)||!['colorHex','width','points','pressures'].includes(token.value))throw Error('Invalid graphics stroke property.');this.seen.add(token.value);this.key=token.value;}else if(this.depth===3&&this.point&&['x','y'].includes(token.value)&&!Object.hasOwn(this.point,token.value))this.pointKey=token.value;else throw Error('Invalid graphics point property.');return;}
  if(n==='startArray'){if(this.depth!==1||!['points','pressures'].includes(this.key))throw Error('Invalid graphics stroke array.');this.mode=this.key;this.depth++;if(this.mode==='pressures')this.builder.hasPressure=true;return;}
  if(n==='endArray'){if(this.depth!==2)throw Error('Invalid graphics stroke array.');this.depth--;this.mode=null;return;}
  if(n==='startString'){if(this.depth!==1||this.key!=='colorHex')throw Error('Invalid graphics stroke value.');this.scalar='';return;}
  if(n==='stringChunk'){if(this.scalar===null||this.scalar.length+token.value.length>7)throw Error('Invalid graphics stroke colour.');this.scalar+=token.value;return;}
  if(n==='endString'){this.builder.colour=this.scalar;this.scalar=null;return;}
  if(n==='numberValue'){const value=Number(token.value);if(this.depth===1&&this.key==='width')this.builder.width=value;else if(this.depth===3&&this.point&&this.pointKey){this.point[this.pointKey]=value;this.pointKey=null;}else if(this.depth===2&&this.mode==='pressures')this.builder.pressure(value);else throw Error('Invalid graphics stroke number.');return;}
  if(['nullValue','trueValue','falseValue'].includes(n))throw Error('Invalid graphics stroke value.');
 }
 finish(){if(!this.seen.has('points'))throw Error('Invalid graphics stroke points.');return {...this.builder.finish(),hash:this.hash.digest()};}
}
async function escapedStringHash(hash,bytes){hash.update('"');for(let at=0;at<bytes.length;at+=65536)hash.update(JSON.stringify(bytes.subarray(at,at+65536).toString('ascii')).slice(1,-1));hash.update('"');}
async function materializeLegacy(file,scan,packs,index,{selected=()=>true,nextStroke=1,pageId=()=>require('node:crypto').randomUUID()}={}){
 const pages=[];let current=null,stroke=null,strokeDepth=0,strokeArray=false;
 await visitPages(file,{
  startPage:at=>({at,keys:new Set()}),
  property(page,key){
   if(key!=='strokes'||!selected(scan.pages[page.at]))return ()=>{};
   const descriptor=scan.pages[page.at],builder=index.builder(),batch=new GeometryBatcher(packs),old=descriptor.saved?.digest&&!descriptor.saved?.value?.startsWith('nm2:')?textSHA():null;let bytes=0,count=0,first=true;
   old?.update('{"name":'+JSON.stringify(descriptor.metadata.name)+',"aspect":'+JSON.stringify(descriptor.metadata.aspect)+',"strokes":');
   const canonical=old?new CanonicalJSON(piece=>old.update(piece)):null;current={descriptor,builder,batch,old,get bytes(){return bytes;},get count(){return count;}};
   return token=>{
    canonical?.token(token);const n=token.name;
    if(!strokeArray){if(n!=='startArray')throw Error('Invalid drawing strokes.');strokeArray=true;return;}
    if(!stroke){if(n==='endArray'){strokeArray=false;return;}if(n!=='startObject')throw Error('Invalid graphics stroke.');stroke=new StreamedStroke();strokeDepth=0;}
    stroke.token(token);if(n==='startObject'||n==='startArray')strokeDepth++;else if(n==='endObject'||n==='endArray')strokeDepth--;
    if(!strokeDepth){const built=stroke.finish();stroke=null;if(++count>2000000||!Number.isSafeInteger(nextStroke)||nextStroke<=0)throw Error('This graphics pane is too large.');bytes+=built.bytes.length;first=false;return batch.add({...built,id:nextStroke++}).then(async records=>{for(const record of records)await builder.add(record);});}
   };
  },
  async endProperty(page,key){if(key!=='strokes'||!current)return;if(stroke||strokeArray)throw Error('Invalid graphics stroke.');for(const record of await current.batch.flush())await current.builder.add(record);current.order=await current.builder.finish();},
  async endPage(page){if(!selected(scan.pages[page.at]))return;const {descriptor,order,bytes,old}=current,meta={...descriptor.metadata};if(old){old.update(',"backdrop":');if(descriptor.backdrop)await escapedStringHash(old,await packs.read(descriptor.backdrop.ref,MAX_BACKGROUND));else old.update('null');if(meta.paper!==undefined)old.update(',"paper":'+JSON.stringify(meta.paper));old.update('}');}const value=await signature(meta,order,index,descriptor.backdrop?.hash||null);meta.saved=descriptor.saved?.value?.startsWith('nm2:')?descriptor.saved.value:old&&meta.paper&&descriptor.saved?.digest===old.digest('hex')?value:null;pages.push({pageId:pageId(descriptor),metadata:meta,order,binaryBytes:bytes,backdrop:descriptor.backdrop,signature:value,legacySemantic:descriptor.semantic});current=null;}
 });
 if(!sameSheetRevision(scan.revision,await sheetRevision(file)))throw Error('Saved drawing sheets changed while migrating.');return {pages,nextStroke};
}
module.exports={visitPages,scanLegacy,materializeLegacy,StreamedStroke,MAX_BACKGROUND,MAX_PAGES};
