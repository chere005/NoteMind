const graphics=require('./graphics-pane.js');
const {backdropReady}=require('./tablet/renderer/tabletBackdrop');
class DrawingExporter {
 constructor({worker=()=>new Worker(new URL('drawing-worker.js',document.baseURI)),pack=graphics.encodeBytesAsync,bitmap=async file=>{const image=await backdropReady(file);if(!image)throw Error('Could not load the drawing background.');return createImageBitmap(image);},timeout=120000,idle=10000}={}){this.factory=worker;this.pack=pack;this.bitmap=bitmap;this.timeout=timeout;this.idle=idle;this.queue=[];this.active=null;this.worker=null;this.running=false;this.nextId=1;this.disposed=false;this.idleTimer=null;}
 run(snapshot,options={}){
  if(this.disposed)return Promise.reject(Error('Drawing exporter is closed.'));
  if(this.queue.length+(this.active?1:0)>=4)return Promise.reject(Error('Too many drawing exports are pending.'));
  snapshot=options.normalize?snapshot:{...snapshot,strokes:snapshot.strokes.slice(),paper:{...snapshot.paper},region:{...snapshot.region},extent:snapshot.extent?{...snapshot.extent}:undefined};
  return new Promise((resolve,reject)=>{const controller=new AbortController(),job={id:this.nextId++,snapshot,options,resolve,reject,controller,done:false};job.abort=()=>{controller.abort();if(this.active===job){this.stopWorker();job.responseReject?.(Error('Drawing export cancelled.'));}else this.queue=this.queue.filter(value=>value!==job);this.finish(job,Error('Drawing export cancelled.'));};options.signal?.addEventListener('abort',job.abort,{once:true});if(options.signal?.aborted){job.abort();return;}this.queue.push(job);void this.pump();});
 }
 async normalize(bytes,options={}){if(this.disposed)throw Error('Drawing exporter is closed.');if(this.queue.length+(this.active?1:0)>=4)throw Error('Too many drawing exports are pending.');if(!options.owned){const copy=new Uint8Array(bytes.byteLength);for(let at=0;at<copy.length;at+=65536){if(options.signal?.aborted)throw Error('Drawing load cancelled.');copy.set(bytes.subarray(at,at+65536),at);await graphics.yieldTask();}bytes=copy;}return this.run({encodedBytes:bytes},{...options,normalize:true,png:false});}
 finish(job,error,value){if(job.done)return;job.done=true;job.options.signal?.removeEventListener('abort',job.abort);if(error)job.reject(error);else job.resolve(value);}
 stopWorker(){clearTimeout(this.idleTimer);this.idleTimer=null;this.worker?.terminate();this.worker=null;}
 getWorker(){clearTimeout(this.idleTimer);this.idleTimer=null;if(!this.worker)this.worker=this.factory();return this.worker;}
 async pump(){
  if(this.running)return;this.running=true;
  while(this.queue.length&&!this.disposed){const job=this.queue.shift();if(job.done)continue;this.active=job;const timer=setTimeout(()=>{job.controller.abort();this.stopWorker();job.responseReject?.(Error('Drawing export timed out.'));this.finish(job,Error('Drawing export timed out.'));},this.timeout);let bitmap=null;
   try{const {snapshot,options}=job,bytes=options.normalize?snapshot.encodedBytes:await this.pack({name:snapshot.name,aspect:snapshot.aspect,strokes:snapshot.strokes,backdrop:snapshot.backdrop,paper:snapshot.paper,extent:snapshot.extent},{signal:job.controller.signal});if(job.done||job.controller.signal.aborted)continue;
    if(options.png!==false&&snapshot.backdrop){bitmap=await this.bitmap(snapshot.backdrop);if(job.done||job.controller.signal.aborted)continue;}
    const worker=this.getWorker(),result=await new Promise((resolve,reject)=>{job.responseReject=reject;worker.onmessage=event=>{const value=event.data;if(value?.id!==job.id)return;if(value.error)reject(Error(value.error));else if((options.normalize&&(!ArrayBuffer.isView(value.bytes)||!graphics.isBinary(value.bytes)||!value.metadata))||(options.png!==false&&!/^data:image\/png;base64,[a-z0-9+/=\r\n]+$/i.test(value.png))||(options.sidecar&&!validSidecarEnvelope(value.sidecar)))reject(Error('Invalid drawing export response.'));else resolve(value);};worker.onerror=event=>{event.preventDefault?.();this.stopWorker();reject(Error(event.message||'Drawing export worker stopped.'));};worker.onmessageerror=()=>{this.stopWorker();reject(Error('Drawing export worker returned unreadable data.'));};worker.postMessage({id:job.id,bytes,normalize:!!options.normalize,bitmap,region:snapshot.region,png:options.png!==false,sidecar:!!options.sidecar,crop:!!options.crop,withPaper:options.withPaper!==false,maxPixels:options.maxPixels,maxDimension:options.maxDimension},bitmap?[bytes.buffer,bitmap]:[bytes.buffer]);bitmap=null;});
    this.finish(job,null,result);
   }catch(error){this.finish(job,error);}finally{bitmap?.close();clearTimeout(timer);job.responseReject=null;this.active=null;}
  }
  this.running=false;if(this.worker&&!this.disposed)this.idleTimer=setTimeout(()=>this.stopWorker(),this.idle);
 }
 dispose(){this.disposed=true;this.stopWorker();for(const job of [this.active,...this.queue])if(job){job.controller.abort();job.responseReject?.(Error('Drawing exporter is closed.'));this.finish(job,Error('Drawing exporter is closed.'));}this.queue=[];}
}
function validSidecarEnvelope(value){return typeof value==='string'&&value.length>0&&value.length%4===0&&value.length<=Math.ceil(graphics.MAX_BINARY_BYTES/3)*4&&/^[a-z0-9+/]+$/i.test(value.slice(0,Math.min(4,value.length)))&&/^[a-z0-9+/]*={0,2}$/i.test(value.slice(-4));}
let shared=null;
function exportDrawingAssets(snapshot,options){if(!shared){shared=new DrawingExporter();globalThis.addEventListener?.('pagehide',()=>{shared?.dispose();shared=null;},{once:true});}return shared.run(snapshot,options);}
function normalizeGraphicsBytes(bytes,options){if(!shared){shared=new DrawingExporter();globalThis.addEventListener?.('pagehide',()=>{shared?.dispose();shared=null;},{once:true});}return shared.normalize(bytes,options);}
globalThis.NoteMindDrawingExport={normalize:normalizeGraphicsBytes};
module.exports={DrawingExporter,exportDrawingAssets,validSidecarEnvelope,normalizeGraphicsBytes};
