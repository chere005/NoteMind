const {Worker,isMarkedAsUntransferable}=require('node:worker_threads'),path=require('node:path');
const {TextEncoder}=require('node:util'),{randomUUID}=require('node:crypto');
const {ArchiveAssetClient}=require('./archive-assets.cjs'),{isRawAsset,rawMissing}=require('./archive-raw-assets.cjs'),{AsyncLocalStorage}=require('node:async_hooks');
const rawOps=new Set(['rawBegin','rawAppend','rawFinish','rawCancel','rawPin','rawLeaseRelease','rawRetain','rawRelease','rawScopedRelease','rawAcquireWorking','rawReleaseWorking','rawRead','rawInfo','rawReadWhole','rawReleaseRead']);
const documentOps=new Set(['encode','encodeWithDigest','prepareSnapshot','publishVersion','exportWord','exportWordFile','wordImageNames','pdfInk']),binaryOps=new Set(['decode','decodeOwned','inspectOwned','inspectDrawingOwned','duplicateArchiveOwned','parseJson']),ownedOps=new Set(['decodeOwned','inspectOwned','inspectDrawingOwned','duplicateArchiveOwned']);
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
function drawingOwned(value){
 if(!value||typeof value!=='object'||Object.keys(value).length!==2||!['graphics','image'].every(key=>Object.hasOwn(value,key)))throw TypeError('Invalid owned drawing assets.');const buffers=[];for(const key of ['graphics','image']){const item=value[key];if(!(item instanceof ArrayBuffer)&&!ArrayBuffer.isView(item))throw TypeError('Invalid owned drawing bytes.');const buffer=item instanceof ArrayBuffer?item:item?.buffer,offset=item instanceof ArrayBuffer?0:item?.byteOffset;if(!(buffer instanceof ArrayBuffer)||offset!==0||item.byteLength!==buffer.byteLength||isMarkedAsUntransferable?.(buffer)||buffers.includes(buffer))throw TypeError('Owned drawing assets require separate exact, transferable ArrayBuffers.');buffers.push(buffer);}return structuredClone({graphics:new Uint8Array(buffers[0]),image:new Uint8Array(buffers[1])},{transfer:buffers});
}
function inputBytes(op,args,limit){
 let bytes=0;
 if(op==='encodeDrawingOwned'){const value=args[0];if(!value||typeof value!=='object')throw TypeError('Invalid owned drawing assets.');bytes=(value.graphics?.byteLength||0)+(value.image?.byteLength||0)+256;}
 else if(binaryOps.has(op)){const value=args[0];bytes=typeof value==='string'?value.length*2:value?.byteLength;if(!Number.isSafeInteger(bytes)||bytes<0)throw TypeError('Expected archive bytes.');}
 else if(rawOps.has(op)){const value=args[0];bytes=op==='rawAppend'?nestedBytes({...value,data:undefined},limit)+(value.data?.byteLength||0):nestedBytes(value,limit);}
 else if(op==='readSnapshot'||op==='readCommitted'||op==='publishVersionFromFile'||op==='publishMarkdownVersionFromFile'||op==='readRecoveryState'||op==='importRawAssetFile'||op==='stringifyJson')bytes=nestedBytes(args[0],limit);
 else bytes=documentBytes(args[0],limit);
 for(let i=1;i<args.length&&bytes<=limit;i++)bytes+=nestedBytes(args[i],limit-bytes);
 return bytes;
}
class ArchiveCodec{
 constructor({workerFactory=file=>new Worker(file),maxPending=8,maxBytes=384*1024*1024,maxAssetBytes=256*1024*1024,maxAssetEntries=20000,maxWorkerBytes=512*1024*1024,maxRawBytes=384*1024*1024,idleMs=30000,timeoutMs=120000}={}){
  Object.assign(this,{workerFactory,maxPending,maxBytes,maxAssetBytes,maxAssetEntries,maxWorkerBytes,maxRawBytes,idleMs,timeoutMs});this.assets=new ArchiveAssetClient({maxBytes:maxAssetBytes,maxEntries:maxAssetEntries});this.epoch=0;this.rollovers=0;this.queue=[];this.active=null;this.worker=null;this.bytes=0;this.next=0;this.stopping=null;this.stoppingWorker=null;this.stopFailure=null;this.disposed=false;this.rawScope=new AsyncLocalStorage();this.rawLeases=new Map();this.rawUploads=new Map();this.rawDescriptors=new Map();this.rawBrands=new WeakMap();this.rawReadBuffers=new WeakMap();this.rawCapacityListeners=new Set();this.retireRequested=false;
 }
 run(op,...args){
  if(this.disposed)return Promise.reject(Error('Archive tools are closing.'));
  if(this.stopFailure)return Promise.reject(Error('Archive tools could not stop their previous worker.'));
  const rawContext=this.rawScope.getStore();let bytes;try{if(rawContext&&!rawOps.has(op))this.checkRawContext(rawContext);if(documentOps.has(op))for(const value of Object.values(args[0]?.assets||{})){if(isRawAsset(value))this.checkRawDescriptor(value,rawContext);else if(typeof value!=='string')throw Error('Invalid archive asset.');}bytes=inputBytes(op,args,this.maxBytes-this.bytes);}catch(error){return Promise.reject(error);}if(this.queue.length+(this.active?1:0)>=this.maxPending||this.bytes+bytes>this.maxBytes)return Promise.reject(busy());
  // Preserve the initiating snapshot while work waits in the bounded queue.
  let transfers=[];try{
   for(let i=1;i<args.length;i++)if(args[i]!==undefined)args[i]=structuredClone(args[i]);
   if(op==='encodeDrawingOwned'){args[0]=drawingOwned(args[0]);transfers=[args[0].graphics.buffer,args[0].image.buffer];}
   else if(binaryOps.has(op)){args[0]=ownedOps.has(op)?binaryOwned(args[0]):binaryCopy(args[0]);transfers=[args[0].buffer];}
   else if(rawOps.has(op)){const value=args[0];if(op==='rawAppend'){const data=value.owned?binaryOwned(value.data):binaryCopy(value.data);args[0]={...structuredClone({...value,data:undefined}),data};transfers=[data.buffer];}else args[0]=structuredClone(value);}
   else if(op==='stringifyJson')args[0]=structuredClone(args[0]);
   else if(documentOps.has(op))args[0]=documentCopy(args[0]);
  }catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{this.bytes+=bytes;this.queue.push({id:++this.next,op,args,transfers,bytes,rawContext,resolve,reject});this.pump();});
 }
 checkRawContext(context){if(!context||context.released||context.lost||context.epoch!==this.epoch||!this.worker||this.worker.threadId===-1||this.rawLeases.get(context.lease)!==context){if(context?.entered)throw Object.assign(Error('The raw archive worker was lost during this operation.'),{code:'ARCHIVE_RAW_LEASE_LOST'});throw rawMissing([...(context?.tokens||[])]);}return context;}
 checkRawDescriptor(descriptor,context){if(!context)throw Error('Raw archive assets require an owner-scoped operation lease.');this.checkRawContext(context);if(this.rawBrands.get(descriptor)!==context.owner)throw Error('Raw archive asset was not issued to this owner.');if(descriptor.epoch!==context.epoch||!context.tokens.has(descriptor.rawAssetToken))throw rawMissing([descriptor.rawAssetToken]);}
 brandRaw(descriptor,owner){if(!isRawAsset(descriptor)||descriptor.epoch!==this.epoch)throw Error('Invalid raw archive asset acknowledgement.');let existing=this.rawDescriptors.get(descriptor.rawAssetToken);if(existing){if(existing.owner!==owner||existing.descriptor.bytes!==descriptor.bytes||existing.descriptor.chars!==descriptor.chars)throw Error('Raw archive asset cannot be rebound.');descriptor=existing.descriptor;}else{descriptor=Object.freeze({...descriptor});this.rawDescriptors.set(descriptor.rawAssetToken,{owner,descriptor});this.rawBrands.set(descriptor,owner);while(this.rawDescriptors.size>this.maxAssetEntries)this.rawDescriptors.delete(this.rawDescriptors.keys().next().value);}return descriptor;}
 brandRawOutput(value,context){const doc=value?.doc?.assets?value.doc:value;if(!doc?.assets)return value;for(const name of Object.keys(doc.assets)){const descriptor=doc.assets[name];if(isRawAsset(descriptor)){if(!context)throw Error('Raw archive output has no owner scope.');doc.assets[name]=this.brandRaw(descriptor,context.owner);context.tokens.add(descriptor.rawAssetToken);}}return value;}
 async beginRawAsset(options){const result=await this.run('rawBegin',options);this.rawUploads.set(result.upload,{...options,epoch:result.epoch});return result;}
 appendRawAsset(upload,data,{owner,epoch,offset,owned=false}={}){return this.run('rawAppend',{upload,data,owner,epoch,offset,owned});}
 async finishRawAsset(upload,{owner,epoch}={}){const context=this.rawScope.getStore();if(context){this.checkRawContext(context);if(context.owner!==owner)throw Error('Raw archive upload belongs to another owner.');}const value=await this.run('rawFinish',{upload,owner,epoch});this.rawUploads.delete(upload);const descriptor=this.brandRaw(value,owner);if(context)context.tokens.add(descriptor.rawAssetToken);return descriptor;}
 async cancelRawAsset(upload,{owner,epoch}={}){const entry=this.rawUploads.get(upload);if(entry&&(entry.owner!==owner||entry.epoch!==epoch))throw Error('Raw archive upload belongs to another owner or epoch.');try{return await this.run('rawCancel',{upload,owner,epoch});}finally{this.rawUploads.delete(upload);this.retireIfReady();}}
 async preflightRawAssets(descriptors=[],{owner}={}){for(const descriptor of descriptors||[])if(this.rawBrands.get(descriptor)!==owner)throw Error('Raw archive asset was not issued to this owner.');const result=await this.run('rawPin',{descriptors,owner});if(result.missing.length)return result;const context={owner,epoch:result.epoch,lease:result.lease,tokens:new Set(descriptors.map(value=>value.rawAssetToken)),entered:false,released:false,lost:false};this.rawLeases.set(context.lease,context);const release=async()=>{if(context.released)return;context.released=true;try{if(!context.lost&&context.epoch===this.epoch&&this.worker)await this.run('rawLeaseRelease',{owner,epoch:context.epoch,lease:context.lease});}finally{this.rawLeases.delete(context.lease);this.retireIfReady();}};return {missing:[],epoch:context.epoch,run:fn=>{this.checkRawContext(context);context.entered=true;return this.rawScope.run(context,fn);},release};}
 async retainRawAssets(owner,tokens){const result=await this.run('rawRetain',{owner,tokens}),keep=new Set(tokens);for(const [token,entry]of this.rawDescriptors)if(entry.owner===owner&&!keep.has(token))this.rawDescriptors.delete(token);return result;}
 async releaseRawAssets(owner,tokens){const result=await this.run('rawRelease',{owner,tokens}),selected=tokens&&new Set(tokens);for(const [token,entry]of this.rawDescriptors)if(entry.owner===owner&&(!selected||selected.has(token)))this.rawDescriptors.delete(token);if(!selected)for(const [upload,entry]of this.rawUploads)if(entry.owner===owner)this.rawUploads.delete(upload);this.retireIfReady();return result;}
 rawAssetInfo(descriptor){const context=this.rawScope.getStore();this.checkRawDescriptor(descriptor,context);return this.run('rawInfo',{descriptor});}
 readRawAsset(descriptor,{owner,offset=0,length=512*1024}={}){const context=this.rawScope.getStore();this.checkRawDescriptor(descriptor,context);if(owner!==undefined&&owner!==context.owner)return Promise.reject(Error('Raw archive read belongs to another owner.'));return this.run('rawRead',{descriptor,offset,length});}
 async readRawAssetBytes(descriptor){const context=this.rawScope.getStore();this.checkRawDescriptor(descriptor,context);const result=await this.run('rawReadWhole',{descriptor});const bytes=Buffer.from(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength);this.rawReadBuffers.set(bytes,{read:result.read,owner:context.owner,lease:context.lease,epoch:context.epoch,info:result.info,backing:bytes.buffer,length:bytes.byteLength,offset:bytes.byteOffset});return bytes;}
 async releaseRawAssetBytes(bytes){const read=this.rawReadBuffers.get(bytes);if(!read)return false;this.rawReadBuffers.delete(bytes);const backing=read.backing;if(!read.offset&&read.length===backing.byteLength&&!isMarkedAsUntransferable?.(backing)&&typeof backing.transfer==='function'){try{backing.transfer(0);if(!backing.byteLength)this.discardedReadBytes=(this.discardedReadBytes||0)+read.length;}catch{}}if(read.epoch!==this.epoch||!this.worker)return false;const {backing:_,length,offset,...record}=read;return this.run('rawReleaseRead',record);}
 // This explicit borrow and all its aliases end at release/callback completion.
 async withRawAssetBytes(descriptor,run){const bytes=await this.readRawAssetBytes(descriptor);try{return await run(bytes,this.rawReadBuffers.get(bytes)?.info);}finally{await this.releaseRawAssetBytes(bytes);}}
 hasRawAssetScope(){const context=this.rawScope.getStore();if(!context)return false;this.checkRawContext(context);return true;}
 subscribeRawCapacity(listener){if(typeof listener!=='function')throw TypeError('Expected a raw capacity listener.');if(this.disposed)return()=>{};this.rawCapacityListeners.add(listener);return()=>this.rawCapacityListeners.delete(listener);}
 notifyRawCapacity(){if(this.capacityQueued||!this.rawCapacityListeners.size)return;this.capacityQueued=true;queueMicrotask(()=>{this.capacityQueued=false;for(const listener of [...this.rawCapacityListeners])try{listener({epoch:this.epoch});}catch{}});}
 observeRawStats(value){const previous=this.workerRawStats;this.workerRawStats=value;if(previous&&['bytes','reserved','working','leases','uploads','reads','entries'].some(key=>value[key]<previous[key]))this.notifyRawCapacity();}
 async importRawAssetFile(file,options){const context=this.rawScope.getStore();this.checkRawContext(context);const value=await this.run('importRawAssetFile',file,options),descriptor=this.brandRaw(value,context.owner);context.tokens.add(descriptor.rawAssetToken);return descriptor;}
 async importRawAssetBytes(bytes){const context=this.rawScope.getStore();this.checkRawContext(context);if(!(bytes instanceof Uint8Array))throw TypeError('Expected raw asset bytes.');const staged=await this.beginRawAsset({owner:context.owner,bytes:bytes.byteLength,chars:4*Math.ceil(bytes.byteLength/3)});try{for(let offset=0;offset<bytes.byteLength;offset+=512*1024)await this.appendRawAsset(staged.upload,bytes.subarray(offset,Math.min(bytes.byteLength,offset+512*1024)),{...staged,owner:context.owner,offset});return await this.finishRawAsset(staged.upload,{...staged,owner:context.owner});}catch(error){await this.cancelRawAsset(staged.upload,{...staged,owner:context.owner}).catch(()=>{});throw error;}}
 async releaseScopedRawAssets(descriptors){const context=this.rawScope.getStore();this.checkRawContext(context);for(const descriptor of descriptors)this.checkRawDescriptor(descriptor,context);await this.run('rawScopedRelease',{descriptors});for(const descriptor of descriptors){context.tokens.delete(descriptor.rawAssetToken);this.rawDescriptors.delete(descriptor.rawAssetToken);}}
 async unpinScopedRawAssets(descriptors){const context=this.rawScope.getStore();this.checkRawContext(context);for(const descriptor of descriptors)this.checkRawDescriptor(descriptor,context);await this.run('rawScopedRelease',{descriptors,release:false});for(const descriptor of descriptors)context.tokens.delete(descriptor.rawAssetToken);if(descriptors.length)this.notifyRawCapacity();}
 async acquireScopedRawWorking(bytes){const context=this.rawScope.getStore();this.checkRawContext(context);const {working}=await this.run('rawAcquireWorking',{bytes});this.checkRawContext(context);let released=false;const controller=new AbortController(),unsubscribe=this.subscribeRawCapacity(()=>{try{this.checkRawContext(context);}catch(error){controller.abort(error);}}),release=async()=>{if(released)return false;released=true;unsubscribe();if(context.lost||context.epoch!==this.epoch||!this.worker)return false;return this.run('rawReleaseWorking',{working,owner:context.owner,lease:context.lease,epoch:context.epoch});};release.signal=controller.signal;return release;}
 liveRaw(){return this.rawUploads.size||[...this.rawLeases.values()].some(value=>!value.released&&!value.lost&&value.epoch===this.epoch);}
 retireIfReady(){if(this.retireRequested&&!this.liveRaw()&&!this.active){this.retireRequested=false;this.stopWorker();}else this.pump();}
 encode(doc,options){return this.run('encode',doc,options);}
 encodeWithDigest(doc,options){return this.run('encodeWithDigest',doc,options);}
 exportWord(doc,images,options){return this.run('exportWord',doc,images,options);}
 wordImageNames(doc){return this.run('wordImageNames',doc);}
 async exportWordFile(doc,images,options,target){
  const {signal,...destination}=target||{},tempId=randomUUID(),cancel=new SharedArrayBuffer(4),flag=new Int32Array(cancel),abort=()=>Atomics.store(flag,0,1);if(signal?.aborted)throw Object.assign(Error('Word export cancelled.'),{name:'AbortError'});signal?.addEventListener('abort',abort,{once:true});
  try{return await this.run('exportWordFile',doc,images,options,{...destination,cancel,tempId});}
  catch(error){const worker=this.stoppingWorker;if(worker&&worker.threadId!==-1)await new Promise(resolve=>worker.once('exit',resolve));if(typeof destination.file==='string'&&path.isAbsolute(destination.file))try{await require('./word-temp.cjs').cleanupOwnedWordTemp(destination.file,tempId)}catch(cleanup){error.wordCleanupError=cleanup.message;}throw error;}
  finally{signal?.removeEventListener('abort',abort);}
 }
 encodeDrawingOwned(packet){return this.run('encodeDrawingOwned',packet);}
 decode(bytes,options){return this.run('decode',bytes,options);}
 decodeOwned(bytes,options){return this.run('decodeOwned',bytes,options);}
 inspectOwned(bytes,options){return this.run('inspectOwned',bytes,options);}
 inspectDrawingOwned(bytes){return this.run('inspectDrawingOwned',bytes);}
 duplicateArchiveOwned(bytes,options){return this.run('duplicateArchiveOwned',bytes,options);}
 prepareSnapshot(doc,options){return this.run('prepareSnapshot',doc,options);}
 readRecoveryState(file){return this.run('readRecoveryState',file);}
 publishVersionFromFile(file,options){return this.run('publishVersionFromFile',file,options);}
 publishMarkdownVersionFromFile(file,options){return this.run('publishMarkdownVersionFromFile',file,options);}
 publishVersion(doc,options){return this.run('publishVersion',doc,options);}
 readSnapshot(root,version,options){return this.run('readSnapshot',root,version,options);}
 readCommitted(file,revision){return this.run('readCommitted',file,revision);}
 parseJson(bytes){return this.run('parseJson',bytes);}
 stringifyJson(value){return this.run('stringifyJson',value);}
 ensureWorker(){
  if(this.worker)return this.worker;
  const worker=this.workerFactory(path.join(__dirname,'archive-worker.cjs'));this.worker=worker;this.epoch++;
  worker.on('message',packet=>{if(this.worker!==worker||packet.id!==this.active?.id)return;const job=this.active;if(packet.rawStats)this.observeRawStats(packet.rawStats);if(packet.assetStats)this.workerAssetStats=packet.assetStats;if(packet.validationStats)this.workerValidationStats=packet.validationStats;
   try{
    if(packet.missingAssets){if(!job.assetPacket||(job.attempts||0)>=2)throw Error('Archive asset references expired repeatedly.');this.assets.retry(job.assetPacket,packet.missingAssets);job.attempts=(job.attempts||0)+1;this.postJob(worker,job);return;}
    if(packet.workerBytes>this.maxWorkerBytes&&!rawOps.has(job.op)){this.rollovers++;this.stopWorker();}
    if(packet.error){const error=Object.assign(Error(packet.error.message),{name:packet.error.name,code:packet.error.code,missing:packet.error.missing});if(job.rawContext?.entered&&error.code==='ARCHIVE_RAW_ASSET_MISSING')error.code='ARCHIVE_RAW_LEASE_LOST';this.finish(job,error);return;}
    let value=packet.value;this.assets.accepted(packet.assetResult?.accepted,job.assetPacket,this.epoch);
    if(job.op==='inspectOwned'&&value)value={...value,doc:this.assets.hydrate(value.doc,packet.assetResult?.output,job.assetPacket?.source,this.epoch)};
    else value=this.assets.hydrate(value,packet.assetResult?.output,job.assetPacket?.source,this.epoch);
    if(job.op==='encode'||job.op==='duplicateArchiveOwned'||job.op==='exportWord'||job.op==='stringifyJson')value=Buffer.from(value.buffer,value.byteOffset,value.byteLength);
    if(job.op==='encodeWithDigest'||job.op==='encodeDrawingOwned'){const bytes=value.bytes;value={...value,bytes:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)};}
    const decoded=job.op==='inspectOwned'?value.doc:value;if((job.op==='decode'||ownedOps.has(job.op))&&decoded.files)for(const name of Object.keys(decoded.files)){const bytes=decoded.files[name];decoded.files[name]=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
    value=this.brandRawOutput(value,job.rawContext);this.assets.trim();this.workerRawStats=packet.rawStats;this.workerAssetStats=packet.assetStats;this.finish(job,null,value);
   }catch(error){this.assets.trim();this.finish(job,error);}
  });
  worker.on('error',error=>this.workerFailed(worker,error));
  worker.on('exit',code=>{if(this.stoppingWorker===worker)this.retireWorker(worker);else if(this.worker===worker)this.workerFailed(worker,Error('Archive worker stopped ('+code+').'));});
  return worker;
 }
 pump(){
  if(this.disposed||this.active||this.stopping||this.stoppingWorker||this.stopFailure)return;
  clearTimeout(this.idleTimer);
  if(!this.queue.length){if(this.worker){this.worker.unref?.();if(this.liveRaw())return;this.idleTimer=setTimeout(()=>this.stopWorker(),this.idleMs);this.idleTimer.unref?.();}return;}
  const job=this.active=this.queue.shift();
  try{const worker=this.ensureWorker();worker.ref?.();job.timer=setTimeout(()=>this.workerFailed(worker,Error('Archive work timed out.')),this.timeoutMs);this.postJob(worker,job);}
  catch(error){if(['ARCHIVE_RAW_ASSET_MISSING','ARCHIVE_RAW_LEASE_LOST'].includes(error.code))this.finish(job,error);else this.workerFailed(this.worker,error);}
 }
 postJob(worker,job){
  const args=[...job.args];if(job.rawContext&&!rawOps.has(job.op))this.checkRawContext(job.rawContext);if(documentOps.has(job.op)){job.assetPacket ||= this.assets.packet(args[0],this.epoch);args[0]=job.assetPacket.wire.document;}
  const wire=job.assetPacket?.wire,assetPacket=wire?{refs:wire.refs,rawRefs:wire.rawRefs,added:wire.added}:undefined,knownAssets=[...this.assets.entries].filter(([,entry])=>entry.epoch===this.epoch).map(([token])=>token);
  worker.postMessage({id:job.id,op:job.op,args,codecEpoch:this.epoch,rawContext:job.rawContext?{owner:job.rawContext.owner,lease:job.rawContext.lease,epoch:job.rawContext.epoch,tokens:[...job.rawContext.tokens]}:undefined,rawLimits:{maxBytes:this.maxRawBytes,maxCacheBytes:this.maxAssetBytes,maxEntries:this.maxAssetEntries},assetPacket,knownAssets,assetLimits:{maxBytes:this.maxAssetBytes,maxEntries:this.maxAssetEntries}},job.transfers||[]);
  if(job.assetPacket)job.args[0]=null;job.transfers=null;
 }
 assetStats(){return {...this.assets.stats(),uploads:this.assets.uploads,worker:this.workerAssetStats,epoch:this.epoch,rollovers:this.rollovers,raw:this.workerRawStats,validation:this.workerValidationStats,discardedReadBytes:this.discardedReadBytes||0};}
 finish(job,error,value){
  if(this.active!==job)return;clearTimeout(job.timer);this.active=null;this.bytes-=job.bytes;job.args=null;job.assetPacket=null;error?job.reject(error):job.resolve(value);this.pump();
 }
 workerFailed(worker,error){
  if(worker!==this.worker)return;this.stopWorker(true);const job=this.active;if(job)this.finish(job,error);else this.pump();
 }
 stopWorker(force=false){
  if(!force&&this.liveRaw()){this.retireRequested=true;return;}clearTimeout(this.idleTimer);const worker=this.worker;this.worker=null;if(!worker)return;
  this.stoppingWorker=worker;if(force)this.notifyRawCapacity();
  const attempt=Promise.resolve().then(()=>worker.terminate()).then(()=>this.retireWorker(worker),error=>{
   if(this.stoppingWorker!==worker)return;if(worker.threadId===-1){this.retireWorker(worker);return;}
   // A rejected termination does not prove that the previous worker has stopped.
   this.stopFailure=error;for(const job of this.queue.splice(0)){this.bytes-=job.bytes;job.args=null;job.reject(Error('Archive tools could not stop their previous worker.'));}
  }).finally(()=>{if(this.stopping===attempt)this.stopping=null;this.pump();});this.stopping=attempt;
 }
 retireWorker(worker){if(this.stoppingWorker!==worker)return;this.rawUploads.clear();this.rawDescriptors.clear();for(const context of this.rawLeases.values())context.lost=true;this.workerRawStats=null;this.notifyRawCapacity();this.stoppingWorker=null;this.stopFailure=null;this.pump();}
 async dispose(){
  this.disposed=true;clearTimeout(this.idleTimer);for(const job of this.queue.splice(0)){this.bytes-=job.bytes;job.reject(Error('Archive tools are closing.'));}
  if(this.active)this.finish(this.active,Error('Archive tools are closing.'));this.stopWorker(true);await this.stopping;
  this.assets.clear();this.workerAssetStats=null;this.rawCapacityListeners.clear();
 }
}
const codec=new ArchiveCodec();
module.exports=codec;module.exports.ArchiveCodec=ArchiveCodec;
