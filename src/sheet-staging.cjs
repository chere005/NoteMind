// Durable provenance for unpublished packs. A live candidate retains its journal
// inode lease even after rotating an append pack; recovery never guesses files.
const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {leasePack}=require('./sheet-pack-lock.cjs'),{syncDirectory}=require('./sheet-pack-store.cjs');
const MAX_JOURNAL_BYTES=256*1024,MAX_JOURNALS=16,MAX_CURSORS=2,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest=value=>createHash('sha256').update(value).digest('hex'),header=(id,pid,native)=>'NMSSTG1 '+id+' '+pid+' '+(native?1:0)+' '+digest('NMSSTG1:'+id+':'+pid+':'+(native?1:0))+'\n',record=(id,pack)=>pack+' '+digest(id+':'+pack)+'\n';
const directoryScans=new Map(),journalCache=new Map();
const sameFile=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino&&b.isFile()&&!b.isSymbolicLink();
async function unlinkOwned(file,owned){let named;try{named=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}if(!sameFile(owned,named))return false;await fs.unlink(file);return true;}
function validPack(pack){if(typeof pack!=='string'||!UUID.test(pack))throw Error('Invalid staged drawing pack.');return pack;}
async function writeAll(handle,bytes,position){let done=0;while(done<bytes.length){const result=await handle.write(bytes,done,bytes.length-done,position+done);if(!result.bytesWritten)throw Error('Could not record drawing pack provenance.');done+=result.bytesWritten;}}
class SheetStaging{
 constructor(directory,{lease=leasePack,sync=syncDirectory,id=randomUUID}={}){Object.assign(this,{directory,lease,sync,id});this.folder=path.join(directory,'staging');this.journals=[];this.seen=new Set();this.queue=Promise.resolve();this.closed=false;this.native=true;}
 serial(run){const next=this.queue.catch(()=>{}).then(run);this.queue=next;return next;}
 async create(){
  if(this.journals.length>=MAX_JOURNALS)throw Error('This drawing checkpoint has too many storage packs.');await fs.mkdir(this.folder,{recursive:true});const id=this.id();validPack(id);const file=path.join(this.folder,id+'.stage');let handle,release,owned;
  try{handle=await fs.open(file,'wx+',0o600);owned=await handle.stat();release=await this.lease(file,handle);this.native &&=!!release;const bytes=Buffer.from(header(id,process.pid,!!release));await writeAll(handle,bytes,0);await handle.sync();await this.sync(this.folder);await this.sync(this.directory);await this.sync(path.dirname(this.directory));const value={id,file,handle,release,bytes:bytes.length};this.journals.push(value);return value;}
  catch(error){try{if(owned&&await unlinkOwned(file,owned))await this.sync(this.folder);}catch{}try{await release?.();}catch{}await handle?.close().catch(()=>{});throw error;}
 }
 register(pack){validPack(pack);if(this.closed)return Promise.reject(Error('Drawing staging is closing.'));return this.serial(async()=>{
  if(this.closed)throw Error('Drawing staging is closing.');if(this.seen.has(pack))return{native:this.native};let journal=this.journals.at(-1),line=journal&&Buffer.from(record(journal.id,pack));if(!journal||journal.bytes+line.length>MAX_JOURNAL_BYTES){journal=await this.create();line=Buffer.from(record(journal.id,pack));}
  await writeAll(journal.handle,line,journal.bytes);await journal.handle.sync();journal.bytes+=line.length;this.seen.add(pack);return{native:this.native};
 });}
 async release(remove){
  const journals=this.journals;this.journals=[];this.seen.clear();let failure;
  try{if(remove){for(const journal of journals){let named;try{named=await fs.lstat(journal.file);}catch(error){if(error.code!=='ENOENT')throw error;}if(named&&!await unlinkOwned(journal.file,await journal.handle.stat()))throw Error('Drawing staging journal changed before release.');}if(journals.length)await this.sync(this.folder);}}
  catch(error){failure=error;}
  finally{for(const journal of journals){try{await journal.release?.();}catch(error){failure ||=error;}try{await journal.handle.close();}catch(error){failure ||=error;}}}
  if(failure)throw failure;
 }
 committed(){return this.serial(()=>this.release(true));}
 abandon(){return this.serial(()=>this.release(false));}
 dispose(){this.closed=true;return this.abandon();}
}
async function readJournal(handle,id){
 const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_JOURNAL_BYTES)return null;const bytes=Buffer.alloc(stat.size+1);let count=0;while(count<bytes.length){const read=await handle.read(bytes,count,bytes.length-count,count);if(!read.bytesRead)break;count+=read.bytesRead;}if(count!==stat.size)return null;
 const content=bytes.subarray(0,count);if(content.some(byte=>byte>0x7f))return null;const text=content.toString('utf8'),lines=text.split('\n');const fields=lines[0].split(' '),pid=Number(fields[2]),native=fields[3]==='1';if(!Number.isInteger(pid)||pid<=0||pid>0x7fffffff||!['0','1'].includes(fields[3])||lines[0]+'\n'!==header(id,pid,native))return null;lines.shift();lines.pop();const packs=[];
 for(const line of lines){const pack=line.slice(0,36);if(!UUID.test(pack)||line+'\n'!==record(id,pack))return null;packs.push(pack);}return{packs:[...new Set(packs)],pid,native};
}
async function closeScan(directory){const scan=directoryScans.get(directory);if(!scan)return;directoryScans.delete(directory);await scan.dir?.close().catch(()=>{});for(const [key,value]of journalCache)if(value.directory===directory)journalCache.delete(key);}
async function scanFor(directory){let scan=directoryScans.get(directory);if(scan){directoryScans.delete(directory);directoryScans.set(directory,scan);return scan;}while(directoryScans.size>=4){const idle=[...directoryScans.entries()].find(([,value])=>!value.running&&!value.pending.size);if(!idle)return{busy:true};await closeScan(idle[0]);}try{scan={dir:await fs.opendir(path.join(directory,'staging')),running:false,pending:new Set()};directoryScans.set(directory,scan);return scan;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function cleanupAbandoned(directory,{protectedPacks=new Set(),maxJournals=4,maxPacks=64,maxEntries=256,maxRecords=64,lease=leasePack,sync=syncDirectory,onReadJournal=()=>{}}={}){
 if(!(protectedPacks instanceof Set)||![maxJournals,maxPacks,maxEntries,maxRecords].every(value=>Number.isSafeInteger(value)&&value>0))throw Error('Invalid drawing staging cleanup budget.');
 const scan=await scanFor(directory),result={journals:0,packs:0,examined:0,skipped:0,invalid:0,more:false,native:true};if(!scan)return result;if(scan.busy||scan.running)return{...result,more:true};scan.running=true;
 for(const [key,cursor]of journalCache)if(cursor.directory===directory){if(cursor.remaining.length)scan.pending.add(path.basename(cursor.file));else journalCache.delete(key);}
 const pending=[...scan.pending],processed=new Set();let scanned=0,takePending=true,eof=false;
 try{
  while(scanned<maxEntries&&result.journals<maxJournals&&result.examined<maxRecords&&result.packs<maxPacks){
   let name;
   const active=[...journalCache.values()].filter(value=>value.directory===directory).length;
   if(pending.length&&(takePending||eof||active>=MAX_CURSORS)){name=pending.shift();scan.pending.delete(name);takePending=false;}
   else{
    if(active>=MAX_CURSORS)break;
    if(!scan.dir){if(eof)break;scan.dir=await fs.opendir(path.join(directory,'staging'));}
    const entry=await scan.dir.read();scanned++;takePending=true;
    if(!entry){await scan.dir.close();scan.dir=null;eof=true;if(pending.length)continue;break;}
    if(!entry.isFile()||!entry.name.endsWith('.stage'))continue;name=entry.name;
   }
   if(processed.has(name))continue;processed.add(name);const id=name.slice(0,-6);if(!UUID.test(id))continue;
   const file=path.join(directory,'staging',name);let handle,release;
   try{
    handle=await fs.open(file,raw.constants.O_RDONLY|(raw.constants.O_NOFOLLOW||0));release=await lease(file,handle);if(!release){result.skipped++;result.native=false;continue;}result.journals++;const stat=await handle.stat(),key=file+':'+stat.dev+':'+stat.ino,stamp=[stat.size,stat.mtimeMs,stat.ctimeMs].join(':');for(const cached of journalCache.keys())if(cached.startsWith(file+':')&&cached!==key)journalCache.delete(cached);let cursor=journalCache.get(key);
    if(!cursor||cursor.stamp!==stamp){journalCache.delete(key);onReadJournal(file);const journal=await readJournal(handle,id);if(!journal){result.invalid++;continue;}cursor={...journal,remaining:journal.packs,directory,file,stamp};journalCache.set(key,cursor);}
    if(!cursor.native){let alive=true;try{process.kill(cursor.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}if(alive){result.skipped++;journalCache.delete(key);scan.pending.delete(name);continue;}}
    let deleted=false,at=0;const retry=[],sliceLimit=Math.max(1,Math.ceil(maxRecords/Math.min(maxJournals,MAX_CURSORS)));
    for(;at<cursor.remaining.length&&result.examined<maxRecords&&at<sliceLimit&&result.packs<maxPacks;at++){
     const pack=cursor.remaining[at];result.examined++;if(protectedPacks.has(pack))continue;const target=path.join(directory,pack+'.pack');let packHandle,packRelease;
     try{packHandle=await fs.open(target,raw.constants.O_RDONLY|(raw.constants.O_NOFOLLOW||0));const owned=await packHandle.stat();if(!owned.isFile())throw Error('Invalid staged drawing pack file.');result.packs++;packRelease=await lease(target,packHandle);if(!packRelease){retry.push(pack);result.skipped++;continue;}if(!await unlinkOwned(target,owned))throw Error('Staged drawing storage changed while cleaning.');deleted=true;}
     catch(error){if(error.code!=='ENOENT')throw error;}
     finally{await packRelease?.();await packHandle?.close();}
    }
    if(deleted)await sync(directory);
    const blocked=at===cursor.remaining.length&&retry.length===at&&at>0;cursor.remaining=[...cursor.remaining.slice(at),...retry];
    if(blocked){journalCache.delete(key);scan.pending.delete(name);continue;}
    if(!cursor.remaining.length){if(!await unlinkOwned(file,stat))throw Error('Drawing staging journal changed while cleaning.');await sync(path.join(directory,'staging'));journalCache.delete(key);scan.pending.delete(name);}else scan.pending.add(name);
   }catch(error){if(error.code!=='ENOENT')throw error;scan.pending.delete(name);for(const key of journalCache.keys())if(key.startsWith(file+':'))journalCache.delete(key);}
   finally{await release?.();await handle?.close();}
  }
  result.more=scan.pending.size>0||!eof;if(eof&&!scan.pending.size)await closeScan(directory);return result;
 }finally{scan.running=false;}
}
module.exports={SheetStaging,cleanupAbandoned,closeCleanup:closeScan,readJournal,MAX_JOURNAL_BYTES,MAX_JOURNALS};
