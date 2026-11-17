// Main-owned private preparation folders; stale cleanup requires a dead recorded owner.
const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const PREFIX=/^\.notemind-archive-([1-9][0-9]{0,9})-([a-f0-9-]{36})$/i,scans=new Map(),MAX_RECEIPT=8192;
const hash=value=>createHash('sha256').update(value).digest('hex'),stamp=stat=>({dev:String(stat.dev),ino:String(stat.ino)}),same=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino;
const changed=()=>Error('Archive preparation ownership changed.');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
function encode(value){const text=JSON.stringify(value);return JSON.stringify({value,checksum:hash(text)})+'\n';}
async function readOwner(directory){
 const name=path.basename(directory),match=PREFIX.exec(name);if(!match)return null;let handle,bytes;
 try{handle=await fs.open(path.join(directory,'owner.json'),raw.constants.O_RDONLY|(raw.constants.O_NOFOLLOW||0)|(raw.constants.O_NONBLOCK||0));const stat=await handle.stat({bigint:true});if(!stat.isFile()||stat.size>BigInt(MAX_RECEIPT))return null;bytes=Buffer.allocUnsafeSlow(Number(stat.size));let at=0;while(at<bytes.length){const result=await handle.read(bytes,at,bytes.length-at,at);if(!result.bytesRead)return null;at+=result.bytesRead;}const text=bytes.toString('utf8'),packet=JSON.parse(text),value=packet?.value;if(!value||value.format!=='notemind-archive-temp'||value.version!==1||value.pid!==Number(match[1])||value.id!==match[2]||!Number.isSafeInteger(value.pid)||value.pid>0x7fffffff||value.name!==name||typeof value.target!=='string'||!value.target||path.basename(value.target)!==value.target||!value.directory||!['dev','ino'].every(key=>typeof value.directory[key]==='string'&&/^\d+$/.test(value.directory[key]))||encode(value)!==text)return null;return value;}
 catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
 finally{if(bytes?.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0);await handle?.close();}
}
async function assertDirectory(directory,identity,real){const stat=await fs.lstat(directory,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||!same(identity,stamp(stat))||await fs.realpath(directory)!==real)throw changed();}
async function createArchivePreparation(file){
 const parent=path.dirname(file),created=await fs.mkdir(parent,{recursive:true});let directory,id;
 for(let attempt=0;attempt<4;attempt++){id=randomUUID();directory=path.join(parent,`.notemind-archive-${process.pid}-${id}`);try{await fs.mkdir(directory,{mode:0o700});break;}catch(error){if(error.code!=='EEXIST'||attempt===3)throw error;}}
 const identity=stamp(await fs.lstat(directory,{bigint:true})),real=await fs.realpath(directory),owner={format:'notemind-archive-temp',version:1,pid:process.pid,id,name:path.basename(directory),target:path.basename(file),directory:identity};let journal;
 try{journal=await fs.open(path.join(directory,'owner.json'),'wx',0o600);await journal.writeFile(encode(owner));await journal.sync();await journal.close();journal=null;await require('./snapshot-store.cjs').syncHierarchy(created||parent,directory);}
 catch(error){await journal?.close().catch(()=>{});try{await assertDirectory(directory,identity,real);const current=await readOwner(directory);if(current&&encode(current)===encode(owner))await fs.rm(directory,{recursive:true});else await fs.rmdir(directory);}catch{}throw error;}
 let removed=false;return{directory,syncRoot:created||parent,assert:()=>assertDirectory(directory,identity,real),async cleanup(){if(removed)return;try{await assertDirectory(directory,identity,real);}catch(error){if(error.code==='ENOENT'){removed=true;return;}throw error;}const current=await readOwner(directory);if(!current||encode(current)!==encode(owner))throw changed();await fs.rm(directory,{recursive:true});removed=true;}};
}
async function closeArchivePreparationScan(parent){const scan=scans.get(parent);if(scan){scans.delete(parent);await scan.dir.close().catch(()=>{});}}
async function cleanupStaleArchivePreparations(parent,{maxEntries=128,maxFolders=4,isAlive=alive}={}){
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isSafeInteger(maxFolders)||maxFolders<1)throw Error('Invalid archive cleanup budget.');let scan=scans.get(parent);if(scan?.busy)return{examined:0,cleaned:0,more:true};
 if(!scan){while(scans.size>=4){const idle=[...scans].find(([,entry])=>!entry.busy);if(!idle)return{examined:0,cleaned:0,more:true};await closeArchivePreparationScan(idle[0]);}try{scan={dir:await fs.opendir(parent),busy:false};scans.set(parent,scan);}catch(error){if(error.code==='ENOENT')return{examined:0,cleaned:0,more:false};throw error;}}
 const result={examined:0,cleaned:0,more:true};let candidates=0;scan.busy=true;
 try{while(result.examined<maxEntries&&candidates<maxFolders){const entry=await scan.dir.read();if(!entry){await closeArchivePreparationScan(parent);result.more=false;break;}result.examined++;if(!entry.isDirectory()||!PREFIX.test(entry.name))continue;candidates++;const directory=path.join(parent,entry.name),owner=await readOwner(directory);if(!owner||isAlive(owner.pid))continue;const stat=await fs.lstat(directory,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||!same(owner.directory,stamp(stat))||(stat.mode&0o077n)!==0n||process.getuid&&stat.uid!==BigInt(process.getuid()))continue;const real=await fs.realpath(directory);await assertDirectory(directory,owner.directory,real);if(isAlive(owner.pid))continue;await fs.rm(directory,{recursive:true});result.cleaned++;}return result;}
 finally{scan.busy=false;}
}
module.exports={createArchivePreparation,cleanupStaleArchivePreparations,closeArchivePreparationScan};
