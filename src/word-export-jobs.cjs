// Packaging owns no archive descriptors. Its lifetime ends only on actual worker exit.
const {Worker}=require('node:worker_threads'),path=require('node:path'),{randomUUID}=require('node:crypto');
const abort=()=>Object.assign(Error('Word export cancelled.'),{name:'AbortError'});
class WordExportJobs{
 constructor({workerFactory=(file,options)=>new Worker(file,options),maxPending=2,maxBytes=96*1024*1024,timeout=120000}={}){Object.assign(this,{workerFactory,maxPending,maxBytes,timeout});this.jobs=new Set();this.waiters=[];this.bytes=0;this.slot=false;this.disposed=false;}
 acquire(signal){if(signal.aborted)return Promise.reject(abort());if(!this.slot){this.slot=true;return Promise.resolve(this.permit());}return new Promise((resolve,reject)=>{const entry={resolve,reject,signal,stop:null};entry.stop=()=>{const at=this.waiters.indexOf(entry);if(at>=0)this.waiters.splice(at,1);reject(abort());};this.waiters.push(entry);signal.addEventListener('abort',entry.stop,{once:true});});}
 permit(){let released=false;return()=>{if(released)return;released=true;while(this.waiters.length){const entry=this.waiters.shift();entry.signal.removeEventListener('abort',entry.stop);if(entry.signal.aborted){entry.reject(abort());continue;}entry.resolve(this.permit());return;}this.slot=false;};}
 run(doc,images,options,target,{signal,beforeStart,onStarted}={}){
  if(this.disposed)return Promise.reject(Error('Word tools are closing.'));if(signal?.aborted)return Promise.reject(abort());
  if(!doc||typeof doc.text!=='string'||Object.keys(doc.assets||{}).length||!images||typeof images!=='object'||Array.isArray(images)||Object.values(images).some(value=>!value?.source))return Promise.reject(Error('Word packaging requires private media spools.'));
  let packet,bytes;try{bytes=Buffer.byteLength(doc.text)+Buffer.byteLength(JSON.stringify({meta:doc.meta,title:doc.title,images,options,target}));if(Buffer.byteLength(doc.text)>16*1024*1024||bytes>this.maxBytes)throw Error('Word export metadata is too large.');packet=structuredClone({doc,images,options,target:{...target,tempId:target.tempId||randomUUID()}});}catch(error){return Promise.reject(error);}
  if(this.jobs.size>=this.maxPending||this.bytes+bytes>this.maxBytes)return Promise.reject(Error('Word export is busy. The document remains open.'));
  const controller=new AbortController(),stop=()=>controller.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const job={id:randomUUID(),packet,bytes,controller,beforeStart,onStarted,promise:null,worker:null};this.jobs.add(job);this.bytes+=bytes;
  job.promise=Promise.resolve().then(()=>this.execute(job)).finally(()=>{signal?.removeEventListener('abort',stop);this.jobs.delete(job);this.bytes-=bytes;job.packet=null;});return job.promise;
 }
 async execute(job){
  const signal=job.controller.signal,release=await this.acquire(signal);let worker,ownedExit=false;
  try{
   if(this.disposed||signal.aborted)throw abort();await job.beforeStart?.(signal);if(this.disposed||signal.aborted)throw abort();
   const cancel=new Int32Array(new SharedArrayBuffer(4));let value,failure,timer,cancelTimer,settled=false;
   worker=this.workerFactory(path.join(__dirname,'word-export-worker.cjs'),{resourceLimits:{maxOldGenerationSizeMb:128},execArgv:[]});job.worker=worker;
   const completion=new Promise((resolve,reject)=>{
    const stop=()=>{Atomics.store(cancel,0,1);if(!cancelTimer)cancelTimer=setTimeout(()=>{try{void Promise.resolve(worker.terminate()).catch(error=>{failure ||=error;});}catch(error){failure ||=error;}},1000);cancelTimer.unref?.();};
    signal.addEventListener('abort',stop,{once:true});
    const cleanup=()=>{clearTimeout(timer);clearTimeout(cancelTimer);signal.removeEventListener('abort',stop);};
    worker.on('message',packet=>{if(packet?.id!==job.id||settled)return;if(packet.error)failure=Object.assign(Error(packet.error.message),packet.error);else value=packet.value;});
    worker.on('error',error=>{failure ||=error;});
    worker.once('exit',code=>{ownedExit=true;settled=true;cleanup();if(value?.committed){if(code||failure)(value.warnings||=[]).push('The Word document was saved, but its packaging worker could not finish cleanly.');resolve(value);}else if(failure)reject(failure);else if(signal.aborted)reject(abort());else if(code||!value)reject(Error('Word packaging worker stopped before returning a receipt.'));else resolve(value);});
    timer=setTimeout(()=>{failure ||=Error('Word export timed out.');job.controller.abort();},this.timeout);timer.unref?.();
    if(signal.aborted)stop();
    try{worker.postMessage({id:job.id,...job.packet,cancel:cancel.buffer});job.onStarted?.();}catch(error){failure ||=error;Atomics.store(cancel,0,1);try{void Promise.resolve(worker.terminate()).catch(error=>{failure ||=error;});}catch(error){failure ||=error;}}
   });
   try{return await completion;}catch(error){if(ownedExit&&typeof job.packet.target.file==='string')try{await require('./word-temp.cjs').cleanupOwnedWordTemp(job.packet.target.file,job.packet.target.tempId);}catch(cleanup){error.wordCleanupError=cleanup.message;}throw error;}
  }finally{if(!worker||ownedExit)release();}
 }
 async dispose(){this.disposed=true;for(const job of this.jobs)job.controller.abort();await Promise.allSettled([...this.jobs].map(job=>job.promise));}
}
const jobs=new WordExportJobs();
module.exports={WordExportJobs,jobs};
