// Renderer-side immutable identities keep unchanged geometry and image bytes out of autosave IPC.
const {uploadSheetDelta}=require('./sheet-delta-upload.js');
const {SheetIdSet}=require('./sheet-id-set.js'),{ownedStoredId,writeOwnedFingerprintWords}=require('./owned-ink-metadata.js');
const {yieldTask,encodeBytesAsync}=require('./graphics-pane.js'),{strokeFingerprint}=require('./stroke-signature.js');
function semanticMetadata(sheet){if(!sheet||typeof sheet!=='object')return null;const {strokes,backdrop,pageId,geometryRevision,loaded,...metadata}=sheet;return JSON.stringify(Object.fromEntries(Object.keys(metadata).sort().map(key=>[key,metadata[key]])));}
class SheetSaveQueue{
 constructor(api,{id=()=>globalThis.crypto.randomUUID()}={}){this.api=api;this.id=id;this.strokeIds=new WeakMap();this.backdropIds=new Map();this.nextStroke=1;this.nextBackdrop=1;this.serverNextStroke=1;this.pageHeads=new Map();this.eviction=null;this.seedEpoch=0;this.freshStrokes=new Map();this.freshBackdrops=new Map();this.knownStrokes=new SheetIdSet();this.knownBackdrops=new Set();this.session=null;this.ownedSession=null;this.ownedPersisted=false;this.version=0;this.full=true;this.latest=null;this.waiters=[];this.running=false;this.revision=0;this.disposed=false;this.persisted=null;}
 seedCatalog(state){if(!state||typeof state.session!=='string'||!Number.isSafeInteger(state.version)||!Array.isArray(state.pages))throw Error('Invalid drawing page catalog.');this.session=state.session;this.ownedSession=state.session;this.ownedPersisted=state.persisted!==false;this.version=state.version;this.nextStroke=Math.max(this.nextStroke,state.nextStroke||1);this.serverNextStroke=state.nextStroke||1;this.nextBackdrop=Math.max(this.nextBackdrop,state.nextBackdrop||1);for(const page of state.pages)this.pageHeads.set(page.pageId,{geometryRevision:page.geometryRevision,metadataSignature:semanticMetadata(page.metadata)});this.full=false;}
 identity(data){return data.map(sheet=>{const {strokes,backdrop}=sheet,head=this.pageHeads.get(sheet.pageId),known=!!head?.durable&&(sheet.loaded===false||head.strokes===strokes&&head.backdrop===(backdrop||null));return {pageId:sheet.pageId,geometryKnown:known,geometryRevision:known?head.geometryRevision:null,strokes:known?undefined:strokes,backdrop:known?null:backdrop||null,metadata:semanticMetadata(sheet)};});}
 sameIdentity(a,b){return !!a&&a.length===b.length&&a.every((sheet,index)=>sheet.pageId===b[index].pageId&&sheet.geometryKnown===b[index].geometryKnown&&sheet.geometryRevision===b[index].geometryRevision&&sheet.strokes===b[index].strokes&&sheet.backdrop===b[index].backdrop&&sheet.metadata===b[index].metadata);}
 idOf(stroke,namespace=this.session){return ownedStoredId(stroke,namespace)??this.strokeIds.get(stroke);}
 *seedSteps(state,merge=false){
  if(!state||typeof state.session!=='string'||!Number.isSafeInteger(state.version)||state.version<0)throw Error('Invalid drawing persistence session.');
  const hadSession=!!this.session,sheets=state.sheets||[],owned=state.ownedIdentities===true;
  if(!Array.isArray(sheets)||!owned&&(!Array.isArray(state.strokeIds)||state.strokeIds.length!==sheets.length)||!Array.isArray(state.backdropIds)||state.backdropIds.length!==sheets.length)throw Error('Invalid drawing persistence identities.');
  if(merge&&this.ownedSession&&this.ownedSession!==state.session)throw Error('Drawing page belongs to another persistence session.');
  const expected=sheets.reduce((count,sheet)=>count+(sheet.strokes?.length||0),0),seenStrokes=new SheetIdSet(expected),seenBackdrops=new Set(),weights=[],members=[];
  let work=0;for(let index=0;index<sheets.length;index++){
   const sheet=sheets[index],ids=owned?null:state.strokeIds[index];if(!Array.isArray(sheet?.strokes))throw Error('Invalid drawing stroke identities.');const member=new SheetIdSet(sheet.strokes.length);let modelBytes=0;
   if(!Array.isArray(sheet.strokes)||!owned&&(!Array.isArray(ids)&&!(ids instanceof Float64Array)||ids.length!==sheet.strokes.length))throw Error('Invalid drawing stroke identities.');
   for(let at=0;at<sheet.strokes.length;at++){
    const stroke=sheet.strokes[at],privateId=ownedStoredId(stroke,state.session),value=owned?privateId:ids[at];
    if(!Number.isSafeInteger(value)||value<=0||privateId!=null&&privateId!==value)throw Error('Invalid drawing stroke identity.');
    modelBytes+=128+(stroke.points?.length||0)*(stroke.pressures?80:72);if(privateId==null)this.strokeIds.set(stroke,value);seenStrokes.add(value);member.add(value);this.nextStroke=Math.max(this.nextStroke,value+1);if(++work%8192===0)yield;
   }
   const backdrop=state.backdropIds[index];if(sheet.backdrop){if(!Number.isSafeInteger(backdrop)||backdrop<=0)throw Error('Invalid drawing background identity.');this.backdropIds.set(sheet.backdrop,backdrop);seenBackdrops.add(backdrop);this.nextBackdrop=Math.max(this.nextBackdrop,backdrop+1);}weights[index]=modelBytes+(sheet.backdrop?.length||0)*2;members[index]=member;
  }
  const epoch=merge?++this.seedEpoch:0;
  for(let at=0;at<sheets.length;at++)if(sheets[at].pageId){this.pageHeads.set(sheets[at].pageId,{geometryRevision:sheets[at].geometryRevision||null,signature:state.signatures?.[at]||sheets[at].signature,metadataSignature:semanticMetadata(sheets[at]),strokes:sheets[at].strokes,backdrop:sheets[at].backdrop||null,durable:state.durabilityConfirmed!==false,modelBytes:weights[at]});if(merge)this.freshStrokes.set(sheets[at].pageId,{epoch,ids:members[at]});}
  this.ownedSession=state.session;this.ownedPersisted=merge?this.ownedPersisted||state.persisted!==false:state.persisted!==false;this.session=state.session;this.version=merge&&hadSession?this.version:state.version;this.nextStroke=Math.max(this.nextStroke,state.nextStroke||1);this.serverNextStroke=Math.max(this.serverNextStroke,state.nextStroke||this.nextStroke);this.nextBackdrop=Math.max(this.nextBackdrop,state.nextBackdrop||1);
  if(merge){if(this.knownStrokes.size===0)this.knownStrokes=seenStrokes;else for(const value of seenStrokes.steps()){if(value===null)yield;else this.knownStrokes.add(value);}for(const id of seenBackdrops){this.knownBackdrops.add(id);this.freshBackdrops.set(id,epoch);}}else{this.knownStrokes=seenStrokes;this.knownBackdrops=seenBackdrops;}
  this.full=false;if(!merge)this.persisted=state.sheets?this.identity(state.sheets):null;return state.sheets;
 }
 seed(state){const steps=this.seedSteps(state);let next;do{next=steps.next();}while(!next.done);return next.value;}
 async seedAsync(state,{yieldControl=yieldTask,signal}={}){const steps=this.seedSteps(state);for(;;){if(this.disposed)throw Error('Drawing persistence is closing.');if(signal?.aborted)throw Object.assign(Error('Drawing recovery cancelled.'),{name:'AbortError'});const next=steps.next();if(next.done)return next.value;await yieldControl();}}
 async seedPage(state,{yieldControl=yieldTask,signal}={}){if(this.eviction)await this.eviction;const steps=this.seedSteps(state,true);for(;;){if(this.disposed)throw Error('Drawing persistence is closing.');if(signal?.aborted)throw Object.assign(Error('Drawing recovery cancelled.'),{name:'AbortError'});const next=steps.next();if(next.done)return next.value;await yieldControl();}}
 *buildSteps(data,requestId,{compact=false}={}){
  if(!Array.isArray(data)||!data.length)throw Error('Invalid drawing sheets.');const seedEpoch=this.seedEpoch;
  if(!this.session)return {seedEpoch,payload:{requestId,session:null,baseVersion:0,expectedSession:this.ownedSession,expectedPersisted:this.ownedPersisted},usedStrokes:new SheetIdSet(),usedBackdrops:new Set()};
  if(!this.full&&this.sameIdentity(this.persisted,this.identity(data)))return {seedEpoch,payload:{requestId,session:this.session,baseVersion:this.version,expectedSession:this.ownedSession,expectedPersisted:this.ownedPersisted,unchanged:true},usedStrokes:this.knownStrokes,usedBackdrops:this.knownBackdrops};
  const open=new Set(data.map(row=>row.pageId).filter(Boolean)),sameGeometry=!this.full&&data.every(row=>{const head=this.pageHeads.get(row.pageId);return row.loaded===false||head?.durable&&head.strokes===row.strokes&&head.backdrop===(row.backdrop||null);})&&[...this.pageHeads].every(([id,head])=>!head.strokes||open.has(id));
  const addBackdrops=[],usedStrokes=sameGeometry?this.knownStrokes:new SheetIdSet(data.reduce((n,row)=>n+(row.strokes?.length||0),0)),usedBackdrops=sameGeometry?this.knownBackdrops:new Set(),sheets=[];
  let work=0,entries=[],entryBytes=0,addedPoints=0,chunked=false;
  for(const sheet of data){
   const {strokes,backdrop,pageId,geometryRevision,loaded,...metadata}=sheet,head=pageId&&this.pageHeads.get(pageId);
   if(loaded===false||sameGeometry){if(!pageId||!head)throw Error('Unloaded drawing pages must retain their stored identity.');sheets.push({pageId,metadata,preserveGeometry:true,geometryRevision:head.geometryRevision});continue;}
   if(!Array.isArray(strokes))throw Error('Invalid drawing strokes.');
   const strokeIds=new Float64Array(strokes.length);let append=!this.full&&!!head?.strokes&&strokes.length>=head.strokes.length;
   for(let at=0;at<strokes.length;at++){
    const stroke=strokes[at];let value=this.idOf(stroke);if(!value){value=this.nextStroke++;this.strokeIds.set(stroke,value);}
    if(!usedStrokes.has(value)&&(!this.knownStrokes.has(value)||this.full)){
     const length=16+stroke.points.length*(stroke.pressures?24:16);
     if(chunked&&entries.length&&entryBytes+length>512*1024){const encode=entries;entries=[];entryBytes=0;yield {encode};}
     entries.push({id:value,stroke});entryBytes+=length;addedPoints+=stroke.points.length;
     if(compact&&(entries.length>=10000||addedPoints>=10000))chunked=true;
     if(chunked&&entryBytes>=512*1024){const encode=entries;entries=[];entryBytes=0;yield {encode};}
    }
    usedStrokes.add(value);strokeIds[at]=value;
    if(append&&(at<head.strokes.length?value!==this.idOf(head.strokes[at]):value<this.serverNextStroke))append=false;
    if(++work%8192===0)yield;
   }
   let backdropId=0;if(backdrop){backdropId=this.backdropIds.get(backdrop);if(!backdropId){backdropId=this.nextBackdrop++;this.backdropIds.set(backdrop,backdropId);}if(!usedBackdrops.has(backdropId)&&(!this.knownBackdrops.has(backdropId)||this.full))addBackdrops.push({id:backdropId,data:backdrop});usedBackdrops.add(backdropId);}
   sheets.push({...(pageId?{pageId}:{}),metadata,...(append?{appendStrokeIds:strokeIds.subarray(head.strokes.length),geometryRevision:head.geometryRevision}:{strokeIds}),backdropId});
  }
  if(chunked&&entries.length){const encode=entries;entries=[];yield {encode};}
  return {seedEpoch,payload:{requestId,session:this.session,baseVersion:this.version,expectedSession:this.ownedSession,expectedPersisted:this.ownedPersisted,full:this.full,sheets,addStrokes:entries,addBackdrops},usedStrokes,usedBackdrops};
 }
 build(data,requestId){const steps=this.buildSteps(data,requestId);let next;do{next=steps.next();}while(!next.done);return next.value;}
 async buildAsync(data,requestId){
  const steps=this.buildSteps(data,requestId,{compact:true}),chunks=[];let built;
  for(;;){if(this.disposed)throw Error('Drawing persistence is closing.');const next=steps.next();if(next.done){built=next.value;break;}if(next.value?.encode){const entries=next.value.encode,identityBytes=new Uint8Array(entries.length*16),view=new DataView(identityBytes.buffer);for(let at=0;at<entries.length;at++){const entry=entries[at];view.setFloat64(at*16,entry.id,true);if(!writeOwnedFingerprintWords(entry.stroke,view,at*16+8)){const hash=strokeFingerprint(entry.stroke);view.setUint32(at*16+8,parseInt(hash.slice(0,8),16),true);view.setUint32(at*16+12,parseInt(hash.slice(8),16),true);}}chunks.push({bytes:await encodeBytesAsync({name:'Drawing data',aspect:1,strokes:entries.map(entry=>entry.stroke)}),identityBytes});}await yieldTask();}
  if(chunks.length){built.payload.addChunks=chunks;}return built;
 }
 reset(answer={}){if(typeof answer.session==='string'){if(this.ownedSession&&this.ownedSession!==answer.session&&(this.ownedPersisted||!answer.unowned))throw Error('Saved drawing storage was replaced outside this window. Current drawings remain open.');this.ownedSession=answer.session;this.ownedPersisted ||=answer.persisted===true;}this.session=typeof answer.session==='string'?answer.session:null;this.version=Number.isSafeInteger(answer.version)?answer.version:0;this.knownStrokes.clear();this.knownBackdrops.clear();this.full=true;}
 async write(data,requestId){
  let activeRequestId=requestId;
  for(let attempt=0;attempt<6;attempt++){
   const built=await this.buildAsync(data,activeRequestId);let answer;
   try{answer=await uploadSheetDelta(this.api,built.payload,{check:()=>{if(this.disposed)throw Error('Drawing persistence is closing.');}});}catch(error){if(attempt<5&&/worker stopped|worker.*exited|timed out/i.test(error.message)){this.reset();continue;}throw error;}
   if(this.disposed)throw Error('Drawing persistence is closing.');if(answer?.resync){this.reset(answer);continue;}
   if(answer?.idempotent){if(answer.currentVersion!==answer.version){this.reset({session:answer.session,version:answer.currentVersion});activeRequestId=this.id();continue;}if(!built.payload.session){this.reset({session:answer.session,version:answer.version});continue;}}
   const replayed=answer?.idempotent&&answer.version===this.version;
   if(!answer||answer.session!==this.session||answer.requestId!==activeRequestId||!Number.isSafeInteger(answer.version)||answer.version!==this.version+(built.payload.unchanged||replayed?0:1)||!!answer.unchanged!==!!built.payload.unchanged)throw Error('Invalid drawing save acknowledgement.');
   this.version=answer.version;this.ownedSession=answer.session;this.ownedPersisted ||=answer.persisted!==false;this.full=false;this.serverNextStroke=this.nextStroke;this.knownStrokes=built.usedStrokes;this.knownBackdrops=built.usedBackdrops;let acknowledgedWork=0;
   for(const [page,batch]of this.freshStrokes){if(batch.epoch>built.seedEpoch){for(const id of batch.ids.steps()){if(id===null){await yieldTask();if(this.disposed)throw Error('Drawing persistence is closing.');}else this.knownStrokes.add(id);}}else this.freshStrokes.delete(page);}
   for(const [id,epoch]of this.freshBackdrops){if(epoch>built.seedEpoch)this.knownBackdrops.add(id);else this.freshBackdrops.delete(id);}const updates=new Map(answer.pages?.map(page=>[page.pageId,page])||[]),roots=new Map(answer.pages?.map(page=>[page.pageId,page.geometryRevision])||[]);for(let at=0;at<data.length;at++){const sheet=data[at];if(!sheet.pageId||sheet.loaded===false)continue;this.pageHeads.set(sheet.pageId,{geometryRevision:roots.has(sheet.pageId)?roots.get(sheet.pageId):this.pageHeads.get(sheet.pageId)?.geometryRevision||sheet.geometryRevision||null,signature:updates.get(sheet.pageId)?.signature||this.pageHeads.get(sheet.pageId)?.signature,metadataSignature:semanticMetadata(sheet),strokes:sheet.strokes,backdrop:sheet.backdrop||null,durable:!answer.durabilityWarning,modelBytes:updates.has(sheet.pageId)?updates.get(sheet.pageId).strokeCount*128+updates.get(sheet.pageId).pointCount*80+updates.get(sheet.pageId).backdropBytes*2:this.pageHeads.get(sheet.pageId)?.modelBytes||0});}const openPages=new Set(data.map(sheet=>sheet.pageId).filter(Boolean));for(const id of this.pageHeads.keys())if(!openPages.has(id))this.pageHeads.delete(id);this.persisted=this.identity(data);for(const [value,id]of this.backdropIds)if(!this.knownBackdrops.has(id))this.backdropIds.delete(value);return answer;
  }throw Error('Drawing persistence could not resynchronize. Unsaved drawings remain open.');
 }
 save(data){
  if(this.disposed)return Promise.reject(Error('Drawing persistence is closing.'));const revision=++this.revision;this.latest={data,revision,id:this.id()};const promise=new Promise((resolve,reject)=>this.waiters.push({revision,resolve,reject}));if(!this.running){this.running=true;void Promise.resolve().then(()=>this.pump());}return promise;
 }
 async pump(){
  while(this.latest&&!this.disposed){if(this.eviction)await this.eviction;const current=this.latest;this.latest=null;let answer,error;try{answer=await this.write(current.data,current.id);}catch(value){error=value;}const completed=this.waiters.filter(waiter=>waiter.revision<=current.revision);this.waiters=this.waiters.filter(waiter=>waiter.revision>current.revision);for(const waiter of completed)if(error)waiter.reject(error);else waiter.resolve(answer);}
  this.running=false;
 }
 canUnload(pageId,strokes,backdrop,metadata){const head=this.pageHeads.get(pageId);return !this.running&&!this.latest&&!this.eviction&&!!head?.durable&&head.strokes===strokes&&head.backdrop===backdrop&&metadata!=null&&head.metadataSignature===semanticMetadata(metadata);}
 releasePage(pageId,snapshot,{unload=()=>true}={}){const head=this.pageHeads.get(pageId);if(!head||head.metadataSignature!==semanticMetadata(snapshot))return Promise.resolve(false);this.pageHeads.set(pageId,{geometryRevision:head.geometryRevision,signature:head.signature,metadataSignature:head.metadataSignature,durable:true,modelBytes:head.modelBytes});const priorPersisted=this.persisted?.find(value=>value.pageId===pageId);if(this.persisted)this.persisted=this.persisted.map(value=>value.pageId===pageId?this.identity([snapshot])[0]:value);const run=async()=>{if(await unload()===false){this.pageHeads.set(pageId,head);if(this.persisted)this.persisted=this.persisted.map(value=>value.pageId===pageId?priorPersisted:value);return false;}this.knownStrokes.clear();this.knownBackdrops.clear();this.freshStrokes.clear();this.freshBackdrops.clear();const keepBackgrounds=new Set();let work=0;for(const page of this.pageHeads.values()){if(!page.strokes)continue;for(const stroke of page.strokes){this.knownStrokes.add(this.idOf(stroke));if(++work%8192===0)await yieldTask();}if(page.backdrop){keepBackgrounds.add(page.backdrop);const id=this.backdropIds.get(page.backdrop);if(id)this.knownBackdrops.add(id);}}for(const value of this.backdropIds.keys())if(!keepBackgrounds.has(value))this.backdropIds.delete(value);return true;};const pending=(this.eviction||Promise.resolve()).then(run);this.eviction=pending;return pending.finally(()=>{if(this.eviction===pending)this.eviction=null;});}

 dispose(){this.disposed=true;this.latest=null;for(const waiter of this.waiters)waiter.reject(Error('Drawing persistence is closing.'));this.waiters=[];this.persisted=null;this.pageHeads.clear();this.backdropIds.clear();this.knownStrokes.clear();this.knownBackdrops.clear();this.freshStrokes.clear();this.freshBackdrops.clear();}
}
module.exports={SheetSaveQueue,semanticMetadata};
