// Published ranges are immutable. Each worker appends only to its own unique pack.
const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const zlib=require('node:zlib');
const TARGET_PACK_BYTES=4*1024*1024,MAX_EXTENT_BYTES=160*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),validPack=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
function validateRef(ref,maxBytes=MAX_EXTENT_BYTES){if(!ref||!validPack(ref.pack)||!validHash(ref.sha256)||!Number.isSafeInteger(ref.offset)||ref.offset<0||!Number.isSafeInteger(ref.bytes)||ref.bytes<=0||ref.bytes>MAX_EXTENT_BYTES||!Number.isSafeInteger(ref.offset+ref.bytes))throw Error('Invalid drawing storage reference.');const codec=ref.codec||'raw',rawBytes=ref.rawBytes??ref.bytes;if(!['raw','deflate','zstd'].includes(codec)||!Number.isSafeInteger(rawBytes)||rawBytes<=0||rawBytes>maxBytes||codec==='raw'&&rawBytes!==ref.bytes||codec!=='raw'&&ref.bytes>=rawBytes)throw Error('Invalid drawing storage codec.');return ref;}
function decodeExtent(bytes,ref){const codec=ref.codec||'raw',limit=ref.rawBytes??ref.bytes;let result;if(codec==='raw')result=bytes;else if(codec==='deflate')result=zlib.inflateRawSync(bytes,{maxOutputLength:limit});else if(codec==='zstd'){if(typeof zlib.zstdDecompressSync!=='function')throw Error('This drawing compression format is unavailable.');result=zlib.zstdDecompressSync(bytes,{maxOutputLength:limit,params:{[zlib.constants.ZSTD_d_windowLogMax]:22}});}else throw Error('Invalid drawing storage codec.');if(result.length!==limit||digest(result)!==ref.sha256)throw Error('Drawing storage is damaged.');return result;}
const sameStat=(a,b)=>a&&b&&['dev','ino','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
async function syncDirectory(directory){let handle;try{handle=await fs.open(directory,'r');await handle.sync();}catch(error){if(!['EINVAL','ENOTSUP','EISDIR','EPERM','EBADF'].includes(error.code))throw error;}finally{await handle?.close();}}
class SheetPackStore{
 constructor(directory,{targetBytes=TARGET_PACK_BYTES,maxExtentBytes=MAX_EXTENT_BYTES,maxHints=4096,encoder=bytes=>({codec:'raw',bytes}),staging}={}){Object.assign(this,{directory,targetBytes,maxExtentBytes,maxHints,encoder});this.staging=staging||new(require('./sheet-staging.cjs').SheetStaging)(directory);this.ownsStaging=!staging;this.active=null;this.created=new Set();this.known=new Map();this.statsByPack=new Map();this.dirtyPacks=new Map();this.directoryDirty=false;this.closed=false;this.closing=false;this.queue=Promise.resolve();this.writtenBytes=0;this.rawBytesWritten=0;this.readBytes=0;this.createdPacks=0;}
 file(pack){if(!validPack(pack))throw Error('Invalid drawing pack identity.');return path.join(this.directory,pack+'.pack');}
 remember(ref){this.known.delete(ref.sha256);this.known.set(ref.sha256,ref);while(this.known.size>this.maxHints)this.known.delete(this.known.keys().next().value);}
 rememberStat(pack,stat){this.statsByPack.delete(pack);this.statsByPack.set(pack,stat);while(this.statsByPack.size>this.maxHints)this.statsByPack.delete(this.statsByPack.keys().next().value);}
 async stat(pack){const stat=await fs.lstat(this.file(pack));if(!stat.isFile()||stat.isSymbolicLink())throw Error('Drawing storage is damaged.');return stat;}
 async verifyKnown(ref){const stat=await this.stat(ref.pack),known=this.statsByPack.get(ref.pack);if(!sameStat(known,stat)){await this.read(ref);return true;}return stat.size>=ref.offset+ref.bytes;}
 async newPack(){
  await this.closeActive();await fs.mkdir(this.directory,{recursive:true});const pack=randomUUID(),file=this.file(pack);await this.staging.register(pack);const handle=await fs.open(file,'wx+');
  const release=await require('./sheet-pack-lock.cjs').leasePack(file,handle);this.active={pack,handle,release,size:0,stat:await handle.stat()};this.created.add(pack);this.rememberStat(pack,this.active.stat);this.createdPacks++;this.directoryDirty=true;return this.active;
 }
 async closeActive(){const active=this.active;this.active=null;if(active){try{await active.release?.();}finally{await active.handle.close();}}}
 forgetPacks(packs){const removed=new Set(packs);for(const pack of removed){this.created.delete(pack);this.statsByPack.delete(pack);this.dirtyPacks.delete(pack);}for(const [hash,ref]of this.known)if(removed.has(ref.pack))this.known.delete(hash);}
 publish(value){if(this.closed||this.closing)return Promise.reject(Error('Drawing storage is closing.'));const next=this.queue.catch(()=>{}).then(()=>this.publishNow(value));this.queue=next;return next;}
 async publishNow(value){
  if(this.closed)throw Error('Drawing storage is closing.');const bytes=Buffer.isBuffer(value)?value:Buffer.from(value.buffer,value.byteOffset,value.byteLength);
  if(!bytes.length||bytes.length>this.maxExtentBytes)throw Error('Drawing storage block is too large.');const sha256=digest(bytes),known=this.known.get(sha256);
  if(known&&(known.rawBytes??known.bytes)===bytes.length&&await this.verifyKnown(known)){this.remember(known);return known;}
  // Only trusted worker-local policy chooses compression; raw stays the default until measured.
  let encoded=await this.encoder(bytes);if(!encoded||!['raw','deflate','zstd'].includes(encoded.codec)||!(encoded.bytes instanceof Uint8Array)||!encoded.bytes.length)throw Error('Invalid drawing block encoder.');if(encoded.codec==='raw'||encoded.bytes.length>=bytes.length)encoded={codec:'raw',bytes};const stored=encoded.bytes;
  let active=this.active;if(!active||active.size&&active.size+stored.length>this.targetBytes)active=await this.newPack();
  const before=await active.handle.stat();if(!sameStat(before,active.stat))throw Error('Drawing storage changed outside this window.');const offset=active.size;
  try{let written=0;while(written<stored.length){const result=await active.handle.write(stored,written,stored.length-written,offset+written);if(!result.bytesWritten)throw Error('Could not write drawing storage.');written+=result.bytesWritten;}active.size+=stored.length;active.stat=await active.handle.stat();this.rememberStat(active.pack,active.stat);this.dirtyPacks.set(active.pack,active.stat);this.writtenBytes+=stored.length;this.rawBytesWritten+=bytes.length;
   const ref={pack:active.pack,offset,bytes:stored.length,rawBytes:bytes.length,codec:encoded.codec,sha256};this.remember(ref);return ref;
  }catch(error){try{this.dirtyPacks.set(active.pack,await active.handle.stat());}catch{}await this.closeActive().catch(()=>{});throw error;}
 }
 async read(reference,maxBytes=this.maxExtentBytes){
  const ref=validateRef(reference,maxBytes),file=this.file(ref.pack),before=await this.stat(ref.pack);if(before.size<ref.offset+ref.bytes)throw Error('Drawing storage is truncated.');
  let handle;try{handle=await fs.open(file,raw.constants.O_RDONLY|(raw.constants.O_NOFOLLOW||0));const opened=await handle.stat();if(!sameStat(before,opened))throw Error('Drawing storage changed while opening.');const bytes=Buffer.allocUnsafe(ref.bytes);let read=0;
   while(read<bytes.length){const result=await handle.read(bytes,read,bytes.length-read,ref.offset+read);if(!result.bytesRead)throw Error('Drawing storage is truncated.');read+=result.bytesRead;}
   const after=await handle.stat();if(!sameStat(opened,after))throw Error('Drawing storage is damaged.');const decoded=decodeExtent(bytes,ref);this.readBytes+=bytes.length;this.rememberStat(ref.pack,after);this.remember(ref);return decoded;
  }finally{await handle?.close();}
 }
 async publishJSON(value,maxBytes=256*1024){const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>maxBytes)throw Error('Drawing index block is too large.');return this.publish(bytes);}
 async readJSON(ref,maxBytes=256*1024){return JSON.parse((await this.read(ref,maxBytes)).toString('utf8'));}
 sync(){if(this.closed||this.closing)return Promise.reject(Error('Drawing storage is closing.'));const next=this.queue.catch(()=>{}).then(async()=>{for(const [pack,expected]of this.dirtyPacks){let handle;try{handle=await fs.open(this.file(pack),raw.constants.O_RDWR|(raw.constants.O_NOFOLLOW||0));if(!sameStat(expected,await handle.stat()))throw Error('Drawing storage changed before its checkpoint.');await handle.sync();this.dirtyPacks.delete(pack);}finally{await handle?.close();}}if(this.directoryDirty){await syncDirectory(this.directory);this.directoryDirty=false;}});this.queue=next;return next;}
 stats(){return {writtenBytes:this.writtenBytes,rawBytesWritten:this.rawBytesWritten,readBytes:this.readBytes,createdPacks:this.createdPacks,hints:this.known.size};}
 async dispose(){this.closing=true;await this.queue.catch(()=>{});this.closed=true;await this.closeActive();if(this.ownsStaging)await this.staging.dispose();this.known.clear();this.statsByPack.clear();this.dirtyPacks.clear();}
}
module.exports={SheetPackStore,validateRef,decodeExtent,digest,syncDirectory,MAX_EXTENT_BYTES,TARGET_PACK_BYTES};
