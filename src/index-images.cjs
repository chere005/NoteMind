const {randomUUID}=require('node:crypto'),{AsyncResource}=require('node:async_hooks');
const codec=require('./archive-codec.cjs'),{releaseDocumentInputs}=require('./document-continuation.cjs');
const {prepareIndexSources,imageInputs,sameInputs,abort,check}=require('./image-index-source.cjs');
const {waitWorking:acquireImageWorking}=require('./image-index-working.cjs');
const {isMarkedAsUntransferable}=require('node:worker_threads');
const sameValues=(a,b)=>{const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(name=>a[name]?.hash===b[name]?.hash&&a[name]?.text===b[name]?.text)};
const discard=bytes=>{if(ArrayBuffer.isView(bytes)&&!bytes.byteOffset&&bytes.byteLength===bytes.buffer.byteLength&&!isMarkedAsUntransferable?.(bytes.buffer)&&typeof bytes.buffer.transfer==='function')try{bytes.buffer.transfer(0)}catch{}};
// A verified source snapshot needs no document permit/raw lease while OCR runs.
// Each image is one fair scheduling unit; foreground work pauses background jobs.
function createIndexer({store,documentIO,send,storage=codec,tempRoot,maxPending=16,maxSpoolBytes=384*1024*1024,prepare=prepareIndexSources,activityMs=1000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 const scheduler=new AsyncResource('NoteMindImageIndex'),pumpOwned=()=>scheduler.runInAsyncScope(pump);
 const owners=new WeakMap(),legacy={},states=new Set(),queue=[],revisions=new Map();let running=false,active=null,foreground=0,spoolBytes=0,nextRevision=0,closed=false,activityUntil=0,activityTimer=null,engine=null,engineDrop=null,engineTimer=null;
 const reserve=bytes=>{if(spoolBytes+bytes>maxSpoolBytes)throw Error('Image search temporary sources are busy. Try again shortly.');spoolBytes+=bytes;let done=false;return()=>{if(!done){done=true;spoolBytes-=bytes}}};
 const enqueue=state=>{if(!state.queued&&!state.finished){state.queued=true;queue.push(state)}void pumpOwned()};
 const cleanup=job=>job?(job.cleanup ||= (async()=>{await job.work?.catch(()=>{});await job.sources.cleanup()})()):Promise.resolve();
 const stop=state=>{state.cancelled=true;state.prepareController?.abort();state.job?.controller?.abort();enqueue(state)};
 function finish(state,error,value){if(state.finished)return;state.finished=true;states.delete(state);if(state.ownerStates.get(state.id)===state)state.ownerStates.delete(state.id);for(const off of state.listeners)off();state.listeners=[];state.input=null;state.job=null;if(![...states].some(other=>other.id===state.id))revisions.delete(state.id);error?state.reject(error):state.resolve(value);}
 async function finishJob(state,job){
  const values=Object.create(null);for(const row of job.sources.rows)if(row.text!==undefined)Object.defineProperty(values,row.name,{value:{hash:row.hash,text:row.text},enumerable:true,writable:true,configurable:true});
  if(!state.cancelled&&state.job===job&&revisions.get(state.id)===job.revision&&!sameValues(state.stored,values)){const valid=()=>!closed&&!state.cancelled&&state.job===job&&revisions.get(state.id)===job.revision&&(state.owner===legacy||!state.owner.isDestroyed?.()),published=await store.indexText(state.id,values,{valid});if(published!==false&&valid()){state.stored=values;send();}}
  await cleanup(job);if(state.job===job)finish(state,state.cancelled?abort():null,{count:Object.keys(values).length,errors:job.errors});
 }
 async function readImage(state,job,row,phase){
  const signal=job.controller.signal;check(signal);
  let converted;
  try{if(state.owner!==legacy&&!state.owner.isDestroyed?.())state.owner.send?.('notes:index-progress',{id:state.id,name:row.name});converted=await documentIO.convertImageFile(row.source.file,row.type,{...row.source,signal,maxDimension:2400,maxRSSBytes:384*1024*1024,timeoutMs:30000},state.owner===legacy?undefined:state.owner);check(signal);const bytes=converted?.bytes||converted?.data;if(!ArrayBuffer.isView(bytes))throw Error('Image search conversion returned invalid pixels.');await phase?.beforeOCR(bytes.byteLength);check(signal);const value=await documentIO.reader.read(bytes,{id:'index-'+randomUUID(),language:'auto',priority:job.background?'background':'foreground',textOnly:true,signal});check(signal);row.text=value.text;job.byHash.set(row.hash,value.text);state.cached[row.name]={hash:row.hash,text:value.text};job.cursor++;}
  catch(error){if(signal.aborted)throw error;job.errors.push(row.name+': '+error.message);job.cursor++;}
  finally{await documentIO.reader.awaitStopped?.();discard(converted?.bytes||converted?.data);converted=null;await phase?.afterOCR();}
 }
 async function releaseEngine(){clearTimeout(engineTimer);engineTimer=null;if(engineDrop)return engineDrop;const held=engine;if(!held)return;held.stopping=true;engine=null;let nativeStopped=false,leaseEnded=false;const drop=(async()=>{await documentIO.reader.retireIdle?.();await documentIO.reader.awaitStopped?.();nativeStopped=true;held.off();try{await held.working()}finally{try{await held.lease.release();leaseEnded=true;}finally{await storage.releaseRawAssets(held.owner)}}})();engineDrop=drop;try{await drop}catch(error){const backendEnded=Object.hasOwn(storage,'worker')&&(storage.epoch!==held.lease.epoch||!storage.worker&&!storage.stoppingWorker&&!storage.stopping);if(!nativeStopped||!leaseEnded&&!backendEnded)engine=held;throw error}finally{if(engineDrop===drop)engineDrop=null;}}
 async function phasedImage(state,job,row){const signal=job.controller.signal,plan=row.source.workingPlan,owner=randomUUID(),lease=await storage.preflightRawAssets([],{owner});let working,promoted=false,off=()=>{};
  try{return await lease.run(async()=>{if(!engine&&documentIO.reader.idleWorker)await documentIO.reader.retireIdle?.();if(engine?.stopping)await releaseEngine();try{working=await storage.acquireScopedRawWorking(plan.convertBytes,{preserve:true})}catch(error){if(error.code!=='ARCHIVE_RAW_BUSY')throw error;await releaseEngine();working=await acquireImageWorking(storage,signal,plan.convertBytes);}const lost=()=>job.controller.abort();working.signal?.addEventListener('abort',lost,{once:true});off=()=>working.signal?.removeEventListener('abort',lost);if(working.signal?.aborted)lost();check(signal);
   return await readImage(state,job,row,{beforeOCR:async bytes=>{check(signal);if(bytes>plan.maxOutputBytes)throw Error('Image search conversion exceeded its declared pixel workspace.');await working.resize(bytes+plan.ocrBytes+(engine?0:plan.modelBytes),{preserve:true});},afterOCR:async()=>{if(!signal.aborted&&!closed&&!foreground&&now()>=activityUntil&&!engine&&documentIO.reader.idleWorker){await working.resize(plan.modelBytes,{preserve:true});off();const held={owner,lease,working,bytes:plan.modelBytes,off:null},lost=()=>{active?.job.controller?.abort();void releaseEngine().catch(()=>{});};held.off=()=>working.signal?.removeEventListener('abort',lost);engine=held;working.signal?.addEventListener('abort',lost,{once:true});promoted=true;}}});
  });}finally{off();if(!promoted){await documentIO.reader.awaitStopped?.();try{await working?.()}finally{try{await lease.release()}finally{await storage.releaseRawAssets(owner)}}}if(signal.aborted||closed||foreground||now()<activityUntil)await releaseEngine();}
 }
 async function step(state,job){const signal=job.controller.signal;check(signal);let row;
  while(job.cursor<job.sources.rows.length){row=job.sources.rows[job.cursor];if(row.text!==undefined){job.cursor++;continue}if(job.byHash.has(row.hash)){row.text=job.byHash.get(row.hash);job.cursor++;continue}break;}
  if(job.cursor===job.sources.rows.length)return;
  if(!storage.preflightRawAssets||!storage.acquireScopedRawWorking)return readImage(state,job,row);
  if(row.source.workingPlan){clearTimeout(engineTimer);engineTimer=null;return phasedImage(state,job,row);}
  clearTimeout(engineTimer);engineTimer=null;
  if(!engine||engine.stopping||engine.bytes<row.source.workingBytes){await releaseEngine();const owner=randomUUID(),lease=await storage.preflightRawAssets([],{owner});let working;
   try{working=await lease.run(()=>acquireImageWorking(storage,signal,row.source.workingBytes));check(signal);const held={owner,lease,working,bytes:row.source.workingBytes,off:null},lost=()=>{active?.job.controller?.abort();void releaseEngine().catch(()=>{});};held.off=()=>working.signal?.removeEventListener('abort',lost);engine=held;working.signal?.addEventListener('abort',lost,{once:true});if(working.signal?.aborted)lost();}
   catch(error){await working?.();await lease.release();await storage.releaseRawAssets(owner);throw error;}
  }
  const held=engine;try{check(signal);return await held.lease.run(()=>readImage(state,job,row));}
  finally{if(signal.aborted||closed||foreground||now()<activityUntil)await releaseEngine();}
 }
 async function pump(){if(running)return;running=true;let processing;try{while(queue.length){let at=queue.findIndex(state=>closed||state.cancelled);if(at<0&&foreground)break;if(at<0)at=queue.findIndex(state=>!state.job?.background);if(at<0){if(foreground||now()<activityUntil)break;at=0;}const state=processing=queue.splice(at,1)[0];state.queued=false;if(state.finished)continue;if(state.preparing)continue;const job=state.job;if(state.cancelled||closed){await cleanup(job);finish(state,abort());continue;}if(!job)continue;if(job.obsolete){await cleanup(job);continue;}if((foreground||now()<activityUntil)&&job.background){enqueue(state);break;}
   job.controller=new AbortController();active={state,job};job.work=step(state,job);let failure;try{await job.work}catch(error){failure=error}finally{active=null;job.work=null;}
   if(job.obsolete||state.job!==job){await cleanup(job);continue;}if(state.cancelled||closed){await cleanup(job);finish(state,abort());continue;}if(failure&&!job.controller.signal.aborted){await cleanup(job);finish(state,failure);continue;}if(job.cursor>=job.sources.rows.length){await finishJob(state,job);continue;}enqueue(state);
  }}catch(error){if(processing){try{await cleanup(processing.job)}catch(cleanupError){error.indexCleanupError=cleanupError.message}finish(processing,error)}queueMicrotask(()=>void pumpOwned())}finally{running=false;if(engine&&!queue.length&&!active&&!engineTimer){engineTimer=setTimeout(()=>{engineTimer=null;void releaseEngine().catch(()=>{})},documentIO.reader.idleMs??15000);engineTimer.unref?.();}}}
 function attachSignal(state,signal,generation){if(!signal)return;const cancel=()=>{if(state.generation===generation)stop(state)};signal.addEventListener('abort',cancel,{once:true});state.listeners.push(()=>signal.removeEventListener('abort',cancel));if(signal.aborted)cancel();}
 function indexDocument(event,doc,options={}){
  if(closed)return Promise.reject(Error('Image search is closing.'));if(typeof doc?.id!=='string'||!doc.id)return Promise.reject(Error('Image search needs a saved draft identity.'));try{check(options.signal)}catch(error){return Promise.reject(error)}
  const owner=event?.sender||legacy;if(owner!==legacy&&owner.isDestroyed?.())return Promise.reject(abort());let ownerStates=owners.get(owner);if(!ownerStates){owners.set(owner,ownerStates=new Map());owner.once?.('destroyed',()=>{for(const state of ownerStates.values())stop(state)});}
  doc={id:doc.id,assets:{...doc.assets},meta:{attachments:Object.fromEntries(Object.entries(doc.meta?.attachments||{}).filter(([,info])=>info?.text).map(([name,info])=>[name,{text:info.text}]))}};const input=imageInputs(doc),background=!event||options.background===true;let state=ownerStates.get(doc.id);if(state?.cancelled)state=null;
  if(state&&sameInputs(state.input,input)){
   const generation=++state.generation;attachSignal(state,options.signal,generation);if(!background)state.background=false;if(!background&&state.job?.background){state.job.background=false;state.job.controller?.abort();enqueue(state)}
   const released=releaseDocumentInputs();return released?.then?released.then(()=>state.promise):state.promise;
  }
  if(!state){if(states.size>=maxPending)return Promise.reject(Error('Too many image searches are waiting.'));state={id:doc.id,owner,ownerStates,input,sequence:0,generation:0,listeners:[],stored:null,cached:{},job:null,finished:false,cancelled:false,queued:false,preparing:null};state.promise=new Promise((resolve,reject)=>{state.resolve=resolve;state.reject=reject});states.add(state);ownerStates.set(doc.id,state);}
  state.input=input;state.background=background;state.cancelled=false;const sequence=++state.sequence,generation=++state.generation,revision=++nextRevision;revisions.set(doc.id,revision);attachSignal(state,options.signal,generation);const old=state.job;if(old){old.obsolete=true;old.controller?.abort();}const previous=state.preparing,controller=state.prepareController=new AbortController();
  // This async call begins in the initiating document's own raw scope.
  const preparing=(async()=>{if(previous)await previous.catch(()=>{});await cleanup(old);check(controller.signal);if(!state.stored){state.stored=await store.ocrCache(doc.id);Object.assign(state.cached,state.stored);}const sources=await prepare(doc,{storage,cached:state.cached,signal:controller.signal,tempRoot:typeof tempRoot==='function'?tempRoot():tempRoot,reserve});try{check(controller.signal);await releaseDocumentInputs();check(controller.signal);if(state.sequence!==sequence||state.cancelled){await sources.cleanup();return;}state.job={sequence,revision,sources,background:state.background,cursor:0,errors:[],byHash:new Map(),work:null,controller:null};}catch(error){await sources.cleanup();throw error;}})();state.preparing=preparing;
  void preparing.then(()=>{if(state.preparing===preparing){state.preparing=null;enqueue(state)}},async error=>{if(state.sequence===sequence){state.preparing=null;try{await cleanup(state.job)}catch(cleanupError){error.indexCleanupError=cleanupError.message}finish(state,error);}});
  return state.promise;
 }
 indexDocument.activity=()=>{if(closed)return;activityUntil=now()+activityMs;clearTimer(activityTimer);activityTimer=setTimer(()=>{activityTimer=null;void pumpOwned()},activityMs);activityTimer.unref?.();if(active?.job.background){const work=active.job.work;active.job.controller.abort();void Promise.resolve(work).catch(()=>{}).then(()=>releaseEngine()).catch(()=>{});}else if(!active)void releaseEngine().catch(()=>{});};
 indexDocument.foreground=async run=>{indexDocument.activity();foreground++;const job=active?.job||null;job?.controller.abort();try{await job?.work?.catch(()=>{});await releaseEngine();return await run()}finally{foreground--;void pumpOwned()}};
 indexDocument.dispose=async()=>{closed=true;activityUntil=0;clearTimer(activityTimer);for(const state of states)stop(state);await Promise.allSettled([...states].map(state=>state.promise));await releaseEngine();scheduler.emitDestroy();};
 indexDocument.stats=()=>({pending:states.size,queued:queue.length,active:!!active,foreground,spoolBytes,engineWorking:engine?.bytes||0,engineStopping:!!engineDrop||!!engine?.stopping});
 return indexDocument;
}
module.exports={createIndexer};
