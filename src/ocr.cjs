const {Worker}=require('node:worker_threads');
const {existsSync}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const folder=path.join(__dirname,'helpers','text-ocr');
const files=['worker.mjs','ort/ort-wasm-simd-threaded.mjs','ort/ort-wasm-simd-threaded.wasm','models/ch_PP-OCRv5_det_mobile.onnx','models/en_PP-OCRv5_rec_mobile.onnx','models/ch_PP-OCRv5_rec_mobile.onnx'];
const available=()=>files.every(f=>existsSync(path.join(folder,f)));
function readingOrder(lines){const rows=[];for(const line of [...lines].sort((a,b)=>a.y-b.y||a.x-b.x)){const cy=line.y+line.height/2;const row=rows.find(r=>Math.abs(r.cy-cy)<Math.max(r.height,line.height)*.45);if(row){row.lines.push(line);row.height=Math.max(row.height,line.height)}else rows.push({cy,height:line.height,lines:[line]});}return rows.sort((a,b)=>a.cy-b.cy).map(r=>r.lines.sort((a,b)=>a.x-b.x).map(l=>l.text).join(' ')).join('\n');}
class TextReader {
 constructor(){this.queue=[];this.workers=new Set();this.jobs=new Map();this.cache=new Map();this.next=0;}
 read(bytes,{id=String(++this.next),language='auto',signal,onProgress=()=>{}}={}){
  if(this.disposed)return Promise.reject(Error('The text reader is closing.'));
  if(!available())return Promise.reject(Error('The text reader files are missing.'));
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
  if(bytes.length>40*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return Promise.reject(Error('The text reader needs a PNG image of up to 40 MB.'));
  const key=createHash('sha256').update(bytes).update(language).digest('hex');
  if(this.cache.has(key))return Promise.resolve(structuredClone(this.cache.get(key)));
  if(this.jobs.has(id))return Promise.reject(Error('This reading is already running.'));
  return new Promise((resolve,reject)=>{const job={id,bytes,key,language,onProgress,resolve,reject,worker:null};this.jobs.set(id,job);this.queue.push(job);onProgress('Queued');if(signal){job.abort=()=>this.cancel(id);signal.addEventListener('abort',job.abort,{once:true});job.cleanup=()=>signal.removeEventListener('abort',job.abort);if(signal.aborted){this.cancel(id);return;}}this.pump();});
 }
 pump(){while(this.workers.size<2&&this.queue.length){const job=this.queue.shift();if(!this.jobs.has(job.id))continue;const worker=new Worker(path.join(folder,'worker.mjs'),{workerData:{folder,threads:Math.min(4,require('node:os').availableParallelism())}});job.worker=worker;this.workers.add(worker);job.onProgress('Reading text');
   const finish=(error,result)=>{if(!this.jobs.has(job.id))return;this.jobs.delete(job.id);job.cleanup?.();clearTimeout(job.timer);this.workers.delete(worker);void worker.terminate();if(error)job.reject(error);else{const value={text:readingOrder(result.lines),lines:result.lines,language:job.language,timing:result.timing};this.cache.set(job.key,value);if(this.cache.size>32)this.cache.delete(this.cache.keys().next().value);job.resolve(structuredClone(value));}this.pump();};
   worker.once('error',e=>finish(e));worker.once('exit',code=>{if(this.jobs.has(job.id))finish(Error('Text reader stopped ('+code+').'))});worker.on('message',r=>{if(r.id===job.id)finish(r.error?Error(r.error):null,r)});job.timer=setTimeout(()=>finish(Error('Text reading timed out. Try a smaller image.')),120000);worker.postMessage({id:job.id,bytes:job.bytes,japanese:job.language!=='en'});
 }}
 cancel(id){const job=this.jobs.get(id);if(!job)return;this.jobs.delete(id);job.cleanup?.();clearTimeout(job.timer);this.queue=this.queue.filter(j=>j!==job);if(job.worker){this.workers.delete(job.worker);void job.worker.terminate();}job.reject(Object.assign(Error('Reading cancelled.'),{name:'AbortError'}));this.pump();}
 dispose(){this.disposed=true;for(const id of [...this.jobs.keys()])this.cancel(id);}
}
module.exports={TextReader,available};
