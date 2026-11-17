// Bounded ZIP range reads shared by before-save history and recovery metadata.
// Assets are never converted to base64 or returned to Main by this module.
const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib'),{Readable}=require('node:stream'),{createHash}=require('node:crypto');
const {isMarkedAsUntransferable}=require('node:worker_threads');
const {finished}=require('node:stream/promises');
const discard=bytes=>{const backing=bytes?.buffer;if(backing instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===backing.byteLength&&!isMarkedAsUntransferable?.(backing)&&typeof backing.transfer==='function')try{backing.transfer(0)}catch{}};
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
 constructor(file,handle,stat,{maxContents=MAX_CONTENTS,check=()=>{}}={}){this.maxContents=maxContents;this.check=check;this.file=file;this.handle=handle;this.sourceIdentity=identity(stat);this.size=Number(stat.size);this.entries=[];this.files=new Map();this.closed=false;}
 static async open(file,{maxBytes=MAX_SOURCE,maxContents=MAX_CONTENTS,check=()=>{}}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||!Number.isSafeInteger(maxBytes)||maxBytes<22||maxBytes>MAX_SOURCE||!Number.isSafeInteger(maxContents)||maxContents<0||maxContents>MAX_CONTENTS||typeof check!=='function')throw Error('Invalid archive source path.');check();let handle;
  try{handle=await fs.open(file,require('node:fs').constants.O_RDONLY|(require('node:fs').constants.O_NOFOLLOW||0));const stat=await handle.stat({bigint:true});if(!stat.isFile()||stat.size<22n||stat.size>BigInt(maxBytes))throw Error('Invalid or oversized archive source.');const source=new ArchiveSource(file,handle,stat,{maxContents,check});await source.stable();await source.directory();return source;}catch(error){await handle?.close();throw error;}
 }
 async range(start,length){this.check();if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<0||start+length>this.size)throw Error('Invalid archive range.');const bytes=Buffer.allocUnsafeSlow(length);let complete=false;try{for(let at=0;at<length;){this.check();const read=await this.handle.read(bytes,at,Math.min(CHUNK,length-at),start+at);this.check();if(!read.bytesRead)throw changed();at+=read.bytesRead;}complete=true;return bytes;}finally{if(!complete)discard(bytes)}}
 async stable(){this.check();try{const stat=await this.handle.stat({bigint:true}),named=await fs.lstat(this.file,{bigint:true});this.check();if(!stat.isFile()||!named.isFile()||named.isSymbolicLink()||!same(identity(stat),this.sourceIdentity)||!same(identity(named),this.sourceIdentity))throw changed();return this.sourceIdentity;}catch(error){if(['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))throw changed();throw error;}}
 async directory(){
  const tailStart=Math.max(0,this.size-65557),tail=await this.range(tailStart,this.size-tailStart);let count,directoryBytes,start,absoluteEnd;
  try{let end=-1;for(let at=tail.length-22;at>=0;at--)if(tail.readUInt32LE(at)===0x06054b50&&at+22+tail.readUInt16LE(at+20)===tail.length){end=at;break;}if(end<0)throw Error('Invalid archive directory.');count=tail.readUInt16LE(end+10);directoryBytes=tail.readUInt32LE(end+12);start=tail.readUInt32LE(end+16);absoluteEnd=tailStart+end;if(tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6)||tail.readUInt16LE(end+8)!==count||count>10000||start+directoryBytes>absoluteEnd)throw Error('Invalid archive directory.');}finally{discard(tail)}
  this.directoryStart=start;let position=start,total=0,nameBytes=0;
  for(let at=0;at<count;at++){
   if(position+46>start+directoryBytes)throw Error('Invalid archive directory.');const header=await this.range(position,46);let flags,method,size,original,nl,el,cl,offset,crc;
   try{if(header.readUInt32LE(0)!==0x02014b50)throw Error('Invalid archive directory.');flags=header.readUInt16LE(8);method=header.readUInt16LE(10);size=header.readUInt32LE(20);original=header.readUInt32LE(24);nl=header.readUInt16LE(28);el=header.readUInt16LE(30);cl=header.readUInt16LE(32);offset=header.readUInt32LE(42);crc=header.readUInt32LE(16);if(!nl||position+46+nl+el+cl>start+directoryBytes||flags&1||![0,8].includes(method)||header.readUInt16LE(34)||offset+30>start)throw Error('Invalid or unsupported archive entry.');}finally{discard(header)}
   nameBytes+=nl;if(nameBytes>ENTRY_BYTES)throw Error('Archive file names are too large.');const nameBuffer=await this.range(position+46,nl);let name;try{name=nameBuffer.toString('utf8');}finally{discard(nameBuffer)}const limit=maximumEntryBytes(name);if(original>limit||size>limit||(total+=original)>this.maxContents)throw Error('Archive contents are too large.');const entry={name,flags,method,size,original,crc,offset};this.entries.push(entry);if(safeName(name)){if(this.files.has(name))throw Error('Duplicate archive entry.');this.files.set(name,entry);}position+=46+nl+el+cl;
  }
  if(position!==start+directoryBytes){const signature=await this.range(position,6);try{if(signature.readUInt32LE(0)!==0x05054b50||position+6+signature.readUInt16LE(4)!==start+directoryBytes)throw Error('Invalid archive directory length.');}finally{discard(signature)}}
  const ranges=this.entries.slice().sort((a,b)=>a.offset-b.offset);for(let at=0;at<ranges.length;at++){const entry=ranges[at];entry.nextOffset=ranges[at+1]?.offset??start;if(entry.offset+30>entry.nextOffset)throw Error('Overlapping archive entries.');}
 }
 async *compressed(start,size){for(let at=0;at<size;){const amount=Math.min(65536,size-at),bytes=await this.range(start+at,amount);at+=amount;yield bytes;}}
 async read(entry,{maxBytes=maximumEntryBytes(entry.name)}={}){
  this.check();if(entry.original>maxBytes)throw Error('Archive metadata is too large.');const local=await this.range(entry.offset,30);let start;
  try{if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(8)!==entry.method||(local.readUInt16LE(6)&1))throw Error('Invalid archive entry.');const nl=local.readUInt16LE(26),el=local.readUInt16LE(28);start=entry.offset+30+nl+el;if(start+entry.size>entry.nextOffset)throw Error('Invalid archive entry range.');const name=await this.range(entry.offset+30,nl);try{if(name.toString('utf8')!==entry.name)throw Error('Invalid archive entry range.');}finally{discard(name)}if(!(entry.flags&8)&&(local.readUInt32LE(14)!==entry.crc||local.readUInt32LE(18)!==entry.size||local.readUInt32LE(22)!==entry.original))throw Error('Archive entry disagrees with its directory.');}finally{discard(local)}
  let bytes=Buffer.allocUnsafeSlow(entry.original),complete=false;const hash=createHash('sha256');let at=0,crc=0;
  const take=chunk=>{this.check();if(at+chunk.length>entry.original)throw Error('Corrupt archive entry.');chunk.copy(bytes,at);at+=chunk.length;crc=crc32(chunk,crc);hash.update(chunk);};
  try{if(entry.method===0){if(entry.size!==entry.original)throw Error('Corrupt archive entry.');while(at<entry.original){this.check();const read=await this.handle.read(bytes,at,Math.min(CHUNK,entry.original-at),start+at);this.check();if(!read.bytesRead)throw changed();const chunk=bytes.subarray(at,at+read.bytesRead);crc=crc32(chunk,crc);hash.update(chunk);at+=read.bytesRead;}}
   // Full output chunks are immutable after emission; partial backing waits for decoder close.
   // Only this private decoder owns those buffers; pooled backing is never transferable.
   else{const decoder=zlib.createInflateRaw({chunkSize:65536}),decoderDone=finished(decoder,{cleanup:true}).catch(()=>{}),partialOutputs=new Set();const writing=(async()=>{try{for(let offset=0;offset<entry.size;){const length=Math.min(65536,entry.size-offset),chunk=await this.range(start+offset,length);try{await new Promise((resolve,reject)=>{const cleanup=()=>{decoder.off('error',failed);decoder.off('close',closed)},failed=error=>{cleanup();reject(error)},closed=()=>failed(Error('Archive decompression stopped.'));decoder.once('error',failed);decoder.once('close',closed);decoder.write(chunk,error=>{cleanup();if(error)reject(error);else resolve()});});}finally{discard(chunk)}offset+=length;}decoder.end();}catch(error){decoder.destroy(error);throw error;}})();writing.catch(()=>{});try{for await(const chunk of decoder){try{take(chunk);}finally{if(chunk.byteOffset===0&&chunk.byteLength===chunk.buffer.byteLength)discard(chunk);else partialOutputs.add(chunk.buffer);}}await writing;}finally{decoder.destroy();await writing.catch(()=>{});await decoderDone;for(const backing of partialOutputs)if(backing.byteLength)discard(new Uint8Array(backing));}}
   this.check();if(at!==entry.original||crc!==entry.crc)throw Error('Corrupt archive entry.');bytes=await require('./archive-entry-validation.cjs').validateOwnedEntry(entry.name,bytes);this.check();complete=true;return{bytes,sha256:hash.digest('hex')};
  }finally{if(!complete)discard(bytes)}
 }
 async manifest({maxBytes=ENTRY_BYTES}={}){
  const entry=this.files.get('manifest.json');if(!entry){if(!this.files.has('document.md'))throw Error('The Notepad text is missing.');return null;}const {bytes,sha256}=await this.read(entry,{maxBytes});let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{throw Error('The Notepad manifest is invalid.');}finally{discard(bytes)}if(manifest?.format!=='notemind'||manifest.version!==1||!['notepad','drawing','workspace'].includes(manifest.kind)||manifest.content!=='document.md'||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw Error('The Notepad manifest is invalid.');
  for(const [name,info]of Object.entries(manifest.files)){const file=this.files.get(name);if(!file||!info||info.bytes!==file.original||!HASH.test(info.sha256))throw Error('The Notepad attachment index is damaged.');}for(const name of this.files.keys())if(name!=='manifest.json'&&!Object.hasOwn(manifest.files,name))throw Error('The Notepad contains an unlisted attachment.');if(manifest.files['manifest.json']&&(manifest.files['manifest.json'].sha256!==sha256||manifest.files['manifest.json'].bytes!==entry.original))throw Error('The Notepad manifest is damaged.');return manifest;
 }
 verifyEntry(entry,result,manifest){const info=manifest?.files[entry.name];if(manifest&&entry.name!=='manifest.json'&&(!info||info.sha256!==result.sha256||info.bytes!==result.bytes.length))throw Error('The Notepad attachment is damaged: '+entry.name);}
 async revision(expected){if(expected!==undefined&&(!expected||!HASH.test(expected.sha256)||!Number.isSafeInteger(expected.bytes)||expected.bytes!==this.size))throw changed();await this.stable();const hash=createHash('sha256'),scratch=Buffer.allocUnsafeSlow(Math.min(CHUNK,this.size));try{for(let at=0;at<this.size;){this.check();const read=await this.handle.read(scratch,0,Math.min(scratch.length,this.size-at),at);this.check();if(!read.bytesRead)throw changed();hash.update(scratch.subarray(0,read.bytesRead));at+=read.bytesRead;}await this.stable();const sha256=hash.digest('hex');if(expected&&sha256!==expected.sha256)throw changed();return{sha256,bytes:this.size};}finally{discard(scratch)}}
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
  const realRoot=await fs.realpath(directory);
  handle=await fs.open(resolved,require('node:fs').constants.O_RDONLY|(require('node:fs').constants.O_NOFOLLOW||0));
  const stat=await handle.stat({bigint:true}),captured=identity(stat);if(!stat.isFile()||stat.size>BigInt(maximumEntryBytes(name)))throw Error('Linked asset is too large or is not a regular file.');if(hooks.expectedIdentity&&!same(captured,hooks.expectedIdentity))throw changed();
  const stable=async()=>{const [current,named,currentRoot]=await Promise.all([handle.stat({bigint:true}),linkedAssetPath(resolved,{root:directory}),fs.realpath(directory)]);if(!current.isFile()||!named||currentRoot!==realRoot||!same(identity(current),captured)||!same(named.sourceIdentity,captured))throw changed();};
  await stable();const length=Number(stat.size);let bytes=hooks.allocate?hooks.allocate(length):Buffer.allocUnsafeSlow(length);if(!Buffer.isBuffer(bytes)||bytes.length!==length)throw Error('Invalid linked asset destination.');
  for(let at=0;at<length;){const read=await handle.read(bytes,at,Math.min(CHUNK,length-at),at);if(!read.bytesRead)throw changed();hooks.onChunk?.(bytes.subarray(at,at+read.bytesRead));at+=read.bytesRead;}
  bytes=await require('./archive-entry-validation.cjs').validateOwnedEntry(name,bytes);await hooks.beforeIssue?.();await stable();return {bytes,sourceIdentity:captured};
 }catch(error){if(handle&&['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code)||hooks.expectedIdentity&&['ENOENT','ENOTDIR'].includes(error.code))throw changed();throw error;}finally{await handle?.close();}
}
async function linkedAssetPath(file,{root}){
 const directory=path.resolve(root),resolved=path.resolve(file),relative=path.relative(directory,resolved);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return null;
 const realRoot=await fs.realpath(directory),parts=relative.split(path.sep);let stat;for(let at=0;at<parts.length;at++){stat=await fs.lstat(path.join(directory,...parts.slice(0,at+1)),{bigint:true});if(stat.isSymbolicLink()||at<parts.length-1&&!stat.isDirectory())return null;}
 const realFile=await fs.realpath(resolved),inside=path.relative(realRoot,realFile);if(!stat.isFile()||inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside))return null;return {file:resolved,sourceIdentity:identity(stat),bytes:Number(stat.size)};
}
async function assertLinkedAssetIdentity(file,{root},captured){try{const value=await linkedAssetPath(file,{root});if(!value||!same(value.sourceIdentity,captured))throw changed();}catch(error){if(['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))throw changed();throw error;}}
module.exports={ArchiveSource,publishVersionFromFile,readRecoveryState,readLinkedAsset,linkedAssetPath,assertLinkedAssetIdentity,identity,crc32};
