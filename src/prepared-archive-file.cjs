// Main owns the private preparation folder and the public rename receipt.
const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const guard=require('./guarded-write.cjs');
const stamp=stat=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])])),same=(a,b,keys=['dev','ino','size','mtimeNs','ctimeNs'])=>keys.every(key=>a[key]===b[key]);
const validRevision=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>=22&&value.bytes<=200*1024*1024&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256);
const discard=bytes=>{if(bytes?.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0);};
async function prepareArchiveFile(file,doc,options={}, {codec=require('./archive-codec.cjs')}={}){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Invalid archive target.');const temps=require('./archive-preparation-temps.cjs');await temps.cleanupStaleArchivePreparations(path.dirname(file)).catch(()=>{});const owner=await temps.createArchivePreparation(file),directory=owner.directory,prepared=path.join(directory,'archive.nm'),cleanup=()=>owner.cleanup();
 try{const receipt=await codec.encodeFile(doc,{file:prepared,expected:null,tempId:owner.authority.id,preparation:owner.authority},options);await owner.assert();if(!receipt?.committed||receipt.file!==prepared||!validRevision(receipt.revision)||receipt.bytes!==receipt.revision.bytes)throw Error('Invalid prepared archive receipt.');const revision={...receipt.revision};await owner.assertOutput(prepared,revision);const assertDirectory=()=>owner.assertOutput(prepared,revision),stat=await fs.lstat(prepared,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==BigInt(receipt.bytes))throw Error('Archive preparation identity changed.');return{file:prepared,revision,identity:stamp(stat),directory,syncRoot:owner.syncRoot,assertDirectory,cleanup,warnings:[...(receipt.warnings||[])]};}
 catch(error){try{await cleanup();}catch(failure){error.archiveCleanupError=failure.message;}throw error;}
}
async function publishPreparedArchive(file,prepared,expected,{check=()=>{},beforeRename,onCommit,sync=(root,directory)=>require('./snapshot-store.cjs').syncHierarchy(root,directory),lock=guard.withFileLock,fingerprint=guard.fingerprintFile}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof prepared?.file!=='string'||!path.isAbsolute(prepared.file)||prepared.file===file||!validRevision(prepared.revision)||typeof prepared.assertDirectory!=='function')throw Error('Invalid prepared archive.');
 let handle,scratch,committed=false,failure;const warnings=[...(prepared.warnings||[])],receipt={file,bytes:prepared.revision.bytes,revision:{...prepared.revision},committed:true,warnings};
 try{
  check();await prepared.assertDirectory();handle=await fs.open(prepared.file,raw.constants.O_RDONLY|(raw.constants.O_NOFOLLOW||0)|(raw.constants.O_NONBLOCK||0));const before=await handle.stat({bigint:true}),identity=stamp(before);
  if(!before.isFile()||before.size!==BigInt(prepared.revision.bytes)||prepared.identity&&!same(prepared.identity,identity))throw Error('Prepared archive identity changed.');
  const hash=createHash('sha256');scratch=Buffer.allocUnsafeSlow(256*1024);for(let at=0;at<receipt.bytes;){check();const {bytesRead}=await handle.read(scratch,0,Math.min(scratch.length,receipt.bytes-at),at);if(!bytesRead)throw Error('Prepared archive was truncated.');hash.update(scratch.subarray(0,bytesRead));at+=bytesRead;}
  if(hash.digest('hex')!==receipt.revision.sha256)throw Error('Prepared archive digest changed.');discard(scratch);scratch=null;
  const assert=async()=>{check();await prepared.assertDirectory();const [named,held]=await Promise.all([fs.lstat(prepared.file,{bigint:true}),handle.stat({bigint:true})]);if(!named.isFile()||named.isSymbolicLink()||!same(identity,stamp(named))||!same(identity,stamp(held)))throw Error('Prepared archive identity changed.');};
  await assert();await lock(file,async()=>{check();const current=await fingerprint(file);if(current===null?expected!==null:!expected||current.bytes!==expected.bytes||current.sha256!==expected.sha256)throw Error('The file changed while it was being saved. Your draft is safe. Reopen it or use Save As to keep both.');await beforeRename?.();await assert();check();await fs.rename(prepared.file,file);committed=true;try{onCommit?.(receipt);}catch(error){warnings.push('The Notepad was saved, but its completion observer failed: '+error.message);}await sync(prepared.syncRoot||path.dirname(file),path.dirname(file));});
  return receipt;
 }catch(error){failure=error;if(!committed)throw error;warnings.push('The Notepad was saved, but finalization could not be confirmed: '+error.message);return receipt;}
 finally{discard(scratch);try{await handle?.close();}catch(error){if(committed)warnings.push('The Notepad was saved, but its file handle could not be closed: '+error.message);else if(!failure)throw error;}}
}
module.exports={prepareArchiveFile,publishPreparedArchive};
