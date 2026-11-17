// Immutable PDF export links have an inode journal, not recursive directory authority.
const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {leasePack}=require('./sheet-pack-lock.cjs'),{syncDirectory}=require('./fs-durability.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,INK=/^[1-9]\d{0,4}-[a-f0-9]{64}\.ink$/i,MAX_JOURNAL=8*1024*1024,NOFOLLOW=raw.constants.O_NOFOLLOW||0;
const stamp=s=>({dev:String(s.dev),ino:String(s.ino)}),same=(a,b)=>a&&b&&String(a.dev)===String(b.dev)&&String(a.ino)===String(b.ino),sha=value=>createHash('sha256').update(value).digest('hex'),line=value=>JSON.stringify({value,checksum:sha(JSON.stringify(value))})+'\n';
function processAlive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function validStamp(value){return value&&['dev','ino'].every(key=>typeof value[key]==='string'&&/^\d+$/.test(value[key]));}
async function named(file,expected,{directory=false}={}){const stat=await fs.lstat(file,{bigint:true});if(stat.isSymbolicLink()||!(directory?stat.isDirectory():stat.isFile())||!same(stat,expected))throw Error('PDF export lease identity changed.');return stat;}
async function unlinkOwned(file,expected){try{await named(file,expected);await fs.unlink(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function write(handle,bytes,position){let at=0;while(at<bytes.length){const result=await handle.write(bytes,at,bytes.length-at,position+at);if(!result.bytesWritten)throw Error('PDF lease journal write stopped.');at+=result.bytesWritten;}}
function parseRows(bytes){
 const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))return null;const newline=text.indexOf('\n');if(newline<0)return null;
 const decode=row=>{let packet;try{packet=JSON.parse(row);}catch{return null;}return packet&&packet.value&&typeof packet.value==='object'&&!Array.isArray(packet.value)&&line(packet.value)===row+'\n'?packet.value:null;};
 const header=decode(text.slice(0,newline));if(!header)return null;const tail=text.slice(newline+1);if(!tail)return[header];
 // The durable first row remains authoritative if a worker dies while appending
 // the optional release receipt. A partial tail never grants portable cleanup.
 if(!tail.endsWith('\n')||tail.slice(0,-1).includes('\n'))return[header];const end=decode(tail.slice(0,-1));return end?[header,end]:[header];
}
async function readJournal(handle,id){const stat=await handle.stat({bigint:true});if(!stat.isFile()||stat.size>BigInt(MAX_JOURNAL))return null;const bytes=Buffer.alloc(Number(stat.size));let at=0;while(at<bytes.length){const result=await handle.read(bytes,at,bytes.length-at,at);if(!result.bytesRead)return null;at+=result.bytesRead;}const rows=parseRows(bytes);if(!rows)return null;const [header,end]=rows;
 if(header.format!=='notemind-pdf-export-lease'||header.version!==2||header.id!==id||!UUID.test(header.owner)||!Number.isSafeInteger(header.pid)||header.pid<1||header.pid>0x7fffffff||typeof header.native!=='boolean'||!validStamp(header.parent)||!validStamp(header.directory)||!validStamp(header.journal)||!same(header.journal,stat)||!Array.isArray(header.files)||header.files.length>10000)return null;
 const seen=new Set();for(const entry of header.files){if(!entry||!INK.test(entry.name)||!validStamp(entry.stat)||seen.has(entry.name))return null;seen.add(entry.name);}if(end&&(end.released!==true||end.id!==id||end.owner!==header.owner))return null;return{header,released:!!end,stat};
}
class PDFExportLeases {
 constructor(root,{lease=leasePack,sync=syncDirectory,isProcessAlive=processAlive,owner=randomUUID()}={}){if(!UUID.test(owner))throw Error('Invalid PDF lease owner.');Object.assign(this,{root,lease,sync,isProcessAlive,owner});this.active=new Map();this.scan=null;this.cursor=null;this.cleaning=null;}
 folder(id){if(typeof id!=='string'||!UUID.test(id))throw Error('Invalid PDF export lease.');return path.join(this.root,id);}
 async assert(record){await named(this.root,record.header.parent,{directory:true});await named(record.directory,record.header.directory,{directory:true});await named(record.journal,record.header.journal);if(!same(await record.handle.stat({bigint:true}),record.header.journal))throw Error('PDF export journal handle changed.');}
 async capture(index,sourceFolder){
  const files=[],seen=new Set(),entries=Object.values(index.pages);if(entries.length>10000)throw Error('Too many PDF export pages.');for(const entry of entries){if(!INK.test(entry.file)||seen.has(entry.file))throw Error('Invalid PDF export ink name.');seen.add(entry.file);const stat=await fs.lstat(path.join(sourceFolder,entry.file),{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw Error('PDF ink page identity changed.');files.push({name:entry.file,stat:stamp(stat)});}
  await fs.mkdir(this.root,{recursive:true,mode:0o700});const parent=await fs.lstat(this.root,{bigint:true});if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('Invalid PDF export lease folder.');
  const id=randomUUID(),directory=this.folder(id),journal=path.join(directory,'owner.stage');await fs.mkdir(directory,{mode:0o700});const directoryStat=await fs.lstat(directory,{bigint:true});let handle,release,record,journalStat;
  try{
   handle=await fs.open(journal,'wx+',0o600);journalStat=await handle.stat({bigint:true});release=await this.lease(journal,handle);
   const header={format:'notemind-pdf-export-lease',version:2,id,owner:this.owner,pid:process.pid,native:!!release,parent:stamp(parent),directory:stamp(directoryStat),journal:stamp(journalStat),files},body=Buffer.from(line(header));if(body.length>MAX_JOURNAL-1024)throw Error('PDF export lease journal is too large.');
   record={id,header,directory,journal,handle,release,bodyBytes:body.length,files:new Map(files.map(entry=>[entry.name,entry.stat]))};await write(handle,body,0);await handle.sync();await this.sync(directory);await this.sync(this.root);this.active.set(id,record);
   for(const entry of files){await this.assert(record);await fs.link(path.join(sourceFolder,entry.name),path.join(directory,entry.name));await named(path.join(directory,entry.name),entry.stat);}
   await this.sync(directory);return{id,index};
  }catch(error){
   if(record&&this.active.has(id)){try{await this.release(id);}catch(cleanup){error.pdfLeaseCleanupError=cleanup.message;}}
   else{try{if(journalStat)await unlinkOwned(journal,journalStat);await named(directory,directoryStat,{directory:true});await fs.rmdir(directory);}catch(cleanup){if(cleanup.code!=='ENOENT')error.pdfLeaseCleanupError=cleanup.message;}finally{await release?.();await handle?.close().catch(()=>{});}}
   throw error;
  }
 }
 async read(id,name,maxBytes,{signal}={}){
  const record=this.active.get(id),expected=record?.files.get(name);if(!record||!expected||!INK.test(name))throw Error('PDF export lease expired.');await this.assert(record);const file=path.join(record.directory,name);let handle,data;
  try{
   signal?.throwIfAborted();handle=await fs.open(file,raw.constants.O_RDONLY|NOFOLLOW);const before=await handle.stat({bigint:true});if(!before.isFile()||!same(before,expected)||before.size>BigInt(maxBytes))throw Error('PDF export ink identity or size changed.');
   data=Buffer.allocUnsafeSlow(Number(before.size));let at=0;while(at<data.length){signal?.throwIfAborted();const result=await handle.read(data,at,Math.min(512*1024,data.length-at),at);if(!result.bytesRead)throw Error('PDF export ink was truncated.');at+=result.bytesRead;}
   const after=await handle.stat({bigint:true}),current=await named(file,expected);if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]||before[key]!==current[key]))throw Error('PDF export ink changed while reading.');await this.assert(record);signal?.throwIfAborted();return data;
  }catch(error){if(data?.buffer?.transfer)data.buffer.transfer(0);throw error;}finally{await handle?.close().catch(()=>{});}
 }
 async release(id){
  const record=this.active.get(id);if(!record)return this.cleanOne(id,{maxFiles:Infinity});
  this.active.delete(id);let failure;
  try{await this.assert(record);await write(record.handle,Buffer.from(line({released:true,id,owner:this.owner})),record.bodyBytes);await record.handle.sync();}
  catch(error){failure=error;}finally{try{await record.release?.();}catch(error){failure||=error;}try{await record.handle.close();}catch(error){failure||=error;}}
  if(failure)throw failure;return this.cleanOne(id,{settledOwner:this.owner,settledPID:process.pid,maxFiles:Infinity});
 }
 async cleanOne(id,{settledOwner,settledPID,maxFiles=256,offset=0}={}){
  const directory=this.folder(id),journal=path.join(directory,'owner.stage');let handle,release;
  try{
   handle=await fs.open(journal,raw.constants.O_RDONLY|NOFOLLOW);release=await this.lease(journal,handle);const packet=await readJournal(handle,id);if(!packet)return{invalid:true};const {header,released}=packet,record={header,directory,journal,handle};await this.assert(record);
   const settled=settledOwner===header.owner&&settledPID===header.pid;if(header.native&&!release||!header.native&&!released&&!settled&&this.isProcessAlive(header.pid))return{skipped:true};
   let at=offset,examined=0;for(;at<header.files.length&&examined<maxFiles;at++,examined++){const entry=header.files[at];await this.assert(record);await unlinkOwned(path.join(directory,entry.name),entry.stat);}
   if(at<header.files.length)return{pending:true,offset:at};
   await this.assert(record);const entries=await fs.readdir(directory);if(entries.some(name=>name!=='owner.stage'))return{foreign:true};await unlinkOwned(journal,header.journal);await named(directory,header.directory,{directory:true});await fs.rmdir(directory);await this.sync(this.root);return{removed:true};
  }catch(error){if(error.code==='ENOENT')return{missing:true};throw error;}finally{await release?.();await handle?.close().catch(()=>{});}
 }
 async cleanup({maxEntries=64,maxRemoved=4,maxFiles=256,settledOwner,settledPID}={}){
  if(this.cleaning)return this.cleaning;
  this.cleaning=this.runCleanup({maxEntries,maxRemoved,maxFiles,settledOwner,settledPID}).finally(()=>{this.cleaning=null;});return this.cleaning;
 }
 async runCleanup({maxEntries,maxRemoved,maxFiles,settledOwner,settledPID}){
  if(![maxEntries,maxRemoved,maxFiles].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Invalid PDF lease cleanup budget.');let removed=0,examined=0;
  while(examined<maxEntries&&removed<maxRemoved){
   let id=this.cursor?.id,offset=this.cursor?.offset||0;
   if(!id){if(!this.scan)try{this.scan=await fs.opendir(this.root);}catch(error){if(error.code==='ENOENT')return removed;throw error;}const entry=await this.scan.read();examined++;if(!entry){await this.scan.close();this.scan=null;break;}if(!entry.isDirectory()||!UUID.test(entry.name))continue;id=entry.name;}
   let result;try{result=await this.cleanOne(id,{maxFiles,offset,settledOwner,settledPID});}catch(error){this.cursor=null;if(['ENOENT','ELOOP','ENOTDIR'].includes(error.code)||/identity changed|handle changed/.test(error.message))continue;throw error;}
   if(result.pending){this.cursor={id,offset:result.offset};break;}this.cursor=null;if(result.removed)removed++;if(offset)examined++;
  }
  return removed;
 }
 async closeScan(){await this.scan?.close().catch(()=>{});this.scan=null;}
}
module.exports={PDFExportLeases,readJournal,stamp,same};
