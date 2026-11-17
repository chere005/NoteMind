// Internal version storage. Public .nm files and recovery .wm archives remain self-contained.
const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {TextEncoder}=require('node:util'),{AsyncLocalStorage}=require('node:async_hooks'),{isMarkedAsUntransferable}=require('node:worker_threads'),assetContext=new AsyncLocalStorage();
const {readLimited}=require('./read-limited.cjs');
const {ENTRY_BYTES:ENTRY_LIMIT,TOTAL_BYTES:TOTAL_LIMIT,maximumEntryBytes,validateEntry}=require('./archive-limits.cjs');
const ASSET_LIMIT=9998,CACHE_ENTRIES=2048,MANIFEST_LIMIT=384*1024*1024,encoder=new TextEncoder();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validAsset=name=>/^assets\/[\w./ -]+$/.test(name)&&!name.split('/').some(part=>!part||part==='.'||part==='..');
const validID=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id);
const objectFile=(root,hash)=>{if(!validHash(hash))throw Error('Invalid snapshot asset identity.');return path.join(root,'objects',hash.slice(0,2),hash);};
const manifestFile=(root,id)=>{if(!validID(id))throw Error('Invalid snapshot identity.');return path.join(root,'versions',id+'.snapshot.json');};
const metadataOf=document=>{const {text,...metadata}=document;return metadata;};
const manifestChecksum=manifest=>sha(JSON.stringify({document:manifest.document,assets:manifest.assets,textBytes:manifest.textBytes}));
function validateManifest(manifest,{verifyIntegrity=false}={}){
 if(!manifest||manifest.format!=='notemind-snapshot'||manifest.version!==1||!manifest.document||typeof manifest.document.text!=='string'||!manifest.assets||typeof manifest.assets!=='object'||Array.isArray(manifest.assets)||!validHash(manifest.checksum))throw Error('Invalid version snapshot.');
 const entries=Object.entries(manifest.assets),textBytes=manifest.textBytes,lengths=new Map();let total=textBytes;
 if(!Number.isSafeInteger(textBytes)||textBytes<0||textBytes>ENTRY_LIMIT||entries.length>ASSET_LIMIT)throw Error('Version snapshot is too large.');
 for(const [name,ref]of entries){if(!validAsset(name)||!ref||!validHash(ref.hash)||!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.bytes>maximumEntryBytes(name)||(lengths.has(ref.hash)&&lengths.get(ref.hash)!==ref.bytes))throw Error('Invalid version asset reference.');lengths.set(ref.hash,ref.bytes);total+=ref.bytes;}
 if(total>TOTAL_LIMIT)throw Error('Version snapshot is too large.');
 if(verifyIntegrity&&(Buffer.byteLength(manifest.document.text)!==textBytes||Buffer.byteLength(JSON.stringify(metadataOf(manifest.document)))>ENTRY_LIMIT||manifestChecksum(manifest)!==manifest.checksum))throw Error('Version metadata is damaged.');return manifest;
}
// Called in the archive worker. Each asset is decoded/hashed once; known objects are not returned over IPC.
function prepareSnapshot(doc,{knownHashes=[],previousHash=null,copyObjectBytes=true}={}){
 if(!doc||typeof doc.text!=='string')throw Error('Invalid version document.');
 const assets={},objects=new Map(),known=new Set(knownHashes),document={text:doc.text,id:doc.id,title:doc.title||'',meta:doc.meta||{},created:doc.created},textBytes=Buffer.byteLength(doc.text);let total=textBytes;
 if(total>ENTRY_LIMIT)throw Error('Version snapshot is too large.');
 if(Buffer.byteLength(JSON.stringify(metadataOf(document)))>ENTRY_LIMIT)throw Error('Version metadata is too large.');
 const entries=Object.entries(doc.assets||{});if(entries.length>ASSET_LIMIT)throw Error('Version snapshot has too many assets.');
 for(const [name,value]of entries){
  if(!validAsset(name))throw Error('Invalid version asset.');const hooks=assetContext.getStore();
  const resolved=hooks?.assetBytes?.(name,value);if(resolved===undefined&&typeof value!=='string')throw Error('Invalid version asset.');const bytes=resolved===undefined?Buffer.from(value,'base64'):Buffer.from(resolved.buffer,resolved.byteOffset,resolved.byteLength);if(!hooks?.validateAsset?.(name,bytes))validateEntry(name,bytes);if((total+=bytes.length)>TOTAL_LIMIT)throw Error('Version snapshot is too large.');
  const cached=assetContext.getStore()?.assetInfo?.(name,bytes),hash=cached?.sha256||sha(bytes);if(cached&&cached.bytes!==bytes.length)throw Error('Invalid version asset digest.');assets[name]={hash,bytes:bytes.length};if(!known.has(hash)&&!objects.has(hash))objects.set(hash,{hash,bytes:copyObjectBytes?Uint8Array.from(bytes):bytes});
 }
 const manifest={format:'notemind-snapshot',version:1,document,assets,textBytes};manifest.checksum=manifestChecksum(manifest);
 // Fingerprint every persisted field, including explicit title/identity/created date.
 const contentHash='snapshot2:'+manifest.checksum;
 const legacyHash=validHash(previousHash)?legacyContentHash(doc):null;
 const unchanged=previousHash===contentHash||(legacyHash!==null&&previousHash===legacyHash);
 const manifestBytes=unchanged?null:encoder.encode(JSON.stringify(manifest));if(manifestBytes?.byteLength>MANIFEST_LIMIT)throw Error('Version metadata is too large.');
 return {manifest,manifestBytes,contentHash,legacyHash,unchanged,objects:unchanged?[]:[...objects.values()]};
}
const discard=bytes=>{const backing=bytes?.buffer;if(backing instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===backing.byteLength&&!isMarkedAsUntransferable?.(backing)&&typeof backing.transfer==='function')try{backing.transfer(0)}catch{}};
function assetSource(hooks,name,value){return async function*(){
 const stream=await hooks?.assetSource?.(name,value);if(stream!==undefined){yield*stream;return;}
 const resolved=hooks?.assetBytes?.(name,value);if(resolved===undefined&&typeof value!=='string')throw Error('Invalid version asset.');const bytes=resolved===undefined?Buffer.from(value,'base64'):resolved;
 try{if(!(bytes instanceof Uint8Array))throw Error('Invalid version asset.');for(let at=0;at<bytes.length;at+=256*1024)yield bytes.subarray(at,Math.min(bytes.length,at+256*1024));}finally{if(resolved===undefined)discard(bytes);}
};}
function checkedInfo(name,info){if(!info||!Number.isSafeInteger(info.bytes)||info.bytes<0||info.bytes>maximumEntryBytes(name)||!validHash(info.sha256))throw Error('Invalid version asset digest.');return{hash:info.sha256,bytes:info.bytes};}
// The worker's validated raw descriptors provide immutable identities. Keep only
// metadata and lazy sources here; generic byte/base64 adapters remain supported.
async function prepareSnapshotSources(doc,{previousHash=null}={}){
 if(!doc||typeof doc.text!=='string')throw Error('Invalid version document.');const hooks=assetContext.getStore(),entries=Object.entries(doc.assets||{}),assets={},objects=new Map();let total=Buffer.byteLength(doc.text);
 if(total>ENTRY_LIMIT||entries.length>ASSET_LIMIT)throw Error('Version snapshot is too large.');if(Buffer.byteLength(JSON.stringify(metadataOf({text:doc.text,id:doc.id,title:doc.title||'',meta:doc.meta||{},created:doc.created})))>ENTRY_LIMIT)throw Error('Version metadata is too large.');
 for(const[name,value]of entries){
  if(!validAsset(name))throw Error('Invalid version asset.');let ref;const info=hooks?.assetSource?hooks.assetInfo?.(name):undefined;
  if(info&&hooks?.validateAsset?.(name))ref=checkedInfo(name,info);
  else{const resolved=hooks?.assetBytes?.(name,value);if(resolved===undefined&&typeof value!=='string')throw Error('Invalid version asset.');const bytes=resolved===undefined?Buffer.from(value,'base64'):resolved;
   try{if(!(bytes instanceof Uint8Array))throw Error('Invalid version asset.');if(!hooks?.validateAsset?.(name,bytes))validateEntry(name,bytes);const cached=hooks?.assetInfo?.(name,bytes);ref=checkedInfo(name,cached||{bytes:bytes.length,sha256:sha(bytes)});if(ref.bytes!==bytes.length)throw Error('Invalid version asset digest.');}finally{if(resolved===undefined)discard(bytes);}
  }
  if((total+=ref.bytes)>TOTAL_LIMIT)throw Error('Version snapshot is too large.');assets[name]=ref;if(!objects.has(ref.hash))objects.set(ref.hash,{hash:ref.hash,bytes:ref.bytes,source:assetSource(hooks,name,value)});
 }
 const prepared=prepareReferences(doc,assets,{previousHash}),legacyHash=validHash(previousHash)?await legacySourceHash(doc,objects,assets):null;prepared.legacyHash=legacyHash;
 if(legacyHash!==null&&legacyHash===previousHash){prepared.unchanged=true;discard(prepared.manifestBytes);prepared.manifestBytes=null;}
 // Include lazy sources for known/unchanged references too. Known hashes are
 // hints, so a missing CAS object can be healed without a second eager pass.
 prepared.objects=[...objects.values()];return prepared;
}
async function legacySourceHash(doc,objects,assets){
 const hash=createHash('sha256').update('{"text":'+JSON.stringify(doc.text)),tail=doc.meta!==undefined?',"meta":'+JSON.stringify(doc.meta):'';
 if(doc.assets!==undefined){hash.update(',"assets":');if(doc.assets===null)hash.update('null');else{hash.update('{');let at=0;for(const[name,value]of Object.entries(doc.assets||{})){
  hash.update((at++?',':'')+JSON.stringify(name)+':');if(typeof value==='string'){hash.update(JSON.stringify(value));continue;}
  const ref=assets[name];if(value?.chars!==4*Math.ceil(ref.bytes/3))return null;let length=0,carried=0;const carry=Buffer.allocUnsafeSlow(3),digest=createHash('sha256');hash.update('"');
  try{for await(const bytes of objects.get(ref.hash).source()){if(!(bytes instanceof Uint8Array)||length+bytes.length>ref.bytes)throw Error('Version source length changed.');length+=bytes.length;digest.update(bytes);let offset=0;if(carried){while(carried<3&&offset<bytes.length)carry[carried++]=bytes[offset++];if(carried===3){hash.update(carry.toString('base64'));carried=0;}}const complete=bytes.length-offset-(bytes.length-offset)%3;if(complete)hash.update(Buffer.from(bytes.buffer,bytes.byteOffset+offset,complete).toString('base64'));offset+=complete;while(offset<bytes.length)carry[carried++]=bytes[offset++];}if(length!==ref.bytes||digest.digest('hex')!==ref.hash)throw Error('Version source digest changed.');if(carried)hash.update(carry.subarray(0,carried).toString('base64'));}finally{discard(carry);}hash.update('"');
 }hash.update('}');}}
 hash.update(tail);return hash.update('}').digest('hex');
}
function legacyContentHash(doc){
 const hooks=assetContext.getStore(),entries=Object.entries(doc.assets||{});if(!entries.some(([,value])=>typeof value!=='string'))return sha(JSON.stringify({text:doc.text,assets:doc.assets,meta:doc.meta}));
 const hash=createHash('sha256').update('{"text":'+JSON.stringify(doc.text)+',"assets":{');let at=0;for(const [name,value]of entries){hash.update((at++?',':'')+JSON.stringify(name)+':');if(typeof value==='string')hash.update(JSON.stringify(value));else{const bytes=hooks?.assetBytes?.(name,value);if(!bytes||value.chars!==4*Math.ceil(bytes.length/3))return null;hash.update('"');for(let offset=0;offset<bytes.length;offset+=48*1024)hash.update(Buffer.from(bytes.buffer,bytes.byteOffset+offset,Math.min(48*1024,bytes.length-offset)).toString('base64'));hash.update('"');}}hash.update('}');if(doc.meta!==undefined)hash.update(',"meta":'+JSON.stringify(doc.meta));return hash.update('}').digest('hex');
}
function prepareReferences(doc,assets,{previousHash=null}={}){
 if(!doc||typeof doc.text!=='string')throw Error('Invalid version document.');const document={text:doc.text,id:doc.id,title:doc.title||'',meta:doc.meta||{},created:doc.created},textBytes=Buffer.byteLength(doc.text),manifest={format:'notemind-snapshot',version:1,document,assets,textBytes};manifest.checksum=manifestChecksum(manifest);validateManifest(manifest,{verifyIntegrity:true});const contentHash='snapshot2:'+manifest.checksum,unchanged=previousHash===contentHash,manifestBytes=unchanged?null:encoder.encode(JSON.stringify(manifest));if(manifestBytes?.byteLength>MANIFEST_LIMIT)throw Error('Version metadata is too large.');return {manifest,manifestBytes,contentHash,legacyHash:null,unchanged,objects:[]};
}
function withAssetContext(hooks,run){return assetContext.run(hooks,run);}
function remember(cache,hash,stat){cache.delete(hash);cache.set(hash,{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});while(cache.size>CACHE_ENTRIES)cache.delete(cache.keys().next().value);}
const sameStat=(a,b)=>a&&b&&['dev','ino','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
async function mapLimit(values,limit,run){let next=0,failure;await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(!failure&&next<values.length){const value=values[next++];try{await run(value);}catch(error){failure ||= error;}}}));if(failure)throw failure;}
async function syncHierarchy(root,directory,options){
 const base=path.resolve(root),target=path.resolve(directory),relative=path.relative(base,target);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Invalid durability directory.');
 // Confirm directory entries through root's parent, including a newly created root.
 const stop=path.dirname(base);let status={synced:true,unsupported:false};for(let current=target;;current=path.dirname(current)){const result=await require('./fs-durability.cjs').syncDirectory(current,options);if(result.unsupported)status=result;if(current===stop||current===path.dirname(current))break;}return status;
}
async function writeSynced(file,bytes,created){const handle=await fs.open(file,'wx');try{created?.(await handle.stat());await handle.writeFile(bytes);await handle.sync();return await handle.stat();}finally{await handle.close();}}
async function assertTemp(file,identity,{stable=false}={}){const named=await fs.lstat(file);if(!named.isFile()||named.isSymbolicLink()||named.dev!==identity.dev||named.ino!==identity.ino||stable&&!sameStat(identity,named))throw Error('Version temporary ownership changed.');return named;}
async function unlinkTemp(file,identity,options){if(!identity)return;try{await assertTemp(file,identity,options);}catch(error){if(error.code==='ENOENT')return;throw error;}await fs.unlink(file);}
async function digestHandle(handle,maxBytes){const hash=createHash('sha256'),chunk=Buffer.allocUnsafeSlow(Math.min(256*1024,maxBytes||1));let read=0;try{while(read<maxBytes){const result=await handle.read(chunk,0,Math.min(chunk.length,maxBytes-read),read);if(!result.bytesRead)throw Error('A version asset is damaged.');hash.update(chunk.subarray(0,result.bytesRead));read+=result.bytesRead;}return hash.digest('hex');}finally{discard(chunk);}}

async function verifiedObject(root,ref,cache){
 const file=objectFile(root,ref.hash);let handle;try{
  try{handle=await fs.open(file,raw.constants.O_RDONLY|(raw.constants.O_NOFOLLOW||0));}catch(error){if(error.code==='ENOENT')throw Object.assign(Error('A version asset is missing.'),{code:'SNAPSHOT_OBJECT_MISSING',hash:ref.hash});throw error;}
  const stat=await handle.stat();if(!stat.isFile()||stat.size!==ref.bytes)throw Error('A version asset is damaged.');if(!sameStat(cache.get(ref.hash),stat)&&await digestHandle(handle,ref.bytes)!==ref.hash)throw Error('A version asset is damaged.');
  const named=await fs.lstat(file),current=await handle.stat();if(!named.isFile()||named.isSymbolicLink()||!sameStat(stat,current)||!sameStat(stat,named))throw Error('A version asset is damaged.');await require('./fs-durability.cjs').syncReadOnlyHandle(handle);remember(cache,ref.hash,stat);return file;
 }finally{await handle?.close();}
}
async function publishSourceObject(root,object,ref,cache){
 if(!object||object.hash!==ref.hash||object.bytes!==ref.bytes||typeof object.source!=='function')throw Error('Invalid prepared version asset.');
 const file=objectFile(root,ref.hash);try{await verifiedObject(root,ref,cache);await syncHierarchy(root,path.dirname(file));return;}catch(error){if(error.code!=='SNAPSHOT_OBJECT_MISSING')throw error;}
 const temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});let handle,identity;
 try{
  handle=await fs.open(temp,'wx');identity=await handle.stat();const digest=createHash('sha256');let total=0;
  for await(const bytes of await object.source()){
   if(!(bytes instanceof Uint8Array)||total+bytes.length>ref.bytes)throw Error('Version source length changed.');let at=0;while(at<bytes.length){const result=await handle.write(bytes,at,Math.min(256*1024,bytes.length-at),total+at);if(!result.bytesWritten)throw Error('Version object write stopped.');at+=result.bytesWritten;}digest.update(bytes);total+=bytes.length;
  }
  if(total!==ref.bytes||digest.digest('hex')!==ref.hash)throw Error('Version source digest changed.');await handle.sync();const written=await handle.stat();await handle.close();handle=null;
  const named=await fs.lstat(temp);if(!named.isFile()||named.isSymbolicLink()||!sameStat(written,named)||written.dev!==identity.dev||written.ino!==identity.ino||written.size!==ref.bytes)throw Error('Version object identity changed.');
  try{await fs.link(temp,file);}catch(error){if(error.code!=='EEXIST')throw error;}await verifiedObject(root,ref,cache);
  await syncHierarchy(root,path.dirname(file));
 }finally{await handle?.close();await unlinkTemp(temp,identity);}
}
async function publishObject(root,object,ref,cache){
 if(typeof object?.source==='function')return publishSourceObject(root,object,ref,cache);
 // New objects were hashed and validated by prepareSnapshot in the trusted worker.
 // Existing files must match that digest; rescanning their graphics on main would repeat the worker's point traversal.
 if(!object||object.hash!==ref.hash||!(object.bytes instanceof Uint8Array)||object.bytes.byteLength!==ref.bytes)throw Error('Invalid prepared version asset.');
 const file=objectFile(root,ref.hash),temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});let identity,complete=false,linked=false;
 try{
  identity=await writeSynced(temp,object.bytes,created=>identity=created);complete=true;await assertTemp(temp,identity,{stable:true});
  try{await fs.link(temp,file);linked=true;remember(cache,ref.hash,await fs.lstat(file));}
  catch(error){if(error.code!=='EEXIST')throw error;await verifiedObject(root,ref,cache);}
  await syncHierarchy(root,path.dirname(file));
 }finally{await unlinkTemp(temp,identity,{stable:complete&&!linked});}
}
async function publishSnapshotObjects(root,prepared,cache=new Map()){
 const manifest=validateManifest(prepared?.manifest),objects=new Map();
 for(const object of prepared.objects||[]){if(!validHash(object?.hash)||objects.has(object.hash))throw Error('Invalid prepared version objects.');objects.set(object.hash,object);}
 const refs=new Map(Object.values(manifest.assets).map(ref=>[ref.hash,ref]));
 for(const hash of objects.keys())if(!refs.has(hash))throw Error('Unreferenced prepared version asset.');
 const publish=async ref=>{if(objects.has(ref.hash))await publishObject(root,objects.get(ref.hash),ref,cache);else{await verifiedObject(root,ref,cache);await syncHierarchy(root,path.dirname(objectFile(root,ref.hash)));}};if([...objects.values()].some(object=>typeof object.source==='function'))for(const ref of refs.values())await publish(ref);else await mapLimit([...refs.values()],8,publish);
}
async function publishSnapshot(root,id,prepared,cache=new Map(),{beforePublish}={}){
 const file=manifestFile(root,id),manifestBytes=prepared?.manifestBytes;
 if(!(manifestBytes instanceof Uint8Array)||!manifestBytes.byteLength||manifestBytes.byteLength>MANIFEST_LIMIT)throw Error('Invalid prepared version metadata.');
 await publishSnapshotObjects(root,prepared,cache);
 const temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});let identity,complete=false,linked=false;
 // Both document hashing and JSON serialization have already completed in the trusted worker.
 try{identity=await writeSynced(temp,manifestBytes,created=>identity=created);complete=true;await beforePublish?.();await assertTemp(temp,identity,{stable:true});await fs.link(temp,file);linked=true;await syncHierarchy(root,path.dirname(file));}finally{await unlinkTemp(temp,identity,{stable:complete&&!linked});}
}
async function readSnapshot(root,id,{referencesOnly=false,assetResolver,expectedHash}={}){
 const manifest=validateManifest(JSON.parse(await readLimited(manifestFile(root,id),MANIFEST_LIMIT,'Version metadata is too large.')),{verifyIntegrity:true});
 if(expectedHash&&expectedHash!=='snapshot2:'+manifest.checksum)throw Error('Version metadata is damaged.');
 if(referencesOnly){
  const knownHashes=[];await mapLimit([...new Map(Object.values(manifest.assets).map(ref=>[ref.hash,ref])).values()],8,async ref=>{try{const stat=await fs.lstat(objectFile(root,ref.hash));if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===ref.bytes)knownHashes.push(ref.hash);}catch(error){if(error.code!=='ENOENT')throw error;}});
  return {knownHashes};
 }
 const assets={},loaded=new Map();
 // Sequential hydration bounds transient binary memory to one asset, and identical references share a string.
 for(const [name,ref]of Object.entries(manifest.assets)){
  if(!loaded.has(ref.hash)){
   const file=objectFile(root,ref.hash),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==ref.bytes)throw Error('A version asset is damaged.');
   const bytes=await readLimited(file,ref.bytes,'A version asset is damaged.');if(bytes.length!==ref.bytes||sha(bytes)!==ref.hash)throw Error('A version asset is damaged.');validateEntry(name,bytes);loaded.set(ref.hash,assetResolver?.(bytes,{bytes:ref.bytes,sha256:ref.hash})??bytes.toString('base64'));
  }
  assets[name]=loaded.get(ref.hash);
 }
 const doc=manifest.document;return {text:doc.text,assets,id:doc.id,title:doc.title,meta:doc.meta||{},created:doc.created};
}
module.exports={syncHierarchy,withAssetContext,prepareReferences,publishObject,validAsset,prepareSnapshot,prepareSnapshotSources,publishSnapshot,publishSnapshotObjects,readSnapshot,validateManifest,objectFile,manifestFile};
