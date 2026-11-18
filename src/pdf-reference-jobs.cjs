const {Worker}=require('node:worker_threads'),path=require('node:path'),{randomUUID}=require('node:crypto'),{PDFExportLeases}=require('./pdf-export-leases.cjs');
// One file/export worker; references and OCR never serialize behind a PDF export on the UI thread.
class PDFReferenceJobs {
 constructor(root,{workerFactory=(file,options)=>new Worker(file,options),idleMs=15000,timeoutMs=120000,maxBytes=384*1024*1024,maxPending=8}={}){Object.assign(this,{root,workerFactory,idleMs,timeoutMs,maxBytes,maxPending});this.worker=null;this.active=null;this.queue=[];this.bytes=0;this.next=0;this.stopping=null;this.closed=false;this.failed=null;this.exportLeases=new Map();this.workerOwners=new WeakMap();this.cleanupPending=new Set();}
 call(operation,args={}, {signal,onProgress}={}){
  if(!this.closed&&this.stopping?.error)this.retireWorker(this.stopping.worker);
  if(this.closed||this.failed)return Promise.reject(this.failed||Error('PDF files are closing.'));if(signal?.aborted)return Promise.reject(Object.assign(Error('PDF operation cancelled.'),{name:'AbortError'}));
  let bytes=0;const seen=new Set(),pending=[args];while(pending.length){const value=pending.pop();if(typeof value==='string')bytes+=Buffer.byteLength(value,'utf8');else if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer)bytes+=value.byteLength;else if(value&&typeof value==='object'){if(seen.has(value))continue;seen.add(value);bytes+=64;for(const [key,item]of Object.entries(value)){bytes+=key.length*2;pending.push(item);}}else bytes+=8;if(bytes>this.maxBytes)break;}if(this.bytes+bytes>this.maxBytes||this.queue.length+(this.active?1:0)>=this.maxPending)return Promise.reject(Error('PDF file work is busy.'));
  let copied;try{copied=structuredClone(args);}catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{const job={id:++this.next,operation,args:copied,leaseId:operation==='releaseExport'?copied.id:null,bytes,resolve,reject,signal,progress:onProgress,abort:null};job.abort=()=>{const at=this.queue.indexOf(job);if(at>=0){this.queue.splice(at,1);this.finishQueued(job,Object.assign(Error('PDF operation cancelled.'),{name:'AbortError'}));}else if(this.active===job){this.worker?.postMessage({cancel:job.id});}};signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.bytes+=bytes;this.pump();});
 }
 createWorker(){
  if(this.worker)return this.worker;const owner=randomUUID(),worker=this.workerFactory(path.join(__dirname,'pdf-reference-jobs-worker.cjs'),{workerData:{root:this.root,leaseOwner:owner}}),ownership={owner,cleanup:null,exited:false,exit:null,resolveExit:null};ownership.exit=new Promise(resolve=>ownership.resolveExit=resolve);this.workerOwners.set(worker,ownership);this.worker=worker;
  worker.on('message',packet=>{const job=this.active;if(this.worker!==worker||!job||packet?.id!==job.id)return;if(packet.progress){try{job.progress?.(packet.progress);}catch{}return;}const error=packet.error?Object.assign(Error(packet.error.message),{name:packet.error.name,code:packet.error.code,recovery:packet.error.recovery}):null;if(!error){if(job.operation==='captureExport'&&packet.value?.id)this.exportLeases.set(packet.value.id,worker);if(job.operation==='reconcile'&&Array.isArray(packet.value))for(const patch of packet.value)for(const id of patch.leases||[])this.exportLeases.set(id,worker);}if(job.operation==='releaseExport'&&(!error||packet.releasedExport===job.leaseId)&&this.exportLeases.get(job.leaseId)===worker)this.exportLeases.delete(job.leaseId);this.complete(job,error,packet.value);});
  worker.on('error',error=>{if(this.worker!==worker)return;const job=this.active;this.stop();if(job)this.complete(job,error);});
  worker.on('exit',code=>{ownership.exited=true;ownership.resolveExit();if(this.worker===worker){const job=this.active;this.worker=null;this.retireWorker(worker);if(job)this.complete(job,Error('PDF file worker stopped ('+code+').'));}});return worker;
 }
 pump(){
  if(this.closed||this.failed||this.active||this.stopping)return;clearTimeout(this.idleTimer);if(!this.queue.length){if(this.worker&&![...this.exportLeases.values()].some(worker=>worker===this.worker)){this.worker.unref?.();this.idleTimer=setTimeout(()=>this.stop(),this.idleMs);this.idleTimer.unref?.();}return;}const job=this.active=this.queue.shift();
  try{const worker=this.createWorker();worker.ref?.();job.timer=setTimeout(()=>{if(this.active!==job)return;this.stop();this.complete(job,Error('PDF file work timed out.'));},this.timeoutMs);const transfers=Object.values(job.args).filter(value=>value instanceof Uint8Array&&value.byteOffset===0&&value.byteLength===value.buffer.byteLength).map(value=>value.buffer);worker.postMessage({id:job.id,operation:job.operation,args:job.args},transfers);job.args=null;}catch(error){this.stop();this.complete(job,error);}
 }
 finishQueued(job,error){this.bytes-=job.bytes;job.signal?.removeEventListener('abort',job.abort);job.args=null;job.reject(error);}
 complete(job,error,value){if(!job||this.active!==job)return;clearTimeout(job.timer);this.active=null;this.bytes-=job.bytes;job.signal?.removeEventListener('abort',job.abort);job.args=null;error?job.reject(error):job.resolve(value);this.pump();}
 stop(){
  clearTimeout(this.idleTimer);const worker=this.worker;if(!worker)return;this.worker=null;const state=this.retireWorker(worker),ownership=this.workerOwners.get(worker);
  // A terminate promise is only a request acknowledgment; actual exit grants cleanup authority.
  void Promise.resolve().then(()=>worker.terminate()).catch(error=>{if(ownership.exited||this.stopping!==state)return;this.failed=Error('The previous PDF worker is still closing: '+error.message);for(const job of this.queue.splice(0))this.finishQueued(job,this.failed);});
 }
 retireWorker(worker){
  if(this.stopping?.worker===worker&&!this.stopping.error)return this.stopping;const ownership=this.workerOwners.get(worker),state=this.stopping={worker,promise:null,error:null};this.failed=null;
  state.promise=ownership.exit.then(()=>this.cleanupWorkerLeases(worker)).then(()=>{if(this.stopping===state){this.stopping=null;this.failed=null;this.pump();}},error=>{state.error=error;if(this.stopping===state){this.failed=Error('The previous PDF worker cleanup could not finish: '+error.message,{cause:error});for(const job of this.queue.splice(0))this.finishQueued(job,this.failed);}throw error;});void state.promise.catch(()=>{});return state;
 }
 async cleanupWorkerLeases(worker){
  const state=this.workerOwners.get(worker);if(!state)return;if(state.cleanup)return state.cleanup;
  const pending=(async()=>{await state.exit;const leases=[...this.exportLeases].filter(([,owner])=>owner===worker).map(([id])=>id),cleanup=new PDFExportLeases(path.join(this.root,'Export Leases'));
   try{for(const id of leases)try{await cleanup.cleanOne(id,{settledOwner:state.owner,settledPID:process.pid,maxFiles:Infinity});}catch(error){if(!['ENOENT','ELOOP','ENOTDIR'].includes(error.code)&&!/identity changed|handle changed/.test(error.message))throw error;}await cleanup.cleanup({settledOwner:state.owner,settledPID:process.pid});}finally{await cleanup.closeScan();}
   for(const id of leases)if(this.exportLeases.get(id)===worker)this.exportLeases.delete(id);
  })();state.cleanup=pending;this.cleanupPending.add(pending);void pending.then(()=>this.cleanupPending.delete(pending),()=>{this.cleanupPending.delete(pending);if(state.cleanup===pending)state.cleanup=null;});return pending;
 }
 async dispose(){this.closed=true;clearTimeout(this.idleTimer);for(const job of this.queue.splice(0))this.finishQueued(job,Error('PDF files are closing.'));if(this.active)this.complete(this.active,Error('PDF files are closing.'));this.stop();if(this.stopping?.error)this.retireWorker(this.stopping.worker);await this.stopping?.promise;await Promise.allSettled([...this.cleanupPending]);}
}
module.exports={PDFReferenceJobs};
