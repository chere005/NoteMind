const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {md}=require('./document-renderer.cjs');
const {replaceIfUnchanged,withFileLock,readExisting}=require('./guarded-write.cjs');
function references(text){const env={},tokens=md.parse(text,env),urls=new Set();for(const t of tokens)for(const c of t.children||[])if(c.type==='image'||c.type==='link_open')urls.add(c.attrGet(c.type==='image'?'src':'href'));return [...urls];}
const rewriteReferences=require('./markdown-reference-rewrite.js');
const rewriteAll=(text,mapping)=>rewriteReferences(md,text,mapping);
function rewrite(text,from,to){return rewriteAll(text,{[from]:to});}
function remapMeta(meta,mapping){meta=structuredClone(meta||{});const attachments={};for(const [name,value]of Object.entries(meta.attachments||{})){const info=value||{};attachments[mapping[name]||name]={...info,thumbnail:mapping[info.thumbnail]||info.thumbnail};}meta.attachments=attachments;if(meta.graphicsPanes)meta.graphicsPanes=Object.fromEntries(Object.entries(meta.graphicsPanes).map(([name,info])=>[mapping[name]||name,info]));return meta;}
function assetMapping(assets,target){const mapping={};const map=name=>{if(mapping[name])return mapping[name];const preview=name.endsWith('.json')&&name.slice(0,-5);return mapping[name]=preview&&Object.hasOwn(assets,preview)?map(preview)+'.json':target(name)};for(const name of Object.keys(assets))map(name);return mapping;}
function assetHash(assets,name){const hash=crypto.createHash('sha256').update(Buffer.from(assets[name],'base64'));if(assets[name+'.json'])hash.update('\0').update(Buffer.from(assets[name+'.json'],'base64'));return hash.digest('hex');}
function canonical(doc){const assets={},mapping=assetMapping(doc.assets||{},name=>/^assets\/[\w./ -]+$/.test(name)&&!name.split('/').some(p=>p==='..'||p==='.'||!p)?name:'assets/'+assetHash(doc.assets,name).slice(0,16)+path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g,''));for(const [name,data]of Object.entries(doc.assets||{}))assets[mapping[name]]=data;return {...doc,text:rewriteAll(doc.text,mapping),assets,meta:remapMeta(doc.meta,mapping)};}
const legacyFolder=file=>path.basename(file,path.extname(file)).replace(/[^\p{L}\p{N}_.-]/gu,'-')+'.assets';
// Exact filenames distinguish names that sanitize to the same stem, including case-sensitive volumes.
function sidecarFolder(file){const name=path.basename(file),stem=legacyFolder(file).slice(0,-7);let short='';for(const c of stem){if(Buffer.byteLength(short+c)>120)break;short+=c;}return (short||'note')+'-'+crypto.createHash('sha256').update(name).digest('hex').slice(0,12)+'.assets';}
async function read(file,text){
 const assets={},base=await fs.realpath(path.dirname(file));let total=0,metadata={};
 for(const folder of [sidecarFolder(file),legacyFolder(file)]){try{const value=JSON.parse(await fs.readFile(path.join(base,folder,'notemind.json'),'utf8'));if(value.sourceName&&value.sourceName!==path.basename(file))continue;if(folder===legacyFolder(file)&&!value.sourceName){const siblings=await fs.readdir(base);if(siblings.some(name=>name!==path.basename(file)&&/\.md$/i.test(name)&&legacyFolder(name)===folder))break;}metadata=value;break;}catch{}}
 const links=references(text),refs=new Set([...links,...links.map(url=>url+'.json'),...Object.keys(metadata.meta?.attachments||{}),...Object.values(metadata.meta?.attachments||{}).map(i=>i?.thumbnail).filter(Boolean),...(metadata.extraAssets||[])]);
 for(const url of refs){if(typeof url!=='string'||/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(url))continue;let decoded;try{decoded=decodeURIComponent(url)}catch{continue;}
  try{const target=await fs.realpath(path.resolve(base,decoded)),relative=path.relative(base,target);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;const stat=await fs.stat(target);if(!stat.isFile()||stat.size>50*1024*1024||total+stat.size>199*1024*1024)continue;const bytes=await fs.readFile(target);total+=bytes.length;assets[url]=bytes.toString('base64');}catch{}
 }
 return {path:file,text,assets,id:metadata.id,title:metadata.title,created:metadata.created,meta:metadata.meta||{}};
}
async function writeMetadata(doc,file){await require('./notes-store.cjs').atomic(path.join(path.dirname(file),sidecarFolder(file),'notemind.json'),JSON.stringify({sourceName:path.basename(file),id:doc.id,title:doc.title,created:doc.created,meta:doc.meta,extraAssets:Object.keys(doc.assets||{}).filter(n=>n.endsWith('.json'))}));}
async function prepare(doc,file,{metadata=true}={}){const assets={},dir=path.dirname(file),folder=sidecarFolder(file),mapping=assetMapping(doc.assets||{},name=>folder+'/'+assetHash(doc.assets,name).slice(0,24)+path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g,''));
 for(const [name,data]of Object.entries(doc.assets||{})){const bytes=Buffer.from(data,'base64'),targetName=mapping[name];await fs.mkdir(path.join(dir,folder),{recursive:true});const target=path.join(dir,targetName);try{await fs.writeFile(target,bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;if(!Buffer.from(await fs.readFile(target)).equals(bytes))throw Error('An attachment with this filename already exists.');}assets[targetName]=data;}
 const next={...doc,text:rewriteAll(doc.text,mapping),assets,meta:remapMeta(doc.meta,mapping)};
 if(metadata)await writeMetadata(next,file);
 return next;
}
const markdown=file=>path.extname(file).toLowerCase()==='.md';
async function absent(file){if(await readExisting(file)!==null)throw Object.assign(Error('An item already exists at '+file),{code:'EEXIST'});}
async function writeDocument(doc,target){await absent(target);const prepared=await prepare(doc,target,{metadata:false});await replaceIfUnchanged(target,Buffer.from(prepared.text),null,{afterCommit:()=>writeMetadata(prepared,target)});return prepared;}
async function copy(source,target,{duplicate=false,move=false}={}){
 if(duplicate&&/\.(nm|wm)$/i.test(source)&&/\.(nm|wm)$/i.test(target)){
  const bytes=await fs.readFile(source),format=require('./notepad-format.cjs'),doc=format.decode(bytes),zip=require('./zip.cjs'),files=zip.unpack(bytes);
  if(files['manifest.json']){const manifest=JSON.parse(files['manifest.json']);manifest.id=crypto.randomUUID();manifest.created=manifest.modified=new Date().toISOString();files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2));await replaceIfUnchanged(target,zip.pack(files),null);}
  else{const extra=Object.fromEntries(['drawing.json','workspace.json'].filter(name=>files[name]).map(name=>[name,JSON.parse(files[name].toString())]));await replaceIfUnchanged(target,format.encode({...doc,id:crypto.randomUUID(),created:new Date().toISOString()},{kind:doc.kind,extra}),null);}
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
async function capture(source,saved){
 const stat=await fs.stat(source),run=async()=>{
  if(stat.isFile())await fs.copyFile(source,saved,require('node:fs').constants.COPYFILE_EXCL);else await fs.cp(source,saved,{recursive:true,force:false,errorOnExist:true});
  if(!stat.isFile())return;
  try{const bytes=await fs.readFile(saved);if(markdown(source)){const doc=await read(source,bytes.toString('utf8'));await fs.mkdir(saved+'.notemind');await fs.writeFile(path.join(saved+'.notemind','document.nm'),require('./notepad-format.cjs').encode(canonical(doc)),{flag:'wx'});}if(!bytes.equals(await fs.readFile(source)))throw Error('The file changed while its recovery copy was being made. Try again.');}
  catch(error){await fs.rm(saved,{recursive:true,force:true});await fs.rm(saved+'.notemind',{recursive:true,force:true});throw error;}
 };
 return stat.isFile()?withFileLock(source,run):run();
}
async function restore(saved,target){
 let bytes;try{bytes=await fs.readFile(path.join(saved+'.notemind','document.nm'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(bytes&&markdown(target))return writeDocument(require('./notepad-format.cjs').decode(bytes),target);
 await fs.cp(saved,target,{recursive:true,force:false,errorOnExist:true});
}
module.exports={read,prepare,writeMetadata,canonical,references,rewrite,sidecarFolder,copy,capture,restore};
