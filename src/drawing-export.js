const graphics=require('./graphics-pane.js');
const {backdropReady}=require('./tablet/renderer/tabletBackdrop');
const closed=()=>Error('Drawing exporter is closed.');
const closeTiles=value=>{for(const tile of [...(value?.tiles||[]),...(value?.preview?.fixed||[]),...(value?.preview?.ink?[value.preview.ink]:[])])tile.bitmap?.close();};
const verifiedSidecars=new WeakSet();
class DrawingExporter {
 constructor({worker=()=>new Worker(new URL('drawing-worker.js',document.baseURI)),pack=graphics.encodeBytesAsync,bitmap=async file=>{const image=await backdropReady(file);if(!image)throw Error('Could not load the drawing background.');return createImageBitmap(image);},timeout=120000,idle=10000}={}){
  Object.assign(this,{factory:worker,pack,bitmap,timeout,idle});this.queue=[];this.active=null;this.worker=null;this.running=false;this.nextId=1;this.disposed=false;this.idleTimer=null;this.responses=new Map();this.leases=0;this.rasterCount=0;this.rasterBytes=0;this.transformCount=0;this.transformBytes=0;
 }
 run(snapshot,options={}){
  if(this.disposed)return Promise.reject(closed());
  if(this.queue.length+(this.active?1:0)>=4)return Promise.reject(Error('Too many drawing exports are pending.'));
  snapshot=options.normalize?snapshot:{...snapshot,strokes:snapshot.strokes.slice(),paper:{...snapshot.paper},region:{...snapshot.region},extent:snapshot.extent?{...snapshot.extent}:undefined};
  return new Promise((resolve,reject)=>{
   const controller=new AbortController(),job={id:this.nextId++,snapshot,options,resolve,reject,controller,done:false};
   job.abort=()=>{controller.abort();if(this.active===job){try{this.worker?.postMessage({cancelExport:job.id});}catch{}job.responseReject?.(Error('Drawing export cancelled.'));}else this.queue=this.queue.filter(value=>value!==job);this.finish(job,Error('Drawing export cancelled.'));};
   options.signal?.addEventListener('abort',job.abort,{once:true});if(options.signal?.aborted){job.abort();return;}this.queue.push(job);void this.pump();
  });
 }
 async normalize(bytes,options={}){
  if(this.disposed)throw closed();if(this.queue.length+(this.active?1:0)>=4)throw Error('Too many drawing exports are pending.');
  if(!options.owned){const copy=new Uint8Array(bytes.byteLength);for(let at=0;at<copy.length;at+=65536){if(options.signal?.aborted)throw Error('Drawing load cancelled.');copy.set(bytes.subarray(at,at+65536),at);await graphics.yieldTask();}bytes=copy;}
  return this.run({encodedBytes:bytes},{...options,normalize:true,png:false});
 }
 finish(job,error,value){if(job.done)return;job.done=true;job.options.signal?.removeEventListener('abort',job.abort);if(error)job.reject(error);else job.resolve(value);}
 stopWorker(error=Error('Drawing worker stopped.')){
  clearTimeout(this.idleTimer);this.idleTimer=null;const worker=this.worker;this.worker=null;worker?.terminate();for(const request of this.responses.values())request.reject(error);this.responses.clear();
 }
 maybeIdle(){if(this.worker&&!this.disposed&&!this.leases&&!this.running&&!this.responses.size){clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>this.stopWorker(),this.idle);}}
 hold(){this.leases++;clearTimeout(this.idleTimer);let released=false;return()=>{if(released)return;released=true;this.leases=Math.max(0,this.leases-1);this.maybeIdle();};}
 getWorker(){
  clearTimeout(this.idleTimer);this.idleTimer=null;if(this.worker)return this.worker;
  const worker=this.worker=this.factory();
  worker.onmessage=event=>{
   if(this.worker!==worker){closeTiles(event.data);return;}const value=event.data,request=this.responses.get(value?.id);if(!request){closeTiles(value);return;}
   if(Object.hasOwn(value,'sidecarChunk')){const chunk=value.sidecarChunk;request.chunks ||= [];request.chunkBytes ||= 0;if(request.chunks.length>=Math.ceil(graphics.MAX_BINARY_BYTES/196608)||value.index!==request.chunks.length||typeof chunk!=='string'||!chunk.length||chunk.length>262144||chunk.length%4||request.padded||!/^[a-z0-9+/]*={0,2}$/i.test(chunk)||(request.chunkBytes+=chunk.length)>Math.ceil(graphics.MAX_BINARY_BYTES/3)*4){this.responses.delete(value.id);try{worker.postMessage({cancelExport:value.id});}catch{}request.reject(Error('Invalid drawing sidecar stream.'));return;}request.padded=chunk.endsWith('=');request.chunks.push(chunk);void graphics.yieldTask().then(()=>{if(this.worker===worker&&this.responses.get(value.id)===request)worker.postMessage({sidecarAck:value.id,index:value.index});}).catch(error=>{if(this.responses.get(value.id)===request){this.responses.delete(value.id);request.reject(error);}});return;}
   this.responses.delete(value.id);if(value.error)request.reject(Error(value.error));else{if(request.chunks){if(value.sidecarLength!==request.chunkBytes){request.reject(Error('Incomplete drawing sidecar stream.'));return;}let sidecar='';for(const chunk of request.chunks)sidecar+=chunk;value.sidecar=sidecar;value.sidecarChunks=Object.freeze(request.chunks);verifiedSidecars.add(value);}request.resolve(value);}
  };
  worker.onerror=event=>{event.preventDefault?.();if(this.worker===worker)this.stopWorker(Error(event.message||'Drawing export worker stopped.'));};
  worker.onmessageerror=()=>{if(this.worker===worker)this.stopWorker(Error('Drawing worker returned unreadable data.'));};
  return worker;
 }
 send(packet,transfers){return new Promise((resolve,reject)=>{try{const worker=this.getWorker();this.responses.set(packet.id,{resolve,reject});worker.postMessage(packet,transfers);}catch(error){this.responses.delete(packet.id);reject(error);}});}
 cancelInk(session){try{this.worker?.postMessage({inkCancel:session});}catch{}}
 async raster(request,{signal}={}){
  if(this.disposed)throw closed();const buffers=new Set();for(const value of [request.order,request.additions,request.addIds,...(request.patches||[]).map(patch=>patch.insert)])if(ArrayBuffer.isView(value))buffers.add(value.buffer);const bytes=[...buffers].reduce((n,value)=>n+value.byteLength,0);
  if(this.rasterCount>=2||this.rasterBytes+bytes>256*1024*1024)throw Error('Drawing paint is busy.');this.rasterCount++;this.rasterBytes+=bytes;
  const id=this.nextId++;let timer,abort;try{
   if(signal?.aborted)throw Error('Drawing paint cancelled.');
   const pending=this.send({id,ink:request},[...buffers]);
   const stopped=new Promise((_resolve,reject)=>{abort=()=>{this.cancelInk(request.session);const held=this.responses.get(id);this.responses.delete(id);held?.reject(Error('Drawing paint cancelled.'));reject(Error('Drawing paint cancelled.'));};signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{this.cancelInk(request.session);const held=this.responses.get(id);this.responses.delete(id);held?.reject(Error('Drawing paint timed out.'));reject(Error('Drawing paint timed out.'));},this.timeout);});
   const result=await Promise.race([pending,stopped]);if(!result.resync&&!result.cancelled&&(!Number.isSafeInteger(result.frame)||!Array.isArray(result.tiles))){closeTiles(result);throw Error('Invalid drawing paint response.');}return result;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.rasterCount--;this.rasterBytes-=bytes;this.maybeIdle();}
 }
 async geometry(strokes,operation,{signal}={}){
  if(this.disposed)throw closed();const cost=strokes.reduce((n,stroke)=>n+16+stroke.points.length*(stroke.pressures?24:16),128);
  if(this.transformCount>=2||this.transformBytes+cost*2>256*1024*1024)throw Error('Another large selection is moving. Try again shortly.');this.transformCount++;this.transformBytes+=cost*2;
  const id=this.nextId++;let timer,abort;const cancelled=()=>Error('Drawing transformation cancelled.');try{
   if(signal?.aborted)throw cancelled();const bytes=await this.pack({name:'Ink',aspect:1,strokes,backdrop:null},{signal});if(signal?.aborted)throw cancelled();if(this.disposed)throw closed();
   const pending=this.send({id,bytes,...operation},[bytes.buffer]);
   const stopped=new Promise((_resolve,reject)=>{const stop=error=>{try{this.worker?.postMessage({cancelExport:id});}catch{}const held=this.responses.get(id);this.responses.delete(id);held?.reject(error);reject(error);};abort=()=>stop(cancelled());signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}timer=setTimeout(()=>stop(Error('Drawing transformation timed out.')),this.timeout);});
   const result=await Promise.race([pending,stopped]);if(operation.fingerprint){if(!(result.hashBytes instanceof Uint8Array)||result.hashBytes.byteLength!==strokes.length*8)throw Error('Invalid drawing fingerprints.');return result;}if(!ArrayBuffer.isView(result.bytes)||!graphics.isBinary(result.bytes)||!(result.indexes instanceof Uint32Array)||!(result.hashBytes instanceof Uint8Array)||result.hashBytes.byteLength!==result.indexes.length*8)throw Error('Invalid transformed drawing response.');return result;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.transformCount--;this.transformBytes-=cost*2;this.maybeIdle();}
 }
 transform(strokes,from,to,options){return this.geometry(strokes,{transform:{from:{...from},to:{...to}}},options);}
 fingerprint(strokes,options){return this.geometry(strokes,{fingerprint:true},options);}
 async pump(){
  if(this.running)return;this.running=true;
  while(this.queue.length&&!this.disposed){
   const job=this.queue.shift();if(job.done)continue;this.active=job;
   const timer=setTimeout(()=>{job.controller.abort();this.stopWorker(Error('Drawing export timed out.'));job.responseReject?.(Error('Drawing export timed out.'));this.finish(job,Error('Drawing export timed out.'));},this.timeout);let bitmap=null;
   try{
    const {snapshot,options}=job,bytes=options.normalize?snapshot.encodedBytes:await this.pack({name:snapshot.name,aspect:snapshot.aspect,strokes:snapshot.strokes,backdrop:snapshot.backdrop,paper:snapshot.paper,extent:snapshot.extent},{signal:job.controller.signal});if(job.done||job.controller.signal.aborted)continue;
    if(options.png!==false&&snapshot.backdrop){bitmap=await this.bitmap(snapshot.backdrop);if(job.done||job.controller.signal.aborted)continue;}
    const pending=this.send({id:job.id,bytes,normalize:!!options.normalize,bitmap,region:snapshot.region,png:options.png!==false,sidecar:!!options.sidecar,crop:!!options.crop,withPaper:options.withPaper!==false,maxPixels:options.maxPixels,maxDimension:options.maxDimension},bitmap?[bytes.buffer,bitmap]:[bytes.buffer]);bitmap=null;job.responseReject=error=>{const request=this.responses.get(job.id);this.responses.delete(job.id);request?.reject(error);};const result=await pending;
    if((options.normalize&&(!ArrayBuffer.isView(result.bytes)||!graphics.isBinary(result.bytes)||!result.metadata))||(options.png!==false&&!/^data:image\/png;base64,[a-z0-9+/=\r\n]+$/i.test(result.png))||(options.sidecar&&!verifiedSidecars.has(result)&&!validSidecarEnvelope(result.sidecar)))throw Error('Invalid drawing export response.');
    this.finish(job,null,result);
   }catch(error){this.finish(job,error);}finally{bitmap?.close();clearTimeout(timer);job.responseReject=null;this.active=null;}
  }
  this.running=false;this.maybeIdle();
 }
 dispose(){this.disposed=true;this.stopWorker(closed());for(const job of [this.active,...this.queue])if(job){job.controller.abort();job.responseReject?.(closed());this.finish(job,closed());}this.queue=[];}
}
function validSidecarEnvelope(value){return typeof value==='string'&&value.length>0&&value.length%4===0&&value.length<=Math.ceil(graphics.MAX_BINARY_BYTES/3)*4&&/^[a-z0-9+/]+$/i.test(value.slice(0,Math.min(4,value.length)))&&/^[a-z0-9+/]*={0,2}$/i.test(value.slice(-4));}
let shared=null,legacy=null,legacyCount=0,legacyBytes=0;
function exporter(){if(!shared){shared=new DrawingExporter();globalThis.addEventListener?.('pagehide',()=>{shared?.dispose();shared=null;legacy?.dispose();legacy=null;},{once:true});}return shared;}
async function temporary(cost,run){if(legacyCount>=2||legacyBytes+cost>512*1024*1024)throw Error('Another large drawing is opening. Try again shortly.');legacy ||= new DrawingExporter({idle:0});const owner=legacy;legacyCount++;legacyBytes+=cost;try{return await run(owner);}finally{legacyCount--;legacyBytes-=cost;if(!legacyCount){owner.dispose();if(legacy===owner)legacy=null;}}}
function exportDrawingAssets(snapshot,options={}){if((snapshot.backdrop?.length||0)>65536){const geometry=snapshot.strokes.reduce((bytes,stroke)=>bytes+16+stroke.points.length*(stroke.pressures?24:16),24),pixels=options.png===false?0:Math.min(16*1024*1024,options.maxPixels||16*1024*1024),cost=(geometry+snapshot.backdrop.length)*2+Math.ceil(pixels*16/3);return temporary(cost,owner=>owner.run(snapshot,options));}return exporter().run(snapshot,options);}
async function normalizeGraphicsBytes(bytes,options={}){
 if(graphics.isBinary(bytes)&&bytes.byteLength>=24){const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(header.getUint32(8,true)<=65536&&header.getUint32(12,true)<50000&&header.getUint32(16,true)<50000)return exporter().normalize(bytes,options);}
 // Retire transient normalization memory before the editable graph is hydrated.
 // This owner never terminates an unrelated active drawing/export worker.
 const cost=bytes.byteLength*2;if(legacyCount>=2||legacyBytes+cost>512*1024*1024)throw Error('Another large drawing is opening. Try again shortly.');const owner=new DrawingExporter({idle:0});legacyCount++;legacyBytes+=cost;try{return await owner.normalize(bytes,options)}finally{owner.dispose();legacyCount--;legacyBytes-=cost;}
}
async function transformDrawingInk(strokes,from,to,options={}){
 let result;const local=async()=>{const {transformInkBinary}=require('./transform-ink.js');return transformInkBinary(await graphics.encodeBytesAsync({name:'Ink',aspect:1,strokes,backdrop:null},options),from,to,options);};if(typeof Worker==='undefined')result=await local();else try{result=await exporter().transform(strokes,from,to,options);}catch(error){if(options.signal?.aborted)throw error;result=await local();}
 let previous=-1;for(let i=0;i<result.indexes.length;i++){const index=result.indexes[i];if(index<=previous||index>=strokes.length)throw Error('Invalid transformed stroke identity.');previous=index;if(i%4096===4095)await graphics.yieldTask();}
 const changed=(await graphics.decodeAsync(result.bytes,{...options,owned:true,prepared:result,pressuresForStroke:index=>strokes[result.indexes[index]].pressures||null})).strokes;if(changed.length!==result.indexes.length)throw Error('Invalid transformed drawing length.');const replacements=new Map();
 for(let i=0;i<changed.length;i++){replacements.set(strokes[result.indexes[i]],changed[i]);if(i%4096===4095)await graphics.yieldTask();}return replacements;
}
function renderInk(request,options){return exporter().raster(request,options);}
function cancelInk(session){shared?.cancelInk(session);}
function holdDrawingWorker(){return exporter().hold();}
async function fingerprintStroke(stroke,options={}){const signatures=require('./stroke-signature.js');try{if(typeof Worker==='undefined')throw Error('Drawing worker unavailable.');const packet=await exporter().fingerprint([stroke],options),view=new DataView(packet.hashBytes.buffer,packet.hashBytes.byteOffset,8);return view.getUint32(0,true).toString(16).padStart(8,'0')+view.getUint32(4,true).toString(16).padStart(8,'0');}catch(error){if(options.signal?.aborted)throw error;return signatures.canonicalStrokeFingerprintAsync(stroke,graphics.yieldTask);}}
if(typeof window!=='undefined')globalThis.NoteMindDrawingExport={normalize:normalizeGraphicsBytes,fingerprintStroke};
module.exports={DrawingExporter,exportDrawingAssets,validSidecarEnvelope,normalizeGraphicsBytes,renderInk,cancelInk,holdDrawingWorker,transformDrawingInk,fingerprintStroke};
