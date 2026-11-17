// Packaging owns no archive descriptors. Its lifetime ends only on actual worker exit.
const {Worker}=require('node:worker_threads'),path=require('node:path'),{randomUUID}=require('node:crypto');
const abort=()=>Object.assign(Error('Word export cancelled.'),{name:'AbortError'});
class WordExportJobs{
 constructor({workerFactory=(file,options)=>new Worker(file,options),publish=(...args)=>require('./word-temp.cjs').publishOwnedWordTemp(...args),maxPending=2,maxBytes=96*1024*1024,timeout=120000}={}){Object.assign(this,{workerFactory,publish,maxPending,maxBytes,timeout});this.jobs=new Set();this.waiters=[];this.bytes=0;this.slot=false;this.disposed=false;}
 acquire(signal){if(signal.aborted)return Promise.reject(abort());if(!this.slot){this.slot=true;return Promise.resolve(this.permit());}return new Promise((resolve,reject)=>{const entry={resolve,reject,signal,stop:null};entry.stop=()=>{const at=this.waiters.indexOf(entry);if(at>=0)this.waiters.splice(at,1);reject(abort());};this.waiters.push(entry);signal.addEventListener('abort',entry.stop,{once:true});});}
 permit(){let released=false;return()=>{if(released)return;released=true;while(this.waiters.length){const entry=this.waiters.shift();entry.signal.removeEventListener('abort',entry.stop);if(entry.signal.aborted){entry.reject(abort());continue;}entry.resolve(this.permit());return;}this.slot=false;};}
 run(doc,images,options,target,{signal,beforeStart,onStarted}={}){
  if(this.disposed)return Promise.reject(Error('Word tools are closing.'));if(signal?.aborted)return Promise.reject(abort());
  if(!doc||typeof doc.text!=='string'||Object.keys(doc.assets||{}).length||!images||typeof images!=='object'||Array.isArray(images)||Object.values(images).some(value=>!value?.source))return Promise.reject(Error('Word packaging requires private media spools.'));
  let packet,bytes;try{const boundedDoc={text:doc.text,title:doc.title,assets:{},meta:doc.meta};bytes=Buffer.byteLength(boundedDoc.text)+Buffer.byteLength(JSON.stringify({meta:boundedDoc.meta,title:boundedDoc.title,images,options,target}));if(Buffer.byteLength(boundedDoc.text)>16*1024*1024||bytes>this.maxBytes)throw Error('Word export metadata is too large.');packet=structuredClone({doc:boundedDoc,images,options,target:{...target,tempId:target.tempId||randomUUID()}});}catch(error){return Promise.reject(error);}
  if(this.jobs.size>=this.maxPending||this.bytes+bytes>this.maxBytes)return Promise.reject(Error('Word export is busy. The document remains open.'));
  const controller=new AbortController(),stop=()=>controller.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const job={id:randomUUID(),packet,bytes,controller,beforeStart,onStarted,promise:null,worker:null};this.jobs.add(job);this.bytes+=bytes;
  job.promise=Promise.resolve().then(()=>this.execute(job)).finally(()=>{signal?.removeEventListener('abort',stop);this.jobs.delete(job);this.bytes-=bytes;job.packet=null;});return job.promise;
 }
 async execute(job){
  const signal=job.controller.signal,release=await this.acquire(signal);let worker,ownedExit=false;
  try{
   if(this.disposed||signal.aborted)throw abort();await job.beforeStart?.(signal);if(this.disposed||signal.aborted)throw abort();
   const cancel=new Int32Array(new SharedArrayBuffer(4));let value,published,publication,failure,timer,cancelTimer,settled=false;
   worker=this.workerFactory(path.join(__dirname,'word-export-worker.cjs'),{execArgv:[]});job.worker=worker;
   const completion=new Promise((resolve,reject)=>{
    const stop=()=>{Atomics.store(cancel,0,1);if(!cancelTimer)cancelTimer=setTimeout(()=>{try{void Promise.resolve(worker.terminate()).catch(error=>{failure ||=error;});}catch(error){failure ||=error;}},1000);cancelTimer.unref?.();};
    signal.addEventListener('abort',stop,{once:true});
    const cleanup=()=>{clearTimeout(timer);clearTimeout(cancelTimer);signal.removeEventListener('abort',stop);};
    worker.on('message',packet=>{if(packet?.id!==job.id||settled)return;if(packet.prepared){if(publication)return;const reply=packet=>{if(settled)return;try{worker.postMessage({id:job.id,publication:true,...packet});}catch(error){failure ||=error;}};publication=Promise.resolve().then(()=>this.publish(job.packet.target.file,job.packet.target.tempId,packet.prepared,{expected:job.packet.target.expected,signal,syncRoot:packet.prepared.syncRoot,onCommit:receipt=>published=receipt})).then(receipt=>{published=receipt;reply({value:receipt});},error=>{failure ||=error;reply({error:{name:error.name,message:error.message}});});}else if(packet.error)failure=Object.assign(Error(packet.error.message),packet.error);else value=packet.value;});
    worker.on('error',error=>{failure ||=error;});
    worker.once('exit',async code=>{ownedExit=true;settled=true;clearTimeout(cancelTimer);signal.removeEventListener('abort',stop);try{await publication;try{await require('./word-temp.cjs').cleanupOwnedWordTemp(job.packet.target.file,job.packet.target.tempId);}catch(error){if(published)(published.warnings||=[]).push('The Word document was saved, but temporary-file cleanup could not be confirmed: '+error.message);else{failure ||=error;failure.wordCleanupError=error.message;}}if(published?.committed){if(value?.warnings?.length)(published.warnings||=[]).push(...value.warnings.filter(warning=>!published.warnings?.includes(warning)));if(code||failure||!value?.committed)(published.warnings||=[]).push('The Word document was saved, but its packaging worker could not finish cleanly.');resolve(published);}else if(failure)reject(failure);else if(signal.aborted)reject(abort());else reject(Error('Word packaging worker stopped before Main published its output.'));}catch(error){reject(error);}finally{cleanup();}});
    timer=setTimeout(()=>{failure ||=Error('Word export timed out.');job.controller.abort();},this.timeout);timer.unref?.();
    if(signal.aborted)stop();
    try{worker.postMessage({id:job.id,...job.packet,cancel:cancel.buffer});job.onStarted?.();}catch(error){failure ||=error;Atomics.store(cancel,0,1);try{void Promise.resolve(worker.terminate()).catch(error=>{failure ||=error;});}catch(error){failure ||=error;}}
   });
   return await completion;
  }finally{if(!worker||ownedExit)release();}
 }
 async dispose(){this.disposed=true;for(const job of this.jobs)job.controller.abort();await Promise.allSettled([...this.jobs].map(job=>job.promise));}
}
const jobs=new WordExportJobs();
const quitHooks=new WeakSet();
function installWordShutdown(app,{pool=jobs,operations=require('./word-export-operations.cjs').operations}={}){
 if(!app||typeof app.on!=='function'||quitHooks.has(app))return;quitHooks.add(app);let waiting=null;
 app.on('will-quit',event=>{
  if(!pool.jobs.size&&!operations.active.size)return;
  event?.preventDefault?.();if(waiting)return;
  waiting=Promise.allSettled([operations.dispose(),pool.dispose()]);
  void waiting.then(()=>app.quit()).catch(error=>console.error(error));
 });
}
module.exports={WordExportJobs,jobs,installWordShutdown};
