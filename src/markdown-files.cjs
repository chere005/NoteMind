const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {md}=require('./document-renderer.cjs');
const {replaceIfUnchanged,withFileLock,readExisting}=require('./guarded-write.cjs');
function references(text){const env={},tokens=md.parse(text,env),urls=new Set();for(const t of tokens)for(const c of t.children||[])if(c.type==='image'||c.type==='link_open')urls.add(c.attrGet(c.type==='image'?'src':'href'));return [...urls];}
const rewriteReferences=require('./markdown-reference-rewrite.js');
const rewriteAll=(text,mapping)=>rewriteReferences(md,text,mapping);
function rewrite(text,from,to){return rewriteAll(text,{[from]:to});}
function remapMeta(meta,mapping){meta=structuredClone(meta||{});const mapped=name=>typeof name==='string'&&Object.hasOwn(mapping,name)?mapping[name]:name;meta.attachments=Object.fromEntries(Object.entries(meta.attachments||{}).map(([name,value])=>{const info=value||{};return [mapped(name),{...info,thumbnail:mapped(info.thumbnail)}];}));if(meta.graphicsPanes)meta.graphicsPanes=Object.fromEntries(Object.entries(meta.graphicsPanes).map(([name,info])=>[mapped(name),info]));return meta;}
function assetMapping(assets,target){const mapping=Object.create(null);const map=name=>{if(Object.hasOwn(mapping,name))return mapping[name];const preview=name.endsWith('.json')&&name.slice(0,-5);return mapping[name]=preview&&Object.hasOwn(assets,preview)?map(preview)+'.json':target(name)};for(const name of Object.keys(assets))map(name);return mapping;}
function assetHash(assets,name){const hash=crypto.createHash('sha256').update(Buffer.from(assets[name],'base64'));if(assets[name+'.json'])hash.update('\0').update(Buffer.from(assets[name+'.json'],'base64'));return hash.digest('hex');}
function canonical(doc){const mapping=assetMapping(doc.assets||{},name=>/^assets\/[\w./ -]+$/.test(name)&&!name.split('/').some(p=>p==='..'||p==='.'||!p)?name:'assets/'+assetHash(doc.assets,name).slice(0,16)+path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g,'')),assets=Object.fromEntries(Object.entries(doc.assets||{}).map(([name,data])=>[mapping[name],data]));return {...doc,text:rewriteAll(doc.text,mapping),assets,meta:remapMeta(doc.meta,mapping)};}
const yieldAsset=()=>new Promise(resolve=>setImmediate(resolve));
async function visitAsset(data,visit){
 if(typeof data!=='string')return require('./archive-codec.cjs').withRawAssetBytes(data,async bytes=>{for(let at=0;at<bytes.length;at+=256*1024){await visit(bytes.subarray(at,at+256*1024));await yieldAsset();}});
 let carry='',padded=false;
 for(let at=0;at<data.length;at+=65536){
  const part=carry+data.slice(at,at+65536).replace(/\s/g,'');if(padded&&part)throw Error('Invalid attachment data.');
  if(!/^[a-z0-9+/]*={0,2}$/i.test(part))throw Error('Invalid attachment data.');
  const length=at+65536>=data.length?part.length:Math.floor(part.length/4)*4,complete=part.slice(0,length);carry=part.slice(length);
  if(complete){if(complete.length%4===1||complete.includes('=')&&complete.length%4)throw Error('Invalid attachment data.');padded=complete.endsWith('=');await visit(Buffer.from(complete,'base64'));}
  await yieldAsset();
 }
 if(carry)throw Error('Invalid attachment data.');
}
async function assetMappingAsync(assets,target){const mapping=Object.create(null);const map=async name=>{if(Object.hasOwn(mapping,name))return mapping[name];const preview=name.endsWith('.json')&&name.slice(0,-5);return mapping[name]=preview&&Object.hasOwn(assets,preview)?await map(preview)+'.json':await target(name);};for(const name of Object.keys(assets))await map(name);return mapping;}
async function assetHashAsync(assets,name){const hash=crypto.createHash('sha256');await visitAsset(assets[name],bytes=>hash.update(bytes));if(assets[name+'.json']){hash.update('\0');await visitAsset(assets[name+'.json'],bytes=>hash.update(bytes));}return hash.digest('hex');}
async function canonicalAsync(doc){
 const input={...doc,assets:{...(doc.assets||{})},meta:structuredClone(doc.meta||{})},assets={},mapping=await assetMappingAsync(input.assets,async name=>/^assets\/[\w./ -]+$/.test(name)&&!name.split('/').some(p=>p==='..'||p==='.'||!p)?name:'assets/'+(await assetHashAsync(input.assets,name)).slice(0,16)+path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g,''));
 for(const [name,data]of Object.entries(input.assets))assets[mapping[name]]=data;
 return {...input,text:rewriteAll(input.text,mapping),assets,meta:remapMeta(input.meta,mapping)};
}
async function matchesAsset(target,data){
 const handle=await fs.open(target,'r');let position=0;
 try{const before=await handle.stat({bigint:true});if(!before.isFile())throw Error('An attachment with this filename already exists.');
  await visitAsset(data,async bytes=>{const existing=Buffer.allocUnsafe(bytes.length);let offset=0;while(offset<existing.length){const result=await handle.read(existing,offset,existing.length-offset,position+offset);if(!result.bytesRead)throw Error('An attachment with this filename already exists.');offset+=result.bytesRead;}if(!existing.equals(bytes))throw Error('An attachment with this filename already exists.');position+=bytes.length;});
  const after=await handle.stat({bigint:true});if(after.size!==BigInt(position)||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw Error('An attachment with this filename already exists.');
 }finally{await handle.close();}
}
async function writeAsset(target,data){
 const temp=target+'.notemind-'+process.pid+'-'+crypto.randomUUID()+'.tmp';let handle;
 try{
  handle=await fs.open(temp,'wx');let position=0;
  await visitAsset(data,async bytes=>{let offset=0;while(offset<bytes.length){const written=await handle.write(bytes,offset,bytes.length-offset,position+offset);if(!written.bytesWritten)throw Error('Attachment write stopped.');offset+=written.bytesWritten;}position+=bytes.length;});
  await handle.sync();await handle.close();handle=null;
  try{await fs.link(temp,target);}catch(error){if(error.code!=='EEXIST')throw error;await matchesAsset(target,data);}
  await require('./snapshot-store.cjs').syncHierarchy(path.dirname(target),path.dirname(target));
 }finally{await handle?.close();await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

const legacyFolder=file=>path.basename(file,path.extname(file)).replace(/[^\p{L}\p{N}_.-]/gu,'-')+'.assets';
// Exact filenames distinguish names that sanitize to the same stem, including case-sensitive volumes.
function sidecarFolder(file){const name=path.basename(file),stem=legacyFolder(file).slice(0,-7);let short='';for(const c of stem){if(Buffer.byteLength(short+c)>120)break;short+=c;}return (short||'note')+'-'+crypto.createHash('sha256').update(name).digest('hex').slice(0,12)+'.assets';}
async function read(file,text){
 const codec=require('./archive-codec.cjs'),{ENTRY_BYTES,GRAPHICS_BYTES,TOTAL_BYTES,validateEntry}=require('./archive-limits.cjs'),scoped=codec.hasRawAssetScope(),assets={},base=await fs.realpath(path.dirname(file));let total=0,metadata={};
 for(const folder of [sidecarFolder(file),legacyFolder(file)]){try{const input=await require('./read-limited.cjs').readLimited(path.join(base,folder,'notemind.json'),ENTRY_BYTES,'Notepad metadata is too large.'),value=await codec.parseJson(input);if(!value||typeof value!=='object'||Array.isArray(value))continue;if(value.sourceName&&value.sourceName!==path.basename(file))continue;if(folder===legacyFolder(file)&&!value.sourceName){const siblings=await fs.readdir(base);if(siblings.some(name=>name!==path.basename(file)&&/\.md$/i.test(name)&&legacyFolder(name)===folder))break;}metadata=value;break;}catch(error){if(scoped)codec.hasRawAssetScope();}}
 const links=references(text),refs=new Set([...links,...links.map(url=>url+'.json'),...Object.keys(metadata.meta?.attachments||{}),...Object.values(metadata.meta?.attachments||{}).map(i=>i?.thumbnail).filter(Boolean),...(metadata.extraAssets||[])]);
 for(const url of refs){if(typeof url!=='string'||/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(url))continue;let decoded;try{decoded=decodeURIComponent(url)}catch{continue;}
  try{
   const requested=path.resolve(base,decoded),admitted=await require('./archive-version-source.cjs').linkedAssetPath(requested,{root:base});if(!admitted)continue;const target=admitted.file,name='assets/linked'+path.extname(decoded).toLowerCase().replace(/[^.a-z0-9]/g,''),maximum=/\.json$/i.test(decoded)?GRAPHICS_BYTES:ENTRY_BYTES;
   if(admitted.bytes>maximum||total+admitted.bytes>TOTAL_BYTES)continue;
   // The scoped importer owns one validated file buffer in the archive worker.
   // Pass the original path so its confinement/identity checks see symlinks too.
   if(scoped){const asset=await codec.importRawAssetFile(requested,{name,root:base});if(total+asset.bytes>TOTAL_BYTES)throw Error('This Notepad is too large. Use fewer or smaller images.');Object.defineProperty(assets,url,{value:asset,enumerable:true,writable:true,configurable:true});total+=asset.bytes;}
   else{const bytes=await require('./read-limited.cjs').readLimited(target,maximum,'Linked attachment is too large.');validateEntry(name,bytes);if(total+bytes.length>TOTAL_BYTES)continue;Object.defineProperty(assets,url,{value:bytes.toString('base64'),enumerable:true,writable:true,configurable:true});total+=bytes.length;}
  }catch(error){if(scoped&&(!error.code||!['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code)))throw error;}
 }
 return {path:file,text,assets,id:metadata.id,title:metadata.title,created:metadata.created,meta:metadata.meta||{}};
}
async function writeMetadata(doc,file){await require('./notes-store.cjs').atomic(path.join(path.dirname(file),sidecarFolder(file),'notemind.json'),JSON.stringify({sourceName:path.basename(file),id:doc.id,title:doc.title,created:doc.created,meta:doc.meta,extraAssets:Object.keys(doc.assets||{}).filter(n=>n.endsWith('.json'))}));}
async function prepare(doc,file,{metadata=true}={}){const assets={},dir=path.dirname(file),folder=sidecarFolder(file),input={...doc.assets},mapping=await assetMappingAsync(input,async name=>folder+'/'+(await assetHashAsync(input,name)).slice(0,24)+path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g,''));
 if(Object.keys(input).length)await fs.mkdir(path.join(dir,folder),{recursive:true});
 for(const [name,data]of Object.entries(input)){const targetName=mapping[name];await writeAsset(path.join(dir,targetName),data);assets[targetName]=data;}
 const next={...doc,text:rewriteAll(doc.text,mapping),assets,meta:remapMeta(doc.meta,mapping)};
 if(metadata)await writeMetadata(next,file);
 return next;
}
const markdown=file=>path.extname(file).toLowerCase()==='.md';
async function scopedAssets(run){
 const codec=require('./archive-codec.cjs');if(codec.hasRawAssetScope())return run();
 const owner=crypto.randomUUID(),lease=await codec.preflightRawAssets([],{owner});let failed=false;
 try{return await lease.run(run);}catch(error){failed=true;throw error;}
 finally{try{await lease.release();await codec.releaseRawAssets(owner);}catch(error){if(!failed&&!['ARCHIVE_RAW_LEASE_LOST','ARCHIVE_RAW_ASSET_MISSING'].includes(error.code))throw error;}}
}
async function absent(file){if(await readExisting(file)!==null)throw Object.assign(Error('An item already exists at '+file),{code:'EEXIST'});}
async function writeDocument(doc,target){await absent(target);const prepared=await prepare(doc,target,{metadata:false});await replaceIfUnchanged(target,Buffer.from(prepared.text),null,{afterCommit:()=>writeMetadata(prepared,target)});return prepared;}
async function copyInScope(source,target,{duplicate=false,move=false}={}){
 if(duplicate&&/\.(nm|wm)$/i.test(source)&&/\.(nm|wm)$/i.test(target)){
  const bytes=await require('./read-limited.cjs').readLimited(source,200*1024*1024,'The Notepad is too large to duplicate.'),input=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes:Uint8Array.from(bytes),duplicated=await require('./archive-codec.cjs').duplicateArchiveOwned(input,{id:crypto.randomUUID()});
  await replaceIfUnchanged(target,duplicated,null);
  return;
 }
 if(!markdown(source)||!markdown(target)||(await fs.stat(source)).isDirectory()){
  if(move){await absent(target);await fs.rename(source,target);}else await fs.cp(source,target,{recursive:true,force:false,errorOnExist:true});return;
 }
 return withFileLock(source,async()=>{
  const bytes=await fs.readFile(source),doc=await read(source,bytes.toString('utf8'));
  if(duplicate)doc.id=crypto.randomUUID();
  await absent(target);const prepared=await prepare(doc,target,{metadata:false});
  if(!bytes.equals(await fs.readFile(source)))throw Error('The file changed while it was being moved. Try again.');
  await replaceIfUnchanged(target,Buffer.from(prepared.text),null,{afterCommit:()=>writeMetadata(prepared,target)});
  if(move){try{if(!bytes.equals(await fs.readFile(source)))throw Error('The file changed while it was being moved. Try again.');await fs.unlink(source);}catch(error){await fs.unlink(target).catch(()=>{});throw error;}}
 });
}
// A raw copy remains compatible with old snapshots; the adjacent Notepad preserves editable assets.
async function captureInScope(source,saved){
 const stat=await fs.stat(source),run=async()=>{
  if(stat.isFile())await fs.copyFile(source,saved,require('node:fs').constants.COPYFILE_EXCL);else await fs.cp(source,saved,{recursive:true,force:false,errorOnExist:true});
  if(!stat.isFile())return;
  try{
   if(markdown(source)){const bytes=await require('./read-limited.cjs').readLimited(saved,50*1024*1024,'The Markdown file is too large.'),doc=await read(source,bytes.toString('utf8'));await fs.mkdir(saved+'.notemind');await fs.writeFile(path.join(saved+'.notemind','document.nm'),await require('./archive-codec.cjs').encode(await canonicalAsync(doc)),{flag:'wx'});}
   const revision=require('./source-file-revision.cjs').sourceFileRevision,options={maxBytes:Number.MAX_SAFE_INTEGER},copied=await revision(saved,options),current=await revision(source,options);
   if(!copied||!current||copied.bytes!==current.bytes||copied.sha256!==current.sha256)throw Error('The file changed while its recovery copy was being made. Try again.');
  }
  catch(error){await fs.rm(saved,{recursive:true,force:true});await fs.rm(saved+'.notemind',{recursive:true,force:true});throw error;}
 };
 return stat.isFile()?withFileLock(source,run):run();
}
async function restoreInScope(saved,target){
 let bytes;try{bytes=await require('./read-limited.cjs').readLimited(path.join(saved+'.notemind','document.nm'),200*1024*1024,'The recovery Notepad is too large.');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(bytes&&markdown(target)){const input=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes:Uint8Array.from(bytes);await writeDocument(await require('./archive-codec.cjs').decodeOwned(input,{files:false}),target);return;}
 await fs.cp(saved,target,{recursive:true,force:false,errorOnExist:true});
}
const copy=(source,target,options)=>scopedAssets(()=>copyInScope(source,target,options)),capture=(source,saved)=>scopedAssets(()=>captureInScope(source,saved)),restore=(saved,target)=>scopedAssets(()=>restoreInScope(saved,target));
module.exports={read,prepare,writeMetadata,canonical,canonicalAsync,references,rewrite,sidecarFolder,copy,capture,restore};
module.exports.legacyFolder=legacyFolder;
module.exports.remapMeta=remapMeta;
module.exports.assetMapping=assetMapping;
