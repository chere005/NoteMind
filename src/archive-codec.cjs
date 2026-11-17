const {Worker,isMarkedAsUntransferable}=require('node:worker_threads'),path=require('node:path');
const {TextEncoder}=require('node:util');
const {ArchiveAssetClient}=require('./archive-assets.cjs');
const documentOps=new Set(['encode','encodeWithDigest','prepareSnapshot']),binaryOps=new Set(['decode','decodeOwned','inspectOwned','parseJson']),ownedOps=new Set(['decodeOwned','inspectOwned']);
const busy=()=>Error('Archive work is busy. The current document remains open; try saving again shortly.');
function nestedBytes(value,limit){
 const pending=[value],seen=new Set();let bytes=0;
 while(pending.length&&bytes<=limit){
  const item=pending.pop();if(item==null){bytes+=4;continue;}
  if(typeof item==='string'){bytes+=item.length*2;continue;}
  if(typeof item==='bigint')throw TypeError('Archive metadata cannot contain BigInt values.');
  if(typeof item!=='object'){bytes+=8;continue;}
  if(seen.has(item))continue;seen.add(item);bytes+=64;
  if(ArrayBuffer.isView(item)){bytes+=Math.max(item.byteLength,(item.length||0)*8);continue;}
  if(item instanceof ArrayBuffer){bytes+=item.byteLength;continue;}
  if(item instanceof Map){for(const [key,value]of item){bytes+=16;pending.push(key,value);if(bytes>limit)break;}continue;}
  if(item instanceof Set){for(const value of item){bytes+=16;pending.push(value);if(bytes>limit)break;}continue;}
  if(item instanceof Error){pending.push(item.message,item.stack);continue;}
  for(const key of Object.keys(item)){bytes+=key.length*2+16;pending.push(item[key]);if(bytes>limit)break;}
 }
 return bytes;
}
function documentBytes(doc,limit){
 if(!doc||typeof doc!=='object')throw TypeError('Invalid archive document.');let bytes=64;
 for(const key of Object.keys(doc)){
  bytes+=key.length*2+16;
  if(key==='assets')for(const [name,value]of Object.entries(doc.assets||{})){
   // App assets are immutable ASCII base64 strings; metadata/options use conservative UTF16 accounting.
   bytes+=name.length*2+16+(typeof value==='string'?value.length:nestedBytes(value,limit-bytes));if(bytes>limit)break;
  }
  else bytes+=nestedBytes(doc[key],limit-bytes);
  if(bytes>limit)break;
 }
 return bytes;
}
function documentCopy(doc){
 const copy={...doc,assets:{...doc.assets},meta:structuredClone(doc.meta||{})};
 for(const key of Object.keys(copy))if(key!=='assets'&&key!=='meta'&&copy[key]&&typeof copy[key]==='object')copy[key]=structuredClone(copy[key]);
 for(const name of Object.keys(copy.assets))if(copy.assets[name]&&typeof copy.assets[name]==='object')copy.assets[name]=structuredClone(copy.assets[name]);return copy;
}
function binaryCopy(value){
 if(typeof value==='string')return new TextEncoder().encode(value);
 if(value instanceof ArrayBuffer)return Uint8Array.from(new Uint8Array(value));
 if(ArrayBuffer.isView(value))return Uint8Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
 throw TypeError('Expected archive bytes.');
}
function binaryOwned(value){
 const buffer=value instanceof ArrayBuffer?value:value?.buffer,offset=value instanceof ArrayBuffer?0:value?.byteOffset,length=value?.byteLength;
 if(!(buffer instanceof ArrayBuffer)||offset!==0||length!==buffer.byteLength||isMarkedAsUntransferable?.(buffer))throw TypeError('Owned archive bytes require an exact, transferable ArrayBuffer.');
 return structuredClone(new Uint8Array(buffer),{transfer:[buffer]});
}
function inputBytes(op,args,limit){
 let bytes=0;
 if(binaryOps.has(op)){const value=args[0];bytes=typeof value==='string'?value.length*2:value?.byteLength;if(!Number.isSafeInteger(bytes)||bytes<0)throw TypeError('Expected archive bytes.');}
 else if(op==='readSnapshot'||op==='readCommitted'||op==='stringifyJson')bytes=nestedBytes(args[0],limit);
 else bytes=documentBytes(args[0],limit);
 for(let i=1;i<args.length&&bytes<=limit;i++)bytes+=nestedBytes(args[i],limit-bytes);
 return bytes;
}
class ArchiveCodec{
 constructor({workerFactory=file=>new Worker(file),maxPending=8,maxBytes=384*1024*1024,maxAssetBytes=256*1024*1024,maxAssetEntries=20000,maxWorkerBytes=512*1024*1024,idleMs=30000,timeoutMs=120000}={}){
  Object.assign(this,{workerFactory,maxPending,maxBytes,maxAssetBytes,maxAssetEntries,maxWorkerBytes,idleMs,timeoutMs});this.assets=new ArchiveAssetClient({maxBytes:maxAssetBytes,maxEntries:maxAssetEntries});this.epoch=0;this.rollovers=0;this.queue=[];this.active=null;this.worker=null;this.bytes=0;this.next=0;this.stopping=null;this.stoppingWorker=null;this.stopFailure=null;this.disposed=false;
 }
 run(op,...args){
  if(this.disposed)return Promise.reject(Error('Archive tools are closing.'));
  if(this.stopFailure)return Promise.reject(Error('Archive tools could not stop their previous worker.'));
  let bytes;try{bytes=inputBytes(op,args,this.maxBytes-this.bytes);}catch(error){return Promise.reject(error);}if(this.queue.length+(this.active?1:0)>=this.maxPending||this.bytes+bytes>this.maxBytes)return Promise.reject(busy());
  // Preserve the initiating snapshot while work waits in the bounded queue.
  let transfers=[];try{
   for(let i=1;i<args.length;i++)if(args[i]!==undefined)args[i]=structuredClone(args[i]);
   if(binaryOps.has(op)){args[0]=ownedOps.has(op)?binaryOwned(args[0]):binaryCopy(args[0]);transfers=[args[0].buffer];}
   else if(op==='stringifyJson')args[0]=structuredClone(args[0]);
   else if(documentOps.has(op))args[0]=documentCopy(args[0]);
  }catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{this.bytes+=bytes;this.queue.push({id:++this.next,op,args,transfers,bytes,resolve,reject});this.pump();});
 }
 encode(doc,options){return this.run('encode',doc,options);}
 encodeWithDigest(doc,options){return this.run('encodeWithDigest',doc,options);}
 decode(bytes,options){return this.run('decode',bytes,options);}
 decodeOwned(bytes,options){return this.run('decodeOwned',bytes,options);}
 inspectOwned(bytes,options){return this.run('inspectOwned',bytes,options);}
 prepareSnapshot(doc,options){return this.run('prepareSnapshot',doc,options);}
 readSnapshot(root,version,options){return this.run('readSnapshot',root,version,options);}
 readCommitted(file,revision){return this.run('readCommitted',file,revision);}
 parseJson(bytes){return this.run('parseJson',bytes);}
 stringifyJson(value){return this.run('stringifyJson',value);}
 ensureWorker(){
  if(this.worker)return this.worker;
  const worker=this.workerFactory(path.join(__dirname,'archive-worker.cjs'));this.worker=worker;this.epoch++;
  worker.on('message',packet=>{if(this.worker!==worker||packet.id!==this.active?.id)return;const job=this.active;
   try{
    if(packet.missingAssets){if(!job.assetPacket||(job.attempts||0)>=2)throw Error('Archive asset references expired repeatedly.');this.assets.retry(job.assetPacket,packet.missingAssets);job.attempts=(job.attempts||0)+1;this.postJob(worker,job);return;}
    if(packet.workerBytes>this.maxWorkerBytes){this.rollovers++;this.stopWorker();}
    if(packet.error){const error=Object.assign(Error(packet.error.message),{name:packet.error.name});this.finish(job,error);return;}
    let value=packet.value;this.assets.accepted(packet.assetResult?.accepted,job.assetPacket,this.epoch);
    if(job.op==='inspectOwned'&&value)value={...value,doc:this.assets.hydrate(value.doc,packet.assetResult?.output,job.assetPacket?.source,this.epoch)};
    else value=this.assets.hydrate(value,packet.assetResult?.output,job.assetPacket?.source,this.epoch);
    if(job.op==='encode'||job.op==='stringifyJson')value=Buffer.from(value.buffer,value.byteOffset,value.byteLength);
    if(job.op==='encodeWithDigest'){const bytes=value.bytes;value={...value,bytes:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)};}
    const decoded=job.op==='inspectOwned'?value.doc:value;if((job.op==='decode'||ownedOps.has(job.op))&&decoded.files)for(const name of Object.keys(decoded.files)){const bytes=decoded.files[name];decoded.files[name]=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
    this.assets.trim();this.workerAssetStats=packet.assetStats;this.finish(job,null,value);
   }catch(error){this.assets.trim();this.finish(job,error);}
  });
  worker.on('error',error=>this.workerFailed(worker,error));
  worker.on('exit',code=>{if(this.stoppingWorker===worker)this.retireWorker(worker);else if(this.worker===worker)this.workerFailed(worker,Error('Archive worker stopped ('+code+').'));});
  return worker;
 }
 pump(){
  if(this.disposed||this.active||this.stopping||this.stoppingWorker||this.stopFailure)return;
  clearTimeout(this.idleTimer);
  if(!this.queue.length){if(this.worker){this.worker.unref?.();this.idleTimer=setTimeout(()=>this.stopWorker(),this.idleMs);this.idleTimer.unref?.();}return;}
  const job=this.active=this.queue.shift();
  try{const worker=this.ensureWorker();worker.ref?.();job.timer=setTimeout(()=>this.workerFailed(worker,Error('Archive work timed out.')),this.timeoutMs);this.postJob(worker,job);}
  catch(error){this.workerFailed(this.worker,error);}
 }
 postJob(worker,job){
  const args=[...job.args];if(documentOps.has(job.op)){job.assetPacket ||= this.assets.packet(args[0],this.epoch);args[0]=job.assetPacket.wire.document;}
  const wire=job.assetPacket?.wire,assetPacket=wire?{refs:wire.refs,added:wire.added}:undefined,knownAssets=[...this.assets.entries].filter(([,entry])=>entry.epoch===this.epoch).map(([token])=>token);
  worker.postMessage({id:job.id,op:job.op,args,assetPacket,knownAssets,assetLimits:{maxBytes:this.maxAssetBytes,maxEntries:this.maxAssetEntries}},job.transfers||[]);
  if(job.assetPacket)job.args[0]=null;job.transfers=null;
 }
 assetStats(){return {...this.assets.stats(),uploads:this.assets.uploads,worker:this.workerAssetStats,epoch:this.epoch,rollovers:this.rollovers};}
 finish(job,error,value){
  if(this.active!==job)return;clearTimeout(job.timer);this.active=null;this.bytes-=job.bytes;job.args=null;job.assetPacket=null;error?job.reject(error):job.resolve(value);this.pump();
 }
 workerFailed(worker,error){
  if(worker!==this.worker)return;this.stopWorker();const job=this.active;if(job)this.finish(job,error);else this.pump();
 }
 stopWorker(){
  clearTimeout(this.idleTimer);const worker=this.worker;this.worker=null;if(!worker)return;
  this.stoppingWorker=worker;
  const attempt=Promise.resolve().then(()=>worker.terminate()).then(()=>this.retireWorker(worker),error=>{
   if(this.stoppingWorker!==worker)return;if(worker.threadId===-1){this.retireWorker(worker);return;}
   // A rejected termination does not prove that the previous worker has stopped.
   this.stopFailure=error;for(const job of this.queue.splice(0)){this.bytes-=job.bytes;job.args=null;job.reject(Error('Archive tools could not stop their previous worker.'));}
  }).finally(()=>{if(this.stopping===attempt)this.stopping=null;this.pump();});this.stopping=attempt;
 }
 retireWorker(worker){if(this.stoppingWorker!==worker)return;this.stoppingWorker=null;this.stopFailure=null;this.pump();}
 async dispose(){
  this.disposed=true;clearTimeout(this.idleTimer);for(const job of this.queue.splice(0)){this.bytes-=job.bytes;job.reject(Error('Archive tools are closing.'));}
  if(this.active)this.finish(this.active,Error('Archive tools are closing.'));this.stopWorker();await this.stopping;
  this.assets.clear();this.workerAssetStats=null;
 }
}
const codec=new ArchiveCodec();
module.exports=codec;module.exports.ArchiveCodec=ArchiveCodec;
