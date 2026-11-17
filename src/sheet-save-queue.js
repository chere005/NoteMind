// Renderer-side immutable identities keep unchanged geometry and image bytes out of autosave IPC.
class SheetSaveQueue{
 constructor(api,{id=()=>globalThis.crypto.randomUUID()}={}){this.api=api;this.id=id;this.strokeIds=new WeakMap();this.backdropIds=new Map();this.nextStroke=1;this.nextBackdrop=1;this.knownStrokes=new Set();this.knownBackdrops=new Set();this.session=null;this.version=0;this.full=true;this.latest=null;this.waiters=[];this.running=false;this.revision=0;this.disposed=false;this.persisted=null;}
 identity(data){return data.map(sheet=>{const {strokes,backdrop,...metadata}=sheet;return {strokes,backdrop:backdrop||null,metadata:JSON.stringify(metadata)};});}
 sameIdentity(a,b){return !!a&&a.length===b.length&&a.every((sheet,index)=>sheet.strokes===b[index].strokes&&sheet.backdrop===b[index].backdrop&&sheet.metadata===b[index].metadata);}
 seed(state){
  if(!state||typeof state.session!=='string'||!Number.isSafeInteger(state.version)||state.version<0)throw Error('Invalid drawing persistence session.');
  const sheets=state.sheets||[];if(!Array.isArray(sheets)||!Array.isArray(state.strokeIds)||state.strokeIds.length!==sheets.length||!Array.isArray(state.backdropIds)||state.backdropIds.length!==sheets.length)throw Error('Invalid drawing persistence identities.');
  const seenStrokes=new Set(),seenBackdrops=new Set();
  sheets.forEach((sheet,index)=>{const ids=state.strokeIds[index];if(!Array.isArray(ids)||ids.length!==sheet.strokes.length)throw Error('Invalid drawing stroke identities.');sheet.strokes.forEach((stroke,at)=>{const value=ids[at];if(!Number.isSafeInteger(value)||value<=0)throw Error('Invalid drawing stroke identity.');this.strokeIds.set(stroke,value);seenStrokes.add(value);this.nextStroke=Math.max(this.nextStroke,value+1);});const backdrop=state.backdropIds[index];if(sheet.backdrop){if(!Number.isSafeInteger(backdrop)||backdrop<=0)throw Error('Invalid drawing background identity.');this.backdropIds.set(sheet.backdrop,backdrop);seenBackdrops.add(backdrop);this.nextBackdrop=Math.max(this.nextBackdrop,backdrop+1);}});
  this.session=state.session;this.version=state.version;this.knownStrokes=seenStrokes;this.knownBackdrops=seenBackdrops;this.full=false;this.persisted=state.sheets?this.identity(state.sheets):null;return state.sheets;
 }
 build(data,requestId){
  if(!Array.isArray(data)||!data.length)throw Error('Invalid drawing sheets.');
  if(!this.session)return {payload:{requestId,session:null,baseVersion:0},usedStrokes:new Set(),usedBackdrops:new Set()};
  if(!this.full&&this.sameIdentity(this.persisted,this.identity(data)))return {payload:{requestId,session:this.session,baseVersion:this.version,unchanged:true},usedStrokes:this.knownStrokes,usedBackdrops:this.knownBackdrops};
  if(!Array.isArray(data)||!data.length)throw Error('Invalid drawing sheets.');const addStrokes=[],addBackdrops=[],usedStrokes=new Set(),usedBackdrops=new Set();
  const sheets=data.map(sheet=>{const {strokes,backdrop,...metadata}=sheet;if(!Array.isArray(strokes))throw Error('Invalid drawing strokes.');const strokeIds=strokes.map(stroke=>{let value=this.strokeIds.get(stroke);if(!value){value=this.nextStroke++;this.strokeIds.set(stroke,value);}if(!usedStrokes.has(value)&&!this.knownStrokes.has(value))addStrokes.push({id:value,stroke});usedStrokes.add(value);return value;});let backdropId=0;if(backdrop){backdropId=this.backdropIds.get(backdrop);if(!backdropId){backdropId=this.nextBackdrop++;this.backdropIds.set(backdrop,backdropId);}if(!usedBackdrops.has(backdropId)&&!this.knownBackdrops.has(backdropId))addBackdrops.push({id:backdropId,data:backdrop});usedBackdrops.add(backdropId);}return {metadata,strokeIds,backdropId};});
  return {payload:{requestId,session:this.session,baseVersion:this.version,full:this.full,sheets,addStrokes,addBackdrops},usedStrokes,usedBackdrops};
 }
 reset(answer={}){this.session=typeof answer.session==='string'?answer.session:null;this.version=Number.isSafeInteger(answer.version)?answer.version:0;this.knownStrokes.clear();this.knownBackdrops.clear();this.full=true;}
 async write(data,requestId){
  let activeRequestId=requestId;
  for(let attempt=0;attempt<6;attempt++){
   const built=this.build(data,activeRequestId);let answer;
   try{answer=await this.api.saveSheetsDelta(built.payload);}catch(error){if(attempt<5&&/worker stopped|worker.*exited|timed out/i.test(error.message)){this.reset();continue;}throw error;}
   if(answer?.resync){this.reset(answer);continue;}
   if(answer?.idempotent){if(answer.currentVersion!==answer.version){this.reset({session:answer.session,version:answer.currentVersion});activeRequestId=this.id();continue;}if(!built.payload.session){this.reset({session:answer.session,version:answer.version});continue;}}
   const replayed=answer?.idempotent&&answer.version===this.version;
   if(!answer||answer.session!==this.session||answer.requestId!==activeRequestId||!Number.isSafeInteger(answer.version)||answer.version!==this.version+(built.payload.unchanged||replayed?0:1)||!!answer.unchanged!==!!built.payload.unchanged)throw Error('Invalid drawing save acknowledgement.');
   this.version=answer.version;this.full=false;this.knownStrokes=built.usedStrokes;this.knownBackdrops=built.usedBackdrops;this.persisted=this.identity(data);for(const [data,id]of this.backdropIds)if(!this.knownBackdrops.has(id))this.backdropIds.delete(data);return answer;
  }throw Error('Drawing persistence could not resynchronize. Unsaved drawings remain open.');
 }
 save(data){
  if(this.disposed)return Promise.reject(Error('Drawing persistence is closing.'));const revision=++this.revision;this.latest={data,revision,id:this.id()};const promise=new Promise((resolve,reject)=>this.waiters.push({revision,resolve,reject}));if(!this.running){this.running=true;void Promise.resolve().then(()=>this.pump());}return promise;
 }
 async pump(){
  while(this.latest&&!this.disposed){const current=this.latest;this.latest=null;let answer,error;try{answer=await this.write(current.data,current.id);}catch(value){error=value;}const completed=this.waiters.filter(waiter=>waiter.revision<=current.revision);this.waiters=this.waiters.filter(waiter=>waiter.revision>current.revision);for(const waiter of completed)if(error)waiter.reject(error);else waiter.resolve(answer);}
  this.running=false;
 }
 dispose(){this.disposed=true;this.latest=null;for(const waiter of this.waiters)waiter.reject(Error('Drawing persistence is closing.'));this.waiters=[];}
}
module.exports={SheetSaveQueue};
