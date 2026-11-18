const {Worker}=require('node:worker_threads');
const {existsSync}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const folder=path.join(__dirname,'helpers','text-ocr');
const files=['worker.mjs','ort/ort-wasm-simd-threaded.mjs','ort/ort-wasm-simd-threaded.wasm','models/ch_PP-OCRv5_det_mobile.onnx','models/en_PP-OCRv5_rec_mobile.onnx','models/ch_PP-OCRv5_rec_mobile.onnx'];
const available=()=>files.every(f=>existsSync(path.join(folder,f)));
const aborted=()=>Object.assign(Error('Reading cancelled.'),{name:'AbortError'});

class TextReader {
 constructor({workerFactory=(file,options)=>new Worker(file,options),threads=Math.max(1,Math.min(2,require('node:os').availableParallelism()-1)),maxPending=64,maxBytes=128*1024*1024,idleMs=15000,maxCacheBytes=8*1024*1024}={}){
  if(!Number.isSafeInteger(maxCacheBytes)||maxCacheBytes<0)throw Error('Invalid OCR cache budget.');this.formats=new Set();this.maxCacheBytes=maxCacheBytes;this.cacheBytes=0;this.cachePending=null;this.cacheCounting=false;this.queue=[];this.workers=new Set();this.jobs=new Map();this.cache=new Map();this.next=0;this.wireSequence=0;this.bytes=0;this.workerFactory=workerFactory;this.threads=Math.max(1,Math.min(2,threads));this.maxPending=maxPending;this.maxBytes=maxBytes;this.idleMs=Math.max(0,idleMs);this.records=new Map();this.idleWorker=null;this.idleTimer=null;this.idleGeneration=0;this.stopFailure=null;
 }
 read(bytes,{id=String(++this.next),language='auto',signal,priority='foreground',textOnly=false,onProgress=()=>{}}={}){
  if(this.disposed)return Promise.reject(Error('The text reader is closing.'));
  if(this.stopFailure)return Promise.reject(Error('The text reader is still stopping.'));
  if(signal?.aborted)return Promise.reject(aborted());
  if(!available())return Promise.reject(Error('The text reader files are missing.'));
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
  if(bytes.length>40*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return Promise.reject(Error('The text reader needs a PNG image of up to 40 MB.'));
  const key=createHash('sha256').update(bytes).update(language).digest('hex');
  if(this.cache.has(key))return Promise.resolve(this.publicResult(this.cache.get(key).value,textOnly));
  if(this.jobs.has(id))return Promise.reject(Error('This reading is already running.'));
  const background=priority==='background',jobLimit=background?Math.max(1,this.maxPending-1):this.maxPending,byteLimit=background?this.maxBytes-Math.min(40*1024*1024,this.maxBytes/2):this.maxBytes;
  if(this.jobs.size>=jobLimit||this.bytes+bytes.length>byteLimit)return Promise.reject(Error('Too many images are waiting for text recognition. Try again after the current readings finish.'));
  return new Promise((resolve,reject)=>{const job={id,bytes,key,language,priority:priority==='background'?'background':'foreground',textOnly,onProgress,resolve,reject,worker:null};this.jobs.set(id,job);this.bytes+=bytes.length;this.queue.push(job);this.progress(job,'Queued');if(signal){job.abort=()=>this.cancel(id);signal.addEventListener('abort',job.abort,{once:true});job.cleanup=()=>signal.removeEventListener('abort',job.abort);if(signal.aborted){this.cancel(id);return;}}if(job.priority==='foreground')this.preemptBackground();this.pump();});
 }
 progress(job,phase){try{job.onProgress(phase);}catch{}}
 clearIdleTimer(){this.idleGeneration++;clearTimeout(this.idleTimer);this.idleTimer=null;}
 retire(worker){
  const record=this.records.get(worker);if(!record||!record.exited&&worker.threadId!==-1)return;
  if(this.idleWorker===worker){this.idleWorker=null;this.clearIdleTimer();}
  if(this.stopFailure?.worker===worker)this.stopFailure=null;
  worker.removeListener('message',record.message);worker.removeListener('error',record.error);worker.removeListener('exit',record.exit);this.records.delete(worker);this.workers.delete(worker);record.resolveExit();this.pump();
 }
 release(worker){
  const record=this.records.get(worker);if(!record||record.stopping)return;record.stopping=true;record.job=null;
  if(this.idleWorker===worker){this.idleWorker=null;this.clearIdleTimer();}
  const failed=error=>{
   if(!this.records.has(worker))return;
   if(worker.threadId===-1){this.retire(worker);return;}
   // Do not launch a second model engine until termination or exit is confirmed.
   this.stopFailure={worker,error};for(const job of [...this.jobs.values()])if(!job.worker)this.complete(job,Error('The text reader could not stop its previous reading.'));
  };
  try{Promise.resolve(worker.terminate()).then(()=>{if(worker.threadId===-1)this.retire(worker)},failed);}catch(error){failed(error);}
 }
 attach(worker){
  let resolveExit;const record={job:null,stopping:false,exited:false,exitPromise:new Promise(resolve=>resolveExit=resolve),resolveExit};this.records.set(worker,record);this.workers.add(worker);
  record.message=result=>{const job=record.job;if(job&&job.worker===worker&&result?.id===job.wireId)this.complete(job,result.error?Error(result.error):null,result);};
  record.error=error=>{const job=record.job;if(job&&job.worker===worker)this.complete(job,error);else this.release(worker);};
  record.exit=code=>{record.exited=true;const job=record.job;if(job&&job.worker===worker)this.complete(job,Error('Text reader stopped ('+code+').'));this.retire(worker);};
  worker.on('message',record.message);worker.once('error',record.error);worker.once('exit',record.exit);
 }
 park(worker){
  if(this.disposed||!this.idleMs){this.release(worker);return;}
  this.idleWorker=worker;this.clearIdleTimer();const generation=this.idleGeneration;
  this.idleTimer=setTimeout(()=>{if(this.idleWorker===worker&&generation===this.idleGeneration)this.release(worker);},this.idleMs);this.idleTimer.unref?.();
 }
 preemptBackground(){for(const job of this.jobs.values())if(job.worker&&job.priority==='background'){const worker=job.worker;job.worker=null;clearTimeout(job.timer);this.queue.push(job);this.progress(job,'Queued');this.release(worker);}}
 complete(job,error,result){
  if(this.jobs.get(job.id)!==job)return;if(error){job.formatController?.abort();return this.finish(job,error);}
  if(job.formatting)return;if(!Array.isArray(result?.lines))return this.finish(job,Error('The text reader returned an invalid result.'));
  job.formatting=true;const controller=job.formatController=new AbortController(),pending=require('./ocr-reading-order.cjs').readingOrder(result.lines,{signal:controller.signal});this.formats.add(pending);
  void pending.then(text=>{this.formats.delete(pending);if(this.jobs.get(job.id)===job)this.finish(job,null,{...result,text});else this.pump();},failure=>{this.formats.delete(pending);if(this.jobs.get(job.id)===job)this.finish(job,failure);else this.pump();});
 }
 finish(job,error,result){
  if(this.jobs.get(job.id)!==job)return;this.jobs.delete(job.id);this.bytes-=job.bytes.length;job.bytes=null;job.cleanup?.();clearTimeout(job.timer);const worker=job.worker;job.worker=null;const record=worker&&this.records.get(worker);if(record)record.job=null;
  let value;if(!error)try{value={text:result.text,lines:result.lines,language:job.language,timing:result.timing};this.rememberResult(job.key,value);}catch(failure){error=failure;}
  if(worker){if(error)this.release(worker);else this.park(worker);}
  if(error)job.reject(error);else job.resolve(this.publicResult(value,job.textOnly));this.pump();
 }

 publicResult(value,textOnly){return textOnly?{text:value.text,language:value.language,timing:structuredClone(value.timing)}:structuredClone(value);}
 rememberResult(key,value){if(this.disposed||this.cacheCounting)return;const admit=bytes=>{if(this.disposed||!Number.isFinite(bytes)||bytes>this.maxCacheBytes)return;const prior=this.cache.get(key);if(prior){this.cache.delete(key);this.cacheBytes-=prior.bytes;}while(this.cache.size&&(this.cache.size>=32||this.cacheBytes+bytes>this.maxCacheBytes)){const first=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}this.cache.set(key,{value,bytes});this.cacheBytes+=bytes;},bytes=require('./ocr-cache-bytes.cjs').resultBytes(value,this.maxCacheBytes,{cancelled:()=>this.disposed});if(bytes?.then){this.cacheCounting=true;const pending=bytes.then(admit).finally(()=>{this.cacheCounting=false;if(this.cachePending===pending)this.cachePending=null;});this.cachePending=pending;}else admit(bytes);}
 pump(){
  if(this.disposed||this.stopFailure||this.formats.size||(this.workers.size&&!this.idleWorker)||!this.queue.length)return;
  const next=this.queue.findIndex(job=>job.priority==='foreground'),job=this.queue.splice(next<0?0:next,1)[0];if(this.jobs.get(job.id)!==job){this.pump();return;}
  let worker=this.idleWorker;if(worker){this.idleWorker=null;this.clearIdleTimer();}
  else try{worker=this.workerFactory(path.join(folder,'worker.mjs'),{workerData:{folder,threads:this.threads}});this.attach(worker);}catch(error){this.complete(job,error);return;}
  job.worker=worker;job.wireId=++this.wireSequence;this.records.get(worker).job=job;this.progress(job,'Reading text');
  job.timer=setTimeout(()=>{if(job.worker===worker)this.complete(job,Error('Text reading timed out. Try a smaller image.'));},120000);
  try{worker.postMessage({id:job.wireId,requestId:job.id,bytes:job.bytes,japanese:job.language!=='en'});}catch(error){this.complete(job,error);}
 }
 cancel(id){const job=this.jobs.get(id);if(!job)return;this.queue=this.queue.filter(value=>value!==job);this.complete(job,aborted());}
 retireIdle(){if(this.idleWorker)this.release(this.idleWorker);return this.awaitStopped();}
 awaitStopped(){return Promise.allSettled([...this.records.values()].filter(record=>record.stopping).map(record=>record.exitPromise).concat([...this.formats])).then(()=>{});}
 dispose(){if(this.disposing)return this.disposing;this.disposed=true;this.cache.clear();this.cacheBytes=0;this.clearIdleTimer();for(const id of [...this.jobs.keys()])this.cancel(id);if(this.idleWorker)this.release(this.idleWorker);return this.disposing=Promise.allSettled([this.awaitStopped(),this.cachePending]).then(()=>{});}
}
module.exports={TextReader,available};
