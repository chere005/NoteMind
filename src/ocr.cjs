const {Worker}=require('node:worker_threads');
const {existsSync}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const folder=path.join(__dirname,'helpers','text-ocr');
const files=['worker.mjs','ort/ort-wasm-simd-threaded.mjs','ort/ort-wasm-simd-threaded.wasm','models/ch_PP-OCRv5_det_mobile.onnx','models/en_PP-OCRv5_rec_mobile.onnx','models/ch_PP-OCRv5_rec_mobile.onnx'];
const available=()=>files.every(f=>existsSync(path.join(folder,f)));
const aborted=()=>Object.assign(Error('Reading cancelled.'),{name:'AbortError'});
function readingOrder(lines){const rows=[];for(const line of [...lines].sort((a,b)=>a.y-b.y||a.x-b.x)){const cy=line.y+line.height/2;const row=rows.find(r=>Math.abs(r.cy-cy)<Math.max(r.height,line.height)*.45);if(row){row.lines.push(line);row.height=Math.max(row.height,line.height)}else rows.push({cy,height:line.height,lines:[line]});}return rows.sort((a,b)=>a.cy-b.cy).map(r=>r.lines.sort((a,b)=>a.x-b.x).map(l=>l.text).join(' ')).join('\n');}
class TextReader {
 constructor({workerFactory=(file,options)=>new Worker(file,options),threads=Math.max(1,Math.min(2,require('node:os').availableParallelism()-1)),maxPending=64,maxBytes=128*1024*1024,idleMs=15000}={}){
  this.queue=[];this.workers=new Set();this.jobs=new Map();this.cache=new Map();this.next=0;this.wireSequence=0;this.bytes=0;this.workerFactory=workerFactory;this.threads=Math.max(1,Math.min(2,threads));this.maxPending=maxPending;this.maxBytes=maxBytes;this.idleMs=Math.max(0,idleMs);this.records=new Map();this.idleWorker=null;this.idleTimer=null;this.idleGeneration=0;this.stopFailure=null;
 }
 read(bytes,{id=String(++this.next),language='auto',signal,priority='foreground',onProgress=()=>{}}={}){
  if(this.disposed)return Promise.reject(Error('The text reader is closing.'));
  if(this.stopFailure)return Promise.reject(Error('The text reader is still stopping.'));
  if(signal?.aborted)return Promise.reject(aborted());
  if(!available())return Promise.reject(Error('The text reader files are missing.'));
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
  if(bytes.length>40*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return Promise.reject(Error('The text reader needs a PNG image of up to 40 MB.'));
  const key=createHash('sha256').update(bytes).update(language).digest('hex');
  if(this.cache.has(key))return Promise.resolve(structuredClone(this.cache.get(key)));
  if(this.jobs.has(id))return Promise.reject(Error('This reading is already running.'));
  const background=priority==='background',jobLimit=background?Math.max(1,this.maxPending-1):this.maxPending,byteLimit=background?this.maxBytes-Math.min(40*1024*1024,this.maxBytes/2):this.maxBytes;
  if(this.jobs.size>=jobLimit||this.bytes+bytes.length>byteLimit)return Promise.reject(Error('Too many images are waiting for text recognition. Try again after the current readings finish.'));
  return new Promise((resolve,reject)=>{const job={id,bytes,key,language,priority:priority==='background'?'background':'foreground',onProgress,resolve,reject,worker:null};this.jobs.set(id,job);this.bytes+=bytes.length;this.queue.push(job);this.progress(job,'Queued');if(signal){job.abort=()=>this.cancel(id);signal.addEventListener('abort',job.abort,{once:true});job.cleanup=()=>signal.removeEventListener('abort',job.abort);if(signal.aborted){this.cancel(id);return;}}if(job.priority==='foreground')this.preemptBackground();this.pump();});
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
  if(!this.jobs.has(job.id))return;this.jobs.delete(job.id);this.bytes-=job.bytes.length;job.bytes=null;job.cleanup?.();clearTimeout(job.timer);const worker=job.worker;job.worker=null;const record=worker&&this.records.get(worker);if(record)record.job=null;
  let value;
  if(!error)try{if(!Array.isArray(result?.lines))throw Error('The text reader returned an invalid result.');value={text:readingOrder(result.lines),lines:result.lines,language:job.language,timing:result.timing};this.cache.set(job.key,value);if(this.cache.size>32)this.cache.delete(this.cache.keys().next().value);}catch(failure){error=failure;}
  if(worker){if(error)this.release(worker);else this.park(worker);}
  if(error)job.reject(error);else job.resolve(structuredClone(value));this.pump();
 }
 pump(){
  if(this.disposed||this.stopFailure||(this.workers.size&&!this.idleWorker)||!this.queue.length)return;
  const next=this.queue.findIndex(job=>job.priority==='foreground'),job=this.queue.splice(next<0?0:next,1)[0];if(!this.jobs.has(job.id)){this.pump();return;}
  let worker=this.idleWorker;if(worker){this.idleWorker=null;this.clearIdleTimer();}
  else try{worker=this.workerFactory(path.join(folder,'worker.mjs'),{workerData:{folder,threads:this.threads}});this.attach(worker);}catch(error){this.complete(job,error);return;}
  job.worker=worker;job.wireId=++this.wireSequence;this.records.get(worker).job=job;this.progress(job,'Reading text');
  job.timer=setTimeout(()=>{if(job.worker===worker)this.complete(job,Error('Text reading timed out. Try a smaller image.'));},120000);
  try{worker.postMessage({id:job.wireId,requestId:job.id,bytes:job.bytes,japanese:job.language!=='en'});}catch(error){this.complete(job,error);}
 }
 cancel(id){const job=this.jobs.get(id);if(!job)return;this.queue=this.queue.filter(value=>value!==job);this.complete(job,aborted());}
 awaitStopped(){return Promise.all([...this.records.values()].filter(record=>record.stopping).map(record=>record.exitPromise)).then(()=>{});}
 dispose(){if(this.disposing)return this.disposing;this.disposed=true;this.clearIdleTimer();for(const id of [...this.jobs.keys()])this.cancel(id);if(this.idleWorker)this.release(this.idleWorker);return this.disposing=this.awaitStopped();}
}
module.exports={TextReader,available};
