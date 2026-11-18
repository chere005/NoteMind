// Verified source files outlive document admission. Exact inode claims, rather
// than a private-looking path, authorize every later scratch-file deletion.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash,randomUUID}=require('node:crypto'),{isMarkedAsUntransferable}=require('node:worker_threads');
const {mime,imageDimensions}=require('./document-renderer.cjs'),{isRawAsset}=require('./archive-raw-assets.cjs'),{ENTRY_BYTES,TOTAL_BYTES}=require('./archive-limits.cjs');
const {createSpoolDirectory,RawSpoolJournal,cleanupDeadSpoolDirectories}=require('./archive-raw-owner.cjs');
const CHUNK=196608,task=()=>new Promise(setImmediate),abort=()=>Object.assign(Error('Image indexing cancelled.'),{name:'AbortError'}),check=signal=>{if(signal?.aborted)throw abort()};
const discard=bytes=>{const backing=bytes?.buffer;if(backing instanceof ArrayBuffer&&!bytes.byteOffset&&bytes.byteLength===backing.byteLength&&!isMarkedAsUntransferable?.(backing)&&typeof backing.transfer==='function')try{backing.transfer(0)}catch{}};
const same=(stat,identity)=>String(stat.dev)===identity.dev&&String(stat.ino)===identity.ino;
function imageInputs(doc){return [...Object.entries(doc.assets||{}).filter(([name])=>mime(name)&&!name.endsWith('.preview.png')),...Object.entries(doc.meta?.attachments||{}).filter(([,info])=>info?.text).map(([name,info])=>[name,info.text])];}
function sameInputs(a,b){return a.length===b.length&&a.every(([name,data],i)=>name===b[i][0]&&data===b[i][1]);}
async function write(handle,bytes,signal){for(let at=0;at<bytes.length;){check(signal);const result=await handle.write(bytes,at,bytes.length-at);if(!result.bytesWritten)throw Error('Image search source write stopped.');at+=result.bytesWritten;}}
async function prepareIndexSources(doc,{storage,cached={},signal,tempRoot=os.tmpdir(),reserve=()=>()=>{},yieldTask=task}={}){
 let owner,journal,released=false,total=0,cleaning;const rows=[],files=new Map(),claims=[];
 const assertDirectory=async()=>{if(!owner)return;const stat=await fs.lstat(owner.directory,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||!same(stat,owner.authority.directory)||await fs.realpath(owner.directory)!==owner.authority.directory.real)throw Error('Image search source ownership changed.');};
 const closeClaim=async claim=>{if(!claim.handle)return;try{await claim.handle.close();claim.handle=null;}catch(error){try{await claim.handle.stat();}catch(stopped){if(stopped.code==='EBADF'){claim.handle=null;return;}}throw error;}};
 const releaseClaim=claim=>{if(!claim.released){claim.released=true;claim.release();}};
 const drop=async claim=>{await closeClaim(claim);if(!claim.file||!claim.identity){releaseClaim(claim);return;}await assertDirectory();journal.check();let stat;try{stat=await fs.lstat(claim.file,{bigint:true});}catch(error){if(error.code==='ENOENT'){releaseClaim(claim);return;}throw error;}if(!stat.isFile()||stat.isSymbolicLink()||!same(stat,claim.identity)){releaseClaim(claim);return;}await fs.unlink(claim.file);releaseClaim(claim);};
 const clean=async()=>{if(released)return;for(const claim of claims)if(!claim.file||!claim.identity){await closeClaim(claim);releaseClaim(claim);}if(!owner){for(const claim of claims)releaseClaim(claim);released=true;return;}
  await assertDirectory();if(!journal){await owner.cleanup();released=true;return;}journal.check();for(const claim of claims)await drop(claim);
  // Unknown siblings or replaced files keep their owner receipt and directory.
  // All of this operation's exact files have nevertheless been retired, so its
  // spool-byte reservations may be released without charging foreign bytes.
  try{await owner.cleanup();}catch(error){await assertDirectory();journal.check();for(const claim of claims){if(!claim.file||!claim.identity)continue;let stat;try{stat=await fs.lstat(claim.file,{bigint:true});}catch(missing){if(missing.code==='ENOENT')continue;throw missing;}if(stat.isFile()&&!stat.isSymbolicLink()&&same(stat,claim.identity))throw error;}if(error.code!=='ARCHIVE_RAW_SPOOL_CHANGED')throw error;}
  released=true;
 };
 const cleanup=()=>{if(cleaning)return cleaning;cleaning=clean().catch(error=>{cleaning=null;throw error;});return cleaning;};
 const ensureOwner=async()=>{if(owner)return;await fs.mkdir(tempRoot,{recursive:true});check(signal);await cleanupDeadSpoolDirectories({root:tempRoot,limit:2,scanLimit:128});check(signal);owner=createSpoolDirectory({root:tempRoot});journal=new RawSpoolJournal(owner.directory,{authority:owner.authority});};
 try{check(signal);for(const [name,data]of Object.entries(doc.assets||{})){
  if(!mime(name)||name.endsWith('.preview.png'))continue;check(signal);const raw=isRawAsset(data),bytes=raw?data.bytes:typeof data==='string'?data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0):NaN;
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>ENTRY_BYTES||(total+=bytes)>TOTAL_BYTES)throw Error('Image search sources exceed the Notepad image limits.');
  let expected;if(raw){const info=await storage.rawAssetInfo(data);check(signal);expected=info.sha256;if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Image search source digest is unavailable.');if(cached[name]?.hash===expected){rows.push({name,hash:expected,text:cached[name].text||''});continue;}}
  const duplicate=expected&&files.get(expected+'\0'+mime(name));if(duplicate){rows.push({name,hash:expected,source:duplicate,type:mime(name)});continue;}
  const claim={release:reserve(bytes),released:false};claims.push(claim);await ensureOwner();await assertDirectory();journal.check();const file=path.join(owner.directory,randomUUID()+'.raw');let handle,header;
  try{handle=await fs.open(file,'wx+',0o600);claim.handle=handle;claim.file=file;const stat=await handle.stat({bigint:true});claim.identity={dev:String(stat.dev),ino:String(stat.ino)};journal.claim(file,stat);const hash=createHash('sha256');header=Buffer.allocUnsafeSlow(Math.min(bytes,65536));
   for(let at=0;at<bytes;at+=CHUNK){check(signal);const length=Math.min(CHUNK,bytes-at);let part,owned=false;
    try{if(raw){owned=typeof storage.readOwnedRawAsset==='function';part=await (owned?storage.readOwnedRawAsset(data,{offset:at,length}):storage.readRawAsset(data,{offset:at,length}));if(!ArrayBuffer.isView(part)||part.byteLength!==length)throw Error('Image search source changed.');part=Buffer.from(part.buffer,part.byteOffset,part.byteLength);}else{const encoded=data.slice(at/3*4,Math.min(data.length,(at+CHUNK)/3*4));if(data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||at+CHUNK<bytes&&encoded.includes('='))throw Error('Invalid image search source encoding.');part=Buffer.from(encoded,'base64');owned=true;if(part.length!==length||part.toString('base64')!==encoded)throw Error('Image search source changed.');}
     check(signal);if(at<header.length)part.copy(header,at,0,Math.min(part.length,header.length-at));hash.update(part);await write(handle,part,signal);
    }finally{if(owned)discard(part);}
    await yieldTask();
   }
   check(signal);const actual=hash.digest('hex');if(expected&&actual!==expected)throw Error('Image search source digest changed.');expected=actual;
   const dimensions=imageDimensions(header)||(header[0]===255&&header[1]===216?await require('./image-index-dimensions.cjs').jpegDimensions(handle,file,bytes,signal):mime(name)==='image/svg+xml'?await require('./image-index-dimensions.cjs').svgDimensions(handle,file,bytes,signal):null);claim.source=Object.freeze({file,root:owner.directory,bytes,sha256:expected,...(dimensions?{dimensions}:{}),workingBytes:imageWorkingBytes(bytes,dimensions),workingPlan:imageWorkingPlan(bytes,dimensions)});
  }finally{discard(header);await closeClaim(claim);}
  if(cached[name]?.hash===expected){await drop(claim);rows.push({name,hash:expected,text:cached[name].text||''});continue;}
  const existing=files.get(expected+'\0'+mime(name));if(existing){await drop(claim);rows.push({name,hash:expected,source:existing,type:mime(name)});continue;}
  files.set(expected+'\0'+mime(name),claim.source);rows.push({name,hash:expected,source:claim.source,type:mime(name)});
 }
 for(const [name,info]of Object.entries(doc.meta?.attachments||{}))if(info?.text){check(signal);const hash=createHash('sha256');for(let at=0;at<info.text.length;){let end=Math.min(info.text.length,at+65536);if(end<info.text.length&&/[\ud800-\udbff]/.test(info.text[end-1]))end--;hash.update(info.text.slice(at,end));at=end;await yieldTask();}rows.push({name,hash:hash.digest('hex'),text:info.text});}
 check(signal);return{rows,cleanup,get directory(){return owner?.directory}};
 }catch(error){try{await cleanup()}catch(cleanupError){error.indexCleanupError=cleanupError.message}throw error;}
}
function imageWorkingPlan(bytes,dimensions){const width=dimensions?.width,height=dimensions?.height,known=Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0,scale=known?Math.min(1,2400/Math.max(width,height)):1,output=known?Math.max(1,Math.round(width*scale))*Math.max(1,Math.round(height*scale)):2400*2400,decoded=known?Math.min(128*1024*1024,width*height*4):128*1024*1024,modelBytes=96*1024*1024;return{modelBytes,convertBytes:Math.ceil(32*1024*1024+bytes+decoded+output*12),ocrBytes:Math.ceil(output*12),maxOutputBytes:Math.ceil(output*4+65536)};}
function imageWorkingBytes(bytes,dimensions){const plan=imageWorkingPlan(bytes,dimensions);return Math.max(plan.convertBytes,plan.modelBytes+plan.ocrBytes+plan.maxOutputBytes);}
module.exports={imageWorkingPlan,imageWorkingBytes,prepareIndexSources,imageInputs,sameInputs,CHUNK,abort,check};
