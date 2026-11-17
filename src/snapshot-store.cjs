// Internal version storage. Public .nm files and recovery .wm archives remain self-contained.
const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {TextEncoder}=require('node:util');
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
  if(!validAsset(name)||typeof value!=='string')throw Error('Invalid version asset.');
  const bytes=Buffer.from(value,'base64');validateEntry(name,bytes);if((total+=bytes.length)>TOTAL_LIMIT)throw Error('Version snapshot is too large.');
  const hash=sha(bytes);assets[name]={hash,bytes:bytes.length};if(!known.has(hash)&&!objects.has(hash))objects.set(hash,{hash,bytes:copyObjectBytes?Uint8Array.from(bytes):bytes});
 }
 const manifest={format:'notemind-snapshot',version:1,document,assets,textBytes};manifest.checksum=manifestChecksum(manifest);
 // Fingerprint every persisted field, including explicit title/identity/created date.
 const contentHash='snapshot2:'+manifest.checksum;
 const legacyHash=validHash(previousHash)?sha(JSON.stringify({text:doc.text,assets:doc.assets,meta:doc.meta})):null;
 const unchanged=previousHash===contentHash||(legacyHash!==null&&previousHash===legacyHash);
 const manifestBytes=unchanged?null:encoder.encode(JSON.stringify(manifest));if(manifestBytes?.byteLength>MANIFEST_LIMIT)throw Error('Version metadata is too large.');
 return {manifest,manifestBytes,contentHash,legacyHash,unchanged,objects:unchanged?[]:[...objects.values()]};
}
function remember(cache,hash,stat){cache.delete(hash);cache.set(hash,{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});while(cache.size>CACHE_ENTRIES)cache.delete(cache.keys().next().value);}
const sameStat=(a,b)=>a&&b&&['dev','ino','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
async function mapLimit(values,limit,run){let next=0,failure;await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(!failure&&next<values.length){const value=values[next++];try{await run(value);}catch(error){failure ||= error;}}}));if(failure)throw failure;}
async function digestFile(file,maxBytes){const hash=createHash('sha256');let read=0;for await(const chunk of raw.createReadStream(file,{highWaterMark:64*1024})){read+=chunk.length;if(read>maxBytes)throw Error('A version asset is damaged.');hash.update(chunk);}if(read!==maxBytes)throw Error('A version asset is damaged.');return hash.digest('hex');}
async function verifiedObject(root,ref,cache){
 const file=objectFile(root,ref.hash);let stat;try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')throw Object.assign(Error('A version asset is missing.'),{code:'SNAPSHOT_OBJECT_MISSING',hash:ref.hash});throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==ref.bytes)throw Error('A version asset is damaged.');
 if(!sameStat(cache.get(ref.hash),stat)&&await digestFile(file,ref.bytes)!==ref.hash)throw Error('A version asset is damaged.');
 remember(cache,ref.hash,stat);return file;
}
async function publishObject(root,object,ref,cache){
 // New objects were hashed and validated by prepareSnapshot in the trusted worker.
 // Existing files must match that digest; rescanning their graphics on main would repeat the worker's point traversal.
 if(!object||object.hash!==ref.hash||!(object.bytes instanceof Uint8Array)||object.bytes.byteLength!==ref.bytes)throw Error('Invalid prepared version asset.');
 const file=objectFile(root,ref.hash),temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});
 try{
  await fs.writeFile(temp,object.bytes,{flag:'wx'});
  try{await fs.link(temp,file);remember(cache,ref.hash,await fs.lstat(file));}
  catch(error){if(error.code!=='EEXIST')throw error;await verifiedObject(root,ref,cache);}
 }finally{await fs.unlink(temp).catch(()=>{});}
}
async function publishSnapshotObjects(root,prepared,cache=new Map()){
 const manifest=validateManifest(prepared?.manifest),objects=new Map();
 for(const object of prepared.objects||[]){if(!validHash(object?.hash)||objects.has(object.hash))throw Error('Invalid prepared version objects.');objects.set(object.hash,object);}
 const refs=new Map(Object.values(manifest.assets).map(ref=>[ref.hash,ref]));
 for(const hash of objects.keys())if(!refs.has(hash))throw Error('Unreferenced prepared version asset.');
 await mapLimit([...refs.values()],8,async ref=>objects.has(ref.hash)?publishObject(root,objects.get(ref.hash),ref,cache):verifiedObject(root,ref,cache));
}
async function publishSnapshot(root,id,prepared,cache=new Map()){
 const file=manifestFile(root,id),manifestBytes=prepared?.manifestBytes;
 if(!(manifestBytes instanceof Uint8Array)||!manifestBytes.byteLength||manifestBytes.byteLength>MANIFEST_LIMIT)throw Error('Invalid prepared version metadata.');
 await publishSnapshotObjects(root,prepared,cache);
 const temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});
 // Both document hashing and JSON serialization have already completed in the trusted worker.
 try{await fs.writeFile(temp,manifestBytes,{flag:'wx'});await fs.link(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}
}
async function readSnapshot(root,id,{referencesOnly=false,assetResolver}={}){
 const manifest=validateManifest(JSON.parse(await readLimited(manifestFile(root,id),MANIFEST_LIMIT,'Version metadata is too large.')),{verifyIntegrity:true});
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
module.exports={prepareSnapshot,publishSnapshot,publishSnapshotObjects,readSnapshot,validateManifest,objectFile,manifestFile};
