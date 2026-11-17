// Bounded ZIP range reads shared by before-save history and recovery metadata.
// Assets are never converted to base64 or returned to Main by this module.
const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib'),{Readable}=require('node:stream'),{createHash}=require('node:crypto');
const snapshots=require('./snapshot-store.cjs'),{maximumEntryBytes,validateEntry,ENTRY_BYTES}=require('./archive-limits.cjs');
const MAX_SOURCE=384*1024*1024,MAX_CONTENTS=200*1024*1024,PROBE_BYTES=4*1024*1024,CHUNK=256*1024;
const HASH=/^[a-f0-9]{64}$/;
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^(0xedb88320&-(value&1));return value>>>0;});
function crc32(bytes,previous=0){if(typeof zlib.crc32==='function')return zlib.crc32(bytes,previous);let value=previous^0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino),size:String(stat.size),mtimeNs:String(stat.mtimeNs??stat.mtimeMs*1000000n),ctimeNs:String(stat.ctimeNs??stat.ctimeMs*1000000n)});
const same=(a,b)=>a&&b&&['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const changed=()=>Object.assign(Error('The archive changed while its history was being read.'),{code:'ARCHIVE_SOURCE_CHANGED'});
const safeName=name=>!name.startsWith('/')&&!name.split('/').includes('..');
class ArchiveSource{
 constructor(file,handle,stat){this.file=file;this.handle=handle;this.sourceIdentity=identity(stat);this.size=Number(stat.size);this.entries=[];this.files=new Map();this.closed=false;}
 static async open(file){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Invalid archive source path.');let handle;
  try{handle=await fs.open(file,require('node:fs').constants.O_RDONLY|(require('node:fs').constants.O_NOFOLLOW||0));const stat=await handle.stat({bigint:true});if(!stat.isFile()||stat.size<22n||stat.size>BigInt(MAX_SOURCE))throw Error('Invalid or oversized archive source.');const source=new ArchiveSource(file,handle,stat);await source.stable();await source.directory();return source;}catch(error){await handle?.close();throw error;}
 }
 async range(start,length){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<0||start+length>this.size)throw Error('Invalid archive range.');const bytes=Buffer.allocUnsafeSlow(length);for(let at=0;at<length;){const read=await this.handle.read(bytes,at,Math.min(CHUNK,length-at),start+at);if(!read.bytesRead)throw changed();at+=read.bytesRead;}return bytes;}
 async stable(){const stat=await this.handle.stat({bigint:true}),named=await fs.lstat(this.file,{bigint:true});if(!stat.isFile()||!named.isFile()||named.isSymbolicLink()||!same(identity(stat),this.sourceIdentity)||!same(identity(named),this.sourceIdentity))throw changed();return this.sourceIdentity;}
 async directory(){
  const tailStart=Math.max(0,this.size-65557),tail=await this.range(tailStart,this.size-tailStart);let end=-1;for(let at=tail.length-22;at>=0;at--)if(tail.readUInt32LE(at)===0x06054b50&&at+22+tail.readUInt16LE(at+20)===tail.length){end=at;break;}if(end<0)throw Error('Invalid archive directory.');
  const count=tail.readUInt16LE(end+10),directoryBytes=tail.readUInt32LE(end+12),start=tail.readUInt32LE(end+16),absoluteEnd=tailStart+end;
  if(tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6)||tail.readUInt16LE(end+8)!==count||count>10000||start+directoryBytes>absoluteEnd)throw Error('Invalid archive directory.');this.directoryStart=start;let position=start,total=0,nameBytes=0;
  for(let at=0;at<count;at++){
   if(position+46>start+directoryBytes)throw Error('Invalid archive directory.');const header=await this.range(position,46);if(header.readUInt32LE(0)!==0x02014b50)throw Error('Invalid archive directory.');const flags=header.readUInt16LE(8),method=header.readUInt16LE(10),size=header.readUInt32LE(20),original=header.readUInt32LE(24),nl=header.readUInt16LE(28),el=header.readUInt16LE(30),cl=header.readUInt16LE(32),offset=header.readUInt32LE(42);
   if(!nl||position+46+nl+el+cl>start+directoryBytes||flags&1||![0,8].includes(method)||header.readUInt16LE(34)||offset+30>start)throw Error('Invalid or unsupported archive entry.');nameBytes+=nl;if(nameBytes>ENTRY_BYTES)throw Error('Archive file names are too large.');const name=(await this.range(position+46,nl)).toString('utf8'),limit=maximumEntryBytes(name);if(original>limit||size>limit||(total+=original)>MAX_CONTENTS)throw Error('Archive contents are too large.');const entry={name,flags,method,size,original,crc:header.readUInt32LE(16),offset};this.entries.push(entry);if(safeName(name)){if(this.files.has(name))throw Error('Duplicate archive entry.');this.files.set(name,entry);}position+=46+nl+el+cl;
  }
  if(position!==start+directoryBytes){const signature=await this.range(position,6);if(signature.readUInt32LE(0)!==0x05054b50||position+6+signature.readUInt16LE(4)!==start+directoryBytes)throw Error('Invalid archive directory length.');}
  const ranges=this.entries.slice().sort((a,b)=>a.offset-b.offset);for(let at=0;at<ranges.length;at++){const entry=ranges[at];entry.nextOffset=ranges[at+1]?.offset??start;if(entry.offset+30>entry.nextOffset)throw Error('Overlapping archive entries.');}
 }
 async *compressed(start,size){for(let at=0;at<size;){const amount=Math.min(65536,size-at),bytes=await this.range(start+at,amount);at+=amount;yield bytes;}}
 async read(entry,{maxBytes=maximumEntryBytes(entry.name)}={}){
  if(entry.original>maxBytes)throw Error('Archive metadata is too large.');const local=await this.range(entry.offset,30);if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(8)!==entry.method||(local.readUInt16LE(6)&1))throw Error('Invalid archive entry.');const nl=local.readUInt16LE(26),el=local.readUInt16LE(28),start=entry.offset+30+nl+el;if(start+entry.size>entry.nextOffset||(await this.range(entry.offset+30,nl)).toString('utf8')!==entry.name)throw Error('Invalid archive entry range.');if(!(entry.flags&8)&&(local.readUInt32LE(14)!==entry.crc||local.readUInt32LE(18)!==entry.size||local.readUInt32LE(22)!==entry.original))throw Error('Archive entry disagrees with its directory.');
  let bytes=Buffer.allocUnsafeSlow(entry.original);const hash=createHash('sha256');let at=0,crc=0;const take=chunk=>{if(at+chunk.length>entry.original)throw Error('Corrupt archive entry.');chunk.copy(bytes,at);at+=chunk.length;crc=crc32(chunk,crc);hash.update(chunk);};
  if(entry.method===0){if(entry.size!==entry.original)throw Error('Corrupt archive entry.');for await(const chunk of this.compressed(start,entry.size))take(chunk);}
  else{const input=Readable.from(this.compressed(start,entry.size),{objectMode:false,highWaterMark:65536}),decoder=zlib.createInflateRaw({chunkSize:65536});input.on('error',error=>decoder.destroy(error));input.pipe(decoder);try{for await(const chunk of decoder)take(chunk);}finally{input.destroy();decoder.destroy();}}
  if(at!==entry.original||crc!==entry.crc)throw Error('Corrupt archive entry.');bytes=await require('./archive-entry-validation.cjs').validateOwnedEntry(entry.name,bytes);return {bytes,sha256:hash.digest('hex')};
 }
 async manifest({maxBytes=ENTRY_BYTES}={}){
  const entry=this.files.get('manifest.json');if(!entry){if(!this.files.has('document.md'))throw Error('The Notepad text is missing.');return null;}const {bytes,sha256}=await this.read(entry,{maxBytes});let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{throw Error('The Notepad manifest is invalid.');}if(manifest?.format!=='notemind'||manifest.version!==1||!['notepad','drawing','workspace'].includes(manifest.kind)||manifest.content!=='document.md'||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw Error('The Notepad manifest is invalid.');
  for(const [name,info]of Object.entries(manifest.files)){const file=this.files.get(name);if(!file||!info||info.bytes!==file.original||!HASH.test(info.sha256))throw Error('The Notepad attachment index is damaged.');}for(const name of this.files.keys())if(name!=='manifest.json'&&!Object.hasOwn(manifest.files,name))throw Error('The Notepad contains an unlisted attachment.');if(manifest.files['manifest.json']&&(manifest.files['manifest.json'].sha256!==sha256||manifest.files['manifest.json'].bytes!==bytes.length))throw Error('The Notepad manifest is damaged.');return manifest;
 }
 verifyEntry(entry,result,manifest){const info=manifest?.files[entry.name];if(manifest&&entry.name!=='manifest.json'&&(!info||info.sha256!==result.sha256||info.bytes!==result.bytes.length))throw Error('The Notepad attachment is damaged: '+entry.name);}
 async revision(expected){if(!expected||!HASH.test(expected.sha256)||!Number.isSafeInteger(expected.bytes)||expected.bytes!==this.size)throw changed();const hash=createHash('sha256');for(let at=0;at<this.size;at+=CHUNK)hash.update(await this.range(at,Math.min(CHUNK,this.size-at)));await this.stable();const sha256=hash.digest('hex');if(sha256!==expected.sha256)throw changed();return {sha256,bytes:this.size};}
 async close(){if(this.closed)return;this.closed=true;await this.handle.close();}
}
const objectCache=new Map();
async function publishVersionFromFile(file,{root,id,noteId,titleFallback='',expectedRevision,previousHash=null,existingVersionId}={},hooks={}){
 if(typeof root!=='string'||!root||typeof id!=='string'||typeof noteId!=='string')throw Error('Invalid archive version publication.');const source=await ArchiveSource.open(file);
 try{
  if(!expectedRevision||expectedRevision.bytes!==source.size||!HASH.test(expectedRevision.sha256))throw changed();const manifest=await source.manifest(),refs={};let text;
  for(const entry of source.entries){if(entry.name==='manifest.json')continue;await hooks.beforeEntry?.(entry);const read=async()=>{const result=await source.read(entry);source.verifyEntry(entry,result,manifest);if(entry.name==='document.md')text=result.bytes.toString('utf8');if(safeName(entry.name)&&entry.name.startsWith('assets/')){if(!snapshots.validAsset(entry.name))throw Error('Invalid image path.');const ref={hash:result.sha256,bytes:result.bytes.length};await snapshots.publishObject(root,{hash:ref.hash,bytes:result.bytes},ref,objectCache);refs[entry.name]=ref;}await hooks.afterEntry?.(entry,result.bytes.length);};if(hooks.withEntry)await hooks.withEntry(entry,read);else await read();
  }
  if(text===undefined)throw Error('The Notepad text is missing.');const canonical=require('./markdown-files.cjs').canonical({text,assets:refs,id:noteId,title:manifest?.title||titleFallback||'',created:manifest?.created,meta:manifest?.meta||{}}),prepared=snapshots.prepareReferences(canonical,canonical.assets,{previousHash}),sourceRevision=await source.revision(expectedRevision);await hooks.beforeManifest?.();
  if(prepared.unchanged){if(existingVersionId)await snapshots.readSnapshot(root,existingVersionId,{referencesOnly:true,expectedHash:previousHash});await source.stable();}
  else await snapshots.publishSnapshot(root,id,prepared,objectCache,{beforePublish:()=>source.stable()});
  const {id:note,title,created}=prepared.manifest.document,hashes=[...new Set(Object.values(refs).map(value=>value.hash))];return {unchanged:prepared.unchanged,contentHash:prepared.contentHash,legacyHash:null,documentMetadata:{id:note,title,created},objectHashes:prepared.unchanged?[]:hashes,objectCount:hashes.length,sourceRevision};
 }finally{await source.close();}
}
async function readRecoveryState(file){
 const source=await ArchiveSource.open(file);try{const manifest=await source.manifest({maxBytes:PROBE_BYTES}),entry=source.files.get('recovery.json');let state=null;if(entry){const result=await source.read(entry,{maxBytes:PROBE_BYTES});source.verifyEntry(entry,result,manifest);try{state=JSON.parse(result.bytes.toString('utf8'));}catch{throw Error('Invalid recovery metadata.');}if(!state||typeof state!=='object'||Array.isArray(state))throw Error('Invalid recovery metadata.');}await source.stable();return {state,sourceIdentity:source.sourceIdentity};}finally{await source.close();}
}
async function readLinkedAsset(file,{name,root}={},hooks={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof root!=='string'||!path.isAbsolute(root)||!snapshots.validAsset(name))throw Error('Invalid linked asset source.');
 const directory=path.resolve(root),resolved=path.resolve(file),relative=path.relative(directory,resolved);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Linked asset is outside its Notepad directory.');
 let handle;
 try{
  const realRoot=await fs.realpath(directory),expectedFile=path.join(realRoot,relative);
  handle=await fs.open(resolved,require('node:fs').constants.O_RDONLY|(require('node:fs').constants.O_NOFOLLOW||0));
  const stat=await handle.stat({bigint:true}),captured=identity(stat);if(!stat.isFile()||stat.size>BigInt(maximumEntryBytes(name)))throw Error('Linked asset is too large or is not a regular file.');
  const stable=async()=>{const [current,named,realFile,currentRoot]=await Promise.all([handle.stat({bigint:true}),fs.lstat(resolved,{bigint:true}),fs.realpath(resolved),fs.realpath(directory)]);if(!current.isFile()||!named.isFile()||named.isSymbolicLink()||realFile!==expectedFile||currentRoot!==realRoot||!same(identity(current),captured)||!same(identity(named),captured))throw changed();};
  await stable();const length=Number(stat.size),bytes=hooks.allocate?hooks.allocate(length):Buffer.allocUnsafeSlow(length);if(!Buffer.isBuffer(bytes)||bytes.length!==length)throw Error('Invalid linked asset destination.');
  for(let at=0;at<length;){const read=await handle.read(bytes,at,Math.min(CHUNK,length-at),at);if(!read.bytesRead)throw changed();hooks.onChunk?.(bytes.subarray(at,at+read.bytesRead));at+=read.bytesRead;}
  validateEntry(name,bytes);await hooks.beforeIssue?.();await stable();return {bytes,sourceIdentity:captured};
 }finally{await handle?.close();}
}
module.exports={ArchiveSource,publishVersionFromFile,readRecoveryState,readLinkedAsset,crc32};
