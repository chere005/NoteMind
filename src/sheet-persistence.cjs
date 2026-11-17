const {Worker}=require('node:worker_threads'),path=require('node:path'),fs=require('node:fs/promises'),{randomUUID}=require('node:crypto'),{sheetRevision,sameSheetRevision}=require('./sheet-revision.cjs'),{withFileLock}=require('./guarded-write.cjs');
async function atomicSheetWrite(file,bytes,expected){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes,{flag:'wx'});return await withFileLock(file,async()=>{if(expected!==undefined&&!sameSheetRevision(expected,await sheetRevision(file)))throw Error('Saved drawing data changed outside this window. Current drawings remain open.');await fs.rename(temp,file);return sheetRevision(file);});}finally{await fs.unlink(temp).catch(()=>{});}}
class SheetPersistence{
 constructor(file,{workerFactory=(entry,options)=>new Worker(entry,options),timeout=30000,commit=atomicSheetWrite}={}){this.file=file;this.workerFactory=workerFactory;this.timeout=timeout;this.commit=commit;this.pending=new Map();this.next=0;this.worker=null;this.queue=Promise.resolve();this.disposed=false;}
 start(){
  if(this.disposed)throw Error('Drawing persistence is closing.');if(this.worker&&this.worker.threadId!==-1)return this.worker;this.worker=null;
  const worker=this.workerFactory(path.join(__dirname,'sheet-persistence-worker.cjs'),{workerData:{file:this.file},resourceLimits:{maxOldGenerationSizeMb:512}});this.worker=worker;
  const fail=error=>{if(this.worker===worker)this.worker=null;for(const [id,job]of this.pending)if(job.worker===worker){clearTimeout(job.timer);this.pending.delete(id);job.reject(error);}};
  worker.on('message',answer=>{const job=this.pending.get(answer.id);if(!job||job.worker!==worker)return;clearTimeout(job.timer);this.pending.delete(answer.id);if(![...this.pending.values()].some(value=>value.worker===worker))worker.unref();if(answer.error)job.reject(Error(answer.error));else job.resolve(answer.value);});
  worker.on('error',error=>fail(error));worker.on('exit',code=>fail(Error('Drawing persistence worker stopped ('+code+'). Unsaved drawings remain open.')));worker.unref();return worker;
 }
 request(kind,value){let worker;try{worker=this.start();}catch(error){return Promise.reject(error);}const id=++this.next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(!this.pending.has(id))return;for(const [key,job]of this.pending)if(job.worker===worker){clearTimeout(job.timer);this.pending.delete(key);job.reject(Error('Drawing persistence timed out. Unsaved drawings remain open.'));}if(this.worker===worker)this.worker=null;void worker.terminate();},this.timeout);this.pending.set(id,{worker,resolve,reject,timer});worker.ref();try{worker.postMessage({id,kind,value});}catch(error){clearTimeout(timer);this.pending.delete(id);if(!this.pending.size)worker.unref();reject(error);}});}
 serial(run){const next=this.queue.catch(()=>{}).then(run);this.queue=next;return next;}
 load(){return this.serial(()=>this.request('load'));}loadState(){return this.serial(()=>this.request('loadState'));}loadStateCompact(){return this.serial(()=>this.request('loadStateCompact'));}
 async prepared(kind,value){const pending=this.request(kind,value),worker=this.worker,result=await pending;if(!result.prepared)return result.done?result.answer:result;
  let revision;try{revision=await this.commit(this.file,result.bytes,result.expectedRevision);}catch(error){if(this.worker===worker)await this.request('abort',result.token).catch(()=>{});throw error;}
  // Only this serial main-process commit queue renames the authoritative file. A dead
  // worker cannot later overwrite a healthy replacement; lost acknowledgements resync.
  if(this.worker!==worker||worker.threadId===-1){const state=await this.request('session');return {resync:true,...state};}return this.request('commit',{token:result.token,revision:revision===undefined?await sheetRevision(this.file):revision});
 }
 save(value){return this.serial(()=>this.prepared('prepare',value));}saveDelta(value){return this.serial(()=>this.prepared('prepareDelta',value));}
 async dispose(){this.disposed=true;const worker=this.worker;this.worker=null;for(const [id,job]of this.pending){clearTimeout(job.timer);job.reject(Error('Drawing persistence is closing.'));this.pending.delete(id);}if(worker)await worker.terminate();}
}
module.exports={SheetPersistence,atomicSheetWrite};
