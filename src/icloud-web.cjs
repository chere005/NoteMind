// Notepads on the web: iCloud Drive/NoteMind, mirrored into the private iCloud database (CloudKit) of the Apple ID
// signed in under File > Show Notepads on the Web, so the MindSuite NoteMind reader (seancheren.com/NoteMind/) can list
// and open them after the same Apple ID signs in there. A web page cannot read iCloud Drive; CloudKit is how it reads
// iCloud. One record per file in the copied folder (its bytes as an asset, a Notepad's text for the list and search),
// plus one index record naming them all, so the reader needs no query. A changed file is sent again and a file that is
// gone is deleted. The records are copies for reading: nothing written on the web comes back.
'use strict';
const fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

/** Where the records live. The container and its web token are AcctMind's (made in CloudKit Console 2026-11-09, DEVELOPMENT
 * environment, sign-in callback "postMessage", allowed origins seancheren.com and test.seancheren.com). The token is not a
 * secret: every page that uses CloudKit JS ships it, and it only lets a page ask a person to sign in. The page that signs
 * in is NoteMind's own (src/icloud-web-page.js), given the seancheren.com origin the token allows. */
const CLOUD=Object.freeze({
 container:'iCloud.com.seancheren.acctmind',
 environment:'development',
 apiToken:'61dc739a9fdb70f28ea080bc17c5ef420164be6e50ccd77ed4e791d714bd364f',
 page:'https://seancheren.com/NoteMind/icloud/',
});
const FILE_TYPE='NoteMindFile',INDEX_TYPE='NoteMindIndex',INDEX_NAME='notemind-index',FORMAT=1;
const NOTE_EXTENSIONS=new Set(['.nm','.wm','.md','.txt','.py']);
const TEXT_CHARS=100000,TEXT_BYTES=600000,FILE_LIMIT=240*1024*1024,VISIT_LIMIT=20000,DEPTH_LIMIT=10;
const SETTLE_MS=10000,RETRY_MS=60000,RETRIES=5;

/** The record of the file at this path inside the copied folder ('/'-separated). */
const recordName=rel=>'nmf-'+crypto.createHash('sha256').update(rel).digest('hex').slice(0,40);
/** Is this path a Notepad the reader lists (not a picture in a Markdown companion folder)? */
const isNotePath=rel=>NOTE_EXTENSIONS.has(path.posix.extname(rel).toLowerCase())&&!rel.split('/').slice(0,-1).some(part=>/\.assets$/i.test(part));

/** Every file in the copied folder: hidden files, unfinished copies and iCloud placeholders are not. */
async function listFiles(root){
 const files=[];let visited=0;
 const walk=async(dir,prefix,depth)=>{
  let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   if(++visited>VISIT_LIMIT||entry.name.startsWith('.')||/\.(tmp|icloud)$/i.test(entry.name))continue;
   const full=path.join(dir,entry.name),rel=prefix?prefix+'/'+entry.name:entry.name;
   if(entry.isDirectory()){if(depth<DEPTH_LIMIT)await walk(full,rel,depth+1);}
   else if(entry.isFile()){try{const stat=await fs.stat(full);files.push({rel,abs:full,size:stat.size,mtime:Math.round(stat.mtimeMs)});}catch{}}
  }
 };
 await walk(root,'',0);
 return files.sort((a,b)=>a.rel<b.rel?-1:a.rel>b.rel?1:0);
}

/** A Notepad's text, cut to what one record can carry next to its other fields. */
function clipText(text){
 let out=String(text||'').slice(0,TEXT_CHARS);
 while(Buffer.byteLength(out)>TEXT_BYTES)out=out.slice(0,Math.floor(out.length*0.9));
 return out;
}

/**
 * The publisher. `bridge` reaches CloudKit: appleId() resolves to the signed-in Apple ID's CloudKit record name or null, save(record)
 * and remove(names) resolve when CloudKit has them. `readFacts(file)` gives a Notepad's {text, meta, id, kind}.
 */
function createWebPublisher({target,stateFile,bridge,readFacts,app='',log=()=>{},settleMs=SETTLE_MS,retryMs=RETRY_MS,timers={setTimeout,clearTimeout}}={}){
 if(!target||!stateFile||!bridge)throw Error('Notepads on the web needs its folder, its state file and its bridge.');
 let timer=null,running=null,again=false,disposed=false,failures=0;
 const report=error=>log('Notepads on the web: '+(error?.message||error));

 function readState(){
  try{const state=JSON.parse(fsSync.readFileSync(stateFile,'utf8'));if(state&&typeof state==='object'&&state.records&&typeof state.records==='object')return state;}catch{}
  return {appleId:null,records:{},index:null,published:null};
 }
 async function writeState(state){
  await fs.mkdir(path.dirname(stateFile),{recursive:true});
  const temp=stateFile+'.'+crypto.randomUUID()+'.tmp';
  await fs.writeFile(temp,JSON.stringify(state)+'\n');await fs.rename(temp,stateFile);
 }

 function schedule(ms){
  if(disposed)return;
  timers.clearTimeout(timer);
  timer=timers.setTimeout(()=>{timer=null;void publish();},ms);
  timer?.unref?.();
 }

 async function fieldsFor(file,hash){
  const fields={path:file.rel,bytes:file.size,modified:file.mtime,sha256:hash,format:FORMAT};
  if(isNotePath(file.rel)){
   let facts=null;try{facts=await readFacts(file.abs);}catch(error){report(file.rel+': '+(error?.message||error));}
   const meta=facts&&typeof facts.meta==='object'&&facts.meta?facts.meta:{};
   fields.text=clipText(facts?.text);
   fields.meta=JSON.stringify({pinned:meta.pinned===true,tags:Array.isArray(meta.tags)?meta.tags.filter(tag=>typeof tag==='string').slice(0,20):[],id:typeof facts?.id==='string'?facts.id:null,kind:typeof facts?.kind==='string'?facts.kind:null});
  }
  return fields;
 }

 async function run(){
  const appleId=await bridge.appleId();
  if(!appleId)return {signedIn:false,uploaded:0,removed:0,failed:0};
  let state=readState();
  if(state.appleId!==appleId){state={appleId,records:{},index:null,published:null};await writeState(state);}   // another Apple ID: its database has none of these
  if(!fsSync.existsSync(target))return {signedIn:true,uploaded:0,removed:0,failed:0};
  const files=await listFiles(target),present=new Set(files.map(file=>file.rel));
  let uploaded=0,removed=0,failed=0;
  for(const file of files){
   if(disposed)break;
   const known=state.records[file.rel];
   if(known&&known.size===file.size&&known.mtime===file.mtime)continue;
   if(file.size>FILE_LIMIT){report(file.rel+' is too large for iCloud on the web.');continue;}
   try{
    const bytes=await fs.readFile(file.abs),hash=crypto.createHash('sha256').update(bytes).digest('hex'),name=recordName(file.rel);
    await bridge.save({recordType:FILE_TYPE,recordName:name,fields:await fieldsFor(file,hash),file:{bytes,name:path.posix.basename(file.rel)}});
    state.records[file.rel]={name,size:file.size,mtime:file.mtime};
    uploaded++;
    await writeState(state);
   }catch(error){failed++;report(file.rel+': '+(error?.message||error));}
  }
  const gone=Object.keys(state.records).filter(rel=>!present.has(rel));
  if(gone.length&&!disposed){
   try{await bridge.remove(gone.map(rel=>state.records[rel].name));for(const rel of gone)delete state.records[rel];removed=gone.length;}
   catch(error){failed++;report(error);}
  }
  const entries=Object.entries(state.records).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([rel,record])=>[rel,record.name,record.size,record.mtime]);
  const index=JSON.stringify({format:FORMAT,files:entries}),digest=crypto.createHash('sha256').update(index).digest('hex');
  if(digest!==state.index&&!disposed){
   try{await bridge.save({recordType:INDEX_TYPE,recordName:INDEX_NAME,fields:{files:index,written:Date.now(),app:String(app)}});state.index=digest;state.published=Date.now();}
   catch(error){failed++;report(error);}
  }
  await writeState(state);
  if(uploaded||removed)log('Notepads on the web: '+uploaded+' sent, '+removed+' removed'+(failed?', '+failed+' failed':''));
  return {signedIn:true,uploaded,removed,failed};
 }

 /** Publish now (one run at a time; a change during a run publishes again after it). */
 function publish(){
  if(disposed)return Promise.resolve({signedIn:false,uploaded:0,removed:0,failed:0});
  if(running){again=true;return running;}
  timers.clearTimeout(timer);timer=null;
  running=run().catch(error=>{report(error);return {signedIn:false,uploaded:0,removed:0,failed:1};}).then(result=>{
   if(result.failed){if(++failures<=RETRIES)schedule(retryMs);}else failures=0;
   return result;
  }).finally(()=>{running=null;if(again){again=false;schedule(settleMs);}});
  return running;
 }

 /** The copied folder changed: publish once it settles. */
 const changed=()=>schedule(settleMs);

 /** What the window says: how many files are on the web, and when the list was last sent. */
 function summary(){
  const state=readState();
  return {appleId:state.appleId,files:Object.keys(state.records).length,notepads:Object.keys(state.records).filter(isNotePath).length,published:state.published};
 }
 /** Signed out: forget what was sent, so the next Apple ID gets everything. */
 async function forget(){await writeState({appleId:null,records:{},index:null,published:null});}
 /** Was an Apple ID signed in when this computer last published? (Then publish at start without being asked.) */
 const wasSignedIn=()=>!!readState().appleId;

 return {changed,publish,summary,forget,wasSignedIn,dispose:()=>{disposed=true;timers.clearTimeout(timer);timer=null;}};
}

module.exports={createWebPublisher,listFiles,recordName,isNotePath,clipText,CLOUD,FILE_TYPE,INDEX_TYPE,INDEX_NAME,FORMAT};
