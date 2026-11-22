// Copy Notepads to iCloud Drive: a one-way copy of each Notepad NoteMind saves, plus a catch-up pass over the
// NoteMind folder, into iCloud Drive/NoteMind. Unsaved Notepads (drafts kept only in the app's library) are copied
// too, by title, into iCloud Drive/NoteMind/Drafts. The originals stay where they are; the copies are for reading
// elsewhere (another Mac, a phone, the MindSuite NoteMind reader). A copy is replaced when its Notepad changes and
// removed when its Notepad is gone. Off until turned on (File > Copy Notepads to iCloud Drive).
'use strict';
const fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const NOTE_EXTENSIONS=new Set(['.nm','.wm','.md','.txt','.py']);
/** NoteMind's own working folders inside the NoteMind folder: never Notepads. */
const WORKING_FOLDERS=new Set(['asset sources','backups','devices','image search work','installation backups','pdf markup']);
const SETTLE_MS=8000,FLUSH_LIMIT_MS=15000,VISIT_LIMIT=20000,DEPTH_LIMIT=10;
/** Where unsaved Notepads' copies go, inside the copied folder. */
const DRAFTS_FOLDER='Drafts',NAME_BYTES=120,DRAFT_RETRY_MS=30000,DRAFT_RETRIES=5;

/** Where iCloud Drive lives on this computer, or null when it does not. */
function iCloudDriveRoot(home,platform=process.platform){
 if(platform==='darwin')return path.join(home,'Library','Mobile Documents','com~apple~CloudDocs');
 if(platform==='win32')return path.join(home,'iCloudDrive');
 return null;
}
const inside=(file,dir)=>{const rel=path.relative(dir,file);return rel!==''&&!rel.startsWith('..')&&!path.isAbsolute(rel);};
const isNote=file=>NOTE_EXTENSIONS.has(path.extname(file).toLowerCase())&&!path.basename(file).startsWith('.');

/** A file name for an unsaved Notepad's copy, from its title. */
function draftFileName(title){
 let name=String(title||'').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g,'-').replace(/\s+/g,' ').trim().replace(/^\.+/,'').replace(/[. ]+$/,'');
 while(Buffer.byteLength(name)>NAME_BYTES)name=name.slice(0,-1).trim();
 return name||'Untitled';
}

/** The library's unsaved Notepads that have something in them, each with the archive NoteMind keeps it in (src/notes-store.cjs). */
async function libraryDrafts(store){
 const index=await store.readIndex(),drafts=[];
 for(const record of Object.values(index?.records||{})){
  if(!record||record.deleted||record.path||!/^[\w-]{1,80}$/.test(record.id||'')||!String(record.text||'').trim())continue;
  for(const dir of [store.recoveryRoot,record.recoveryRoot]){
   if(typeof dir!=='string')continue;
   const file=path.join(dir,record.id+'.wm');
   if(fsSync.existsSync(file)){drafts.push({id:record.id,title:record.title,created:record.created,file});break;}
  }
 }
 return drafts;
}

/** The companion folders NoteMind keeps a Markdown file's pictures and metadata in (src/markdown-files.cjs). */
function markdownFolders(file){const {sidecarFolder,legacyFolder}=require('./markdown-files.cjs');return [sidecarFolder(file),legacyFolder(file)];}

function createICloudCopy({home,notesFolder,target,iCloudRoot=target?path.dirname(target):null,prefsFile,stateFile,drafts=async()=>[],registeredFiles=async()=>[],onChange=()=>{},onActivity=()=>{},log=()=>{},now=()=>Date.now(),settleMs=SETTLE_MS,retryMs=DRAFT_RETRY_MS,timers={setTimeout,clearTimeout}}={}){
 if(!home||!notesFolder||!prefsFile||!stateFile)throw Error('iCloud copy needs its folders.');
 let enabled=readJson(prefsFile)?.enabled===true;
 const pending=new Map(),inFlight=new Map(),fileErrors=new Set(),draftErrors=new Set();
 let running=Promise.resolve(),disposed=false,draftTimer=null,draftFailures=0,draftsInFlight=0;
 const activity=()=>{try{onActivity();}catch{}};

 function readJson(file){try{return JSON.parse(fsSync.readFileSync(file,'utf8'));}catch{return null;}}
 async function writeJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value)+'\n');await fs.rename(temp,file);}
 /** Copies this computer made, by their path inside the target: {source}. Kept in Application Support, never in the copied folder. */
 const readState=()=>{const state=readJson(stateFile);return state&&typeof state.copies==='object'&&state.copies?state:{copies:{}};};

 const available=()=>!!target&&!!iCloudRoot&&fsSync.existsSync(iCloudRoot);
 /** Where a Notepad's copy goes: its place in the NoteMind folder, else its place under the home folder, else under Other. */
 function copyName(file){
  const abs=path.resolve(file);
  if(inside(abs,notesFolder))return path.relative(notesFolder,abs);
  if(inside(abs,home))return path.relative(home,abs);
  return path.join('Other',abs.replace(/^[A-Za-z]:/,'').replace(/^[\\/]+/,''));
 }
 /** Is this a Notepad that should be copied? Not one already in iCloud Drive, nor a working file. */
 function wanted(file){
  const abs=path.resolve(file);
  if(!isNote(abs)||/\.tmp$/i.test(abs))return false;
  if(iCloudRoot&&(abs===iCloudRoot||inside(abs,iCloudRoot)))return false;   // already synced: copying would make a second one
  if(inside(abs,notesFolder)){const first=path.relative(notesFolder,abs).split(path.sep)[0].toLowerCase();if(WORKING_FOLDERS.has(first))return false;}
  return true;
 }

 async function copyOne(source,destination){
  const stat=await fs.stat(source);
  try{const existing=await fs.stat(destination);if(existing.size===stat.size&&Math.abs(existing.mtimeMs-stat.mtimeMs)<1)return false;}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(path.dirname(destination),{recursive:true});
  const temp=path.join(path.dirname(destination),'.'+path.basename(destination)+'.'+crypto.randomUUID()+'.tmp');
  try{await fs.copyFile(source,temp);await fs.utimes(temp,stat.atime,stat.mtime);await fs.rename(temp,destination);}
  finally{await fs.rm(temp,{force:true});}
  return true;
 }
 async function copyTree(source,destination){
  let changed=false;
  for(const entry of await fs.readdir(source,{withFileTypes:true})){
   if(entry.name.startsWith('.'))continue;
   const from=path.join(source,entry.name),to=path.join(destination,entry.name);
   if(entry.isDirectory())changed=await copyTree(from,to)||changed;else if(entry.isFile())changed=await copyOne(from,to)||changed;
  }
  return changed;
 }

 async function copyNote(file,state){
  const abs=path.resolve(file),name=copyName(abs),destination=path.join(target,name);
  let changed=await copyOne(abs,destination);
  if(path.extname(abs).toLowerCase()==='.md')for(const folder of markdownFolders(abs)){
   const from=path.join(path.dirname(abs),folder);
   if(fsSync.existsSync(from))changed=await copyTree(from,path.join(path.dirname(destination),folder))||changed;
  }
  state.copies[name]={source:abs};
  fileErrors.delete(abs);
  return changed;
 }
 async function removeCopy(name){
  const destination=path.join(target,name);
  if(!inside(destination,target))return;
  await fs.rm(destination,{force:true});
  if(path.extname(name).toLowerCase()==='.md')for(const folder of markdownFolders(name))await fs.rm(path.join(path.dirname(destination),folder),{recursive:true,force:true});
 }

 /** A copy cut off by quitting leaves its hidden temporary file; remove any older than ten minutes. */
 async function clearStaleTemporaries(dir,depth=0){
  let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   const full=path.join(dir,entry.name);
   if(entry.isDirectory()){if(depth<DEPTH_LIMIT)await clearStaleTemporaries(full,depth+1);}
   else if(/^\..+\.[0-9a-f-]{36}\.tmp$/.test(entry.name)){try{if(now()-(await fs.stat(full)).mtimeMs>600000)await fs.rm(full,{force:true});}catch{}}
  }
 }

 /** Run one copy job after the last, so the state file is only ever written by one. */
 function serial(job){const next=running.then(job,job);running=next.catch(()=>{});return next;}
 const report=error=>log('iCloud copy: '+(error?.message||error));
 /** Something in the copied folder changed (Notepads on the web follows it). */
 const changedFolder=()=>{try{onChange();}catch{}};

 async function copySources(files,state){
  let copied=0;
  for(const file of new Set(files)){
   const abs=path.resolve(file);
   try{if(wanted(abs)&&fsSync.existsSync(abs)&&await copyNote(abs,state))copied++;}
   catch(error){fileErrors.add(abs);report(error);}
  }
  return copied;
 }

 async function copyFiles(files){
  if(!enabled||!available())return 0;
  const state=readState(),count=await copySources(files,state);
  await writeJson(stateFile,state);
  if(count)changedFolder();
  return count;
 }

 /** Copy every unsaved Notepad into Drafts, by title (oldest first keeps a plain name; later ones of the same
  * title get " 2", " 3"), and remove the copies of drafts that were deleted, saved to a file or renamed. */
 async function copyDrafts(state){
  let copied=0,removed=0,list;
  // The library can be briefly unreadable (its archive worker is restarted while a large Notepad opens): keep every
  // copy as it is and try again a little later, a few times.
  try{list=await drafts();draftFailures=0;draftErrors.clear();}catch(error){report(error);if(++draftFailures<=DRAFT_RETRIES)scheduleDrafts(retryMs);return {copied,removed};}
  const taken=new Set(Object.entries(state.copies).filter(([,entry])=>typeof entry?.source==='string').map(([name])=>name.toLowerCase())),current=new Set();
  list=[...(Array.isArray(list)?list:[])].filter(d=>d&&typeof d.id==='string'&&typeof d.file==='string').sort((a,b)=>String(a.created||'').localeCompare(String(b.created||''))||a.id.localeCompare(b.id));
  for(const draft of list){
   const base=draftFileName(draft.title);let name,n=1;
   do{name=path.join(DRAFTS_FOLDER,(n>1?base+' '+n:base)+'.nm');n++;}while(taken.has(name.toLowerCase()));
   taken.add(name.toLowerCase());current.add(name);
   try{if(await copyOne(draft.file,path.join(target,name)))copied++;state.copies[name]={draft:draft.id};}catch(error){draftErrors.add(draft.id);report(error);}
  }
  for(const [name,entry]of Object.entries(state.copies)){
   if(typeof entry?.draft!=='string'||current.has(name))continue;
   try{await removeCopy(name);delete state.copies[name];removed++;}catch(error){report(error);}
  }
  return {copied,removed};
 }

 /** The catch-up pass: copy every Notepad in the NoteMind folder and every Notepad copied before; remove copies whose Notepad is gone. */
 async function sweep(){
  draftsInFlight++;activity();
  return serial(async()=>{
   if(!enabled||!available())return {copied:0,removed:0};
   timers.clearTimeout(draftTimer);draftTimer=null;
   const found=[];let visited=0;
   const walk=async(dir,depth)=>{
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
     if(++visited>VISIT_LIMIT||entry.name.startsWith('.'))continue;
     const full=path.join(dir,entry.name);
     if(entry.isDirectory()){if(depth<DEPTH_LIMIT&&!/\.assets$/i.test(entry.name)&&!(dir===notesFolder&&WORKING_FOLDERS.has(entry.name.toLowerCase())))await walk(full,depth+1);}
     else if(entry.isFile()&&wanted(full))found.push(full);
    }
   };
   await walk(notesFolder,0);
   try{found.push(...await registeredFiles());}catch(error){report(error);}
   await clearStaleTemporaries(target);
   const state=readState(),sources=new Set(found);
   for(const {source}of Object.values(state.copies))if(typeof source==='string'&&fsSync.existsSync(source)&&wanted(source))sources.add(source);
   let copied=await copySources(sources,state),removed=0;
   for(const [name,entry]of Object.entries(state.copies)){
    const source=entry?.source;
    if(typeof entry?.draft==='string'||typeof source==='string'&&fsSync.existsSync(source)&&copyName(source)===name)continue;
    try{await removeCopy(name);delete state.copies[name];removed++;}catch(error){report(error);}
   }
   const fromDrafts=await copyDrafts(state);copied+=fromDrafts.copied;removed+=fromDrafts.removed;
   await writeJson(stateFile,state);
   if(copied||removed){log('iCloud copy: '+copied+' copied, '+removed+' removed');changedFolder();}
   return {copied,removed};
  }).catch(error=>{report(error);return {copied:0,removed:0};}).finally(()=>{draftsInFlight--;activity();});
 }

 /** A Notepad was saved: copy it once saving settles (autosave can save often). */
 function saved(file){
  if(disposed||!enabled||!file||!wanted(file))return;
  const abs=path.resolve(file);
  timers.clearTimeout(pending.get(abs));
  const timer=timers.setTimeout(()=>{
   pending.delete(abs);
   void queueFiles([abs]);
  },settleMs);
  timer?.unref?.();
  pending.set(abs,timer);
  activity();
 }

 function queueFiles(files){
  for(const file of files)inFlight.set(file,(inFlight.get(file)||0)+1);
  activity();
  return serial(()=>copyFiles(files)).catch(error=>{
   for(const file of files)fileErrors.add(file);
   report(error);
  }).finally(()=>{
   for(const file of files){
    const count=inFlight.get(file);
    if(count===1)inFlight.delete(file);
    else inFlight.set(file,count-1);
   }
   activity();
  });
 }

 /** Unsaved Notepads only: copy what changed, remove what is gone. */
 function syncDrafts(){
  draftsInFlight++;activity();
  return serial(async()=>{
   if(!enabled||!available())return {copied:0,removed:0};
   const state=readState(),result=await copyDrafts(state);
   await writeJson(stateFile,state);
   if(result.copied||result.removed){log('iCloud copy: '+result.copied+' copied, '+result.removed+' removed (drafts)');changedFolder();}
   return result;
  }).catch(error=>{report(error);return {copied:0,removed:0};}).finally(()=>{draftsInFlight--;activity();});
 }

 function scheduleDrafts(ms){
  if(disposed||!enabled)return;
  timers.clearTimeout(draftTimer);
  draftTimer=timers.setTimeout(()=>{draftTimer=null;void syncDrafts();},ms);
  draftTimer?.unref?.();
  activity();
 }
 /** The library changed (a draft autosaved, a Notepad renamed, deleted or restored): copy the drafts once it settles. */
 const libraryChanged=()=>scheduleDrafts(settleMs);

 /** Copy what is waiting now (quitting, or the setting turned off), at most FLUSH_LIMIT_MS. */
 async function flush(){
  const files=[...pending.keys()],drafting=!!draftTimer;for(const timer of pending.values())timers.clearTimeout(timer);pending.clear();
  timers.clearTimeout(draftTimer);draftTimer=null;
  if(!files.length&&!drafting)return running;
  let timeout;const limit=new Promise(resolve=>{timeout=setTimeout(resolve,FLUSH_LIMIT_MS);timeout.unref?.();});
  try{await Promise.race([Promise.all([files.length?queueFiles(files):null,drafting?syncDrafts():null]),limit]);}finally{clearTimeout(timeout);}
 }

 async function setEnabled(value){
  value=!!value;
  if(!value)await flush();
  enabled=value;await writeJson(prefsFile,{enabled});activity();
  if(enabled)return sweep();
 }

 /** A save's result passes through: a saved Notepad's path is noted for copying. */
 const afterSave=result=>{if(result&&typeof result.path==='string')saved(result.path);return result;};

 /** Local copy state by original path or draft ID. Fingerprints distinguish older uploads. */
 function status(){
  const files=Object.create(null),drafts=Object.create(null);
  if(!enabled)return {enabled:false,files,drafts};
  for(const [name,entry]of Object.entries(readState().copies)){
   const destination=path.resolve(target||notesFolder,name);
   if(!target||!inside(destination,target))continue;
   try{
    const {size,mtimeMs}=fsSync.statSync(destination);
    const copy={rel:name.split(path.sep).join('/'),size,mtime:Math.round(mtimeMs)};
    if(entry.source)files[entry.source]=copy;
    else if(entry.draft)drafts[entry.draft]=copy;
   }catch{/* A copy may be absent while iCloud downloads it. */}
  }
  for(const file of fileErrors)files[file]={state:'error',message:'Could not copy this file to iCloud Drive.'};
  for(const file of [...pending.keys(),...inFlight.keys()])files[file]={state:'syncing'};
  for(const id of draftErrors)drafts[id]={state:'error',message:'Could not copy this draft to iCloud Drive.'};
  return {enabled:true,files,drafts,draftsPending:!!draftTimer||draftsInFlight>0,draftsFailed:draftFailures>DRAFT_RETRIES};
 }

 return {status,saved,afterSave,libraryChanged,sweep,syncDrafts,flush,setEnabled,isEnabled:()=>enabled,isAvailable:available,copyName,wanted,target,dispose:()=>{disposed=true;timers.clearTimeout(draftTimer);draftTimer=null;}};
}

module.exports={createICloudCopy,iCloudDriveRoot,libraryDrafts,draftFileName,WORKING_FOLDERS,DRAFTS_FOLDER};
