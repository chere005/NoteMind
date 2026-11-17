const {ResourceCache}=require('./pdf-reference-cache.cjs');
const aborted=()=>Object.assign(Error('PDF operation cancelled.'),{name:'AbortError'});
const check=signal=>{if(signal?.aborted)throw aborted();};
const closeDocument=document=>Promise.resolve(document?.close?.()).catch(()=>{});
class ReferenceSession {
 constructor(provider,{pageBytes=64*1024*1024,thumbnailBytes=16*1024*1024,maxPages=10000,maxPending=32}={}){
  Object.assign(this,{provider,maxPages,maxPending});this.pages=new ResourceCache(pageBytes,32);this.thumbnails=new ResourceCache(thumbnailBytes,128);this.document=null;this.identity=null;this.generation=0;this.queue=[];this.active=null;this.sizes=new Map();this.loadController=null;this.openRequest=0;
 }
 async open(source,{identity,signal}={}){
  if(typeof identity!=='string'||!identity||identity.length>128)throw Error('Invalid PDF source identity.');check(signal);const request=++this.openRequest;await this.close(false);check(signal);if(request!==this.openRequest)throw aborted();const generation=++this.generation,controller=this.loadController=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  try{
   const document=await this.provider.open(source,{signal:controller.signal});
   if(controller.signal.aborted||generation!==this.generation){await closeDocument(document);throw aborted();}
   if(!Number.isInteger(document.pageCount)||document.pageCount<1||document.pageCount>this.maxPages){await closeDocument(document);throw Error('This PDF has an unsupported page count.');}
   this.document=document;this.identity=identity;return {identity,pageCount:document.pageCount};
  }finally{signal?.removeEventListener('abort',abort);if(this.loadController===controller)this.loadController=null;}
 }
 pageNumber(page){if(!this.document)throw Error('Open a PDF first.');if(!Number.isInteger(page)||page<1||page>this.document.pageCount)throw Error('Invalid PDF page.');}
 size(page,value){if(!value||![value.width,value.height].every(n=>Number.isFinite(n)&&n>0&&n<=1000000))throw Error('Invalid PDF page dimensions.');const rotation=((value.rotation||0)%360+360)%360;if(![0,90,180,270].includes(rotation))throw Error('Unsupported PDF page rotation.');const result={width:value.width,height:value.height,rotation,crop:value.crop};this.sizes.set(page,result);return result;}
 async info(page,{signal}={}){
  this.pageNumber(page);check(signal);if(this.sizes.has(page))return this.sizes.get(page);const document=this.document,generation=this.generation,handle=await document.page(page,{signal});
  try{check(signal);if(generation!==this.generation)throw aborted();return this.size(page,handle);}finally{handle.cleanup?.();}
 }
 render(page,{thumbnail=false,maxDimension=thumbnail?256:2048,signal}={}){
  try{this.pageNumber(page);check(signal);if(!Number.isInteger(maxDimension)||maxDimension<16||maxDimension>4096)throw Error('Invalid PDF render size.');}catch(error){return Promise.reject(error);}
  const key=[this.identity,page,maxDimension].join(':'),cache=thumbnail?this.thumbnails:this.pages,hit=cache.lease(key);if(hit)return Promise.resolve(hit);
  if(this.queue.length>=this.maxPending)return Promise.reject(Error('PDF rendering is busy.'));
  const controller=new AbortController(),generation=this.generation;
  return new Promise((resolve,reject)=>{
   const job={page,thumbnail,maxDimension,key,cache,controller,generation,resolve,reject,signal,abort:null};
   job.abort=()=>{controller.abort();const at=this.queue.indexOf(job);if(at>=0){this.queue.splice(at,1);signal?.removeEventListener('abort',job.abort);reject(aborted());}};signal?.addEventListener('abort',job.abort,{once:true});
   if(thumbnail)this.queue.push(job);else{const at=this.queue.findIndex(other=>other.thumbnail);this.queue.splice(at<0?this.queue.length:at,0,job);if(this.active?.thumbnail)this.active.controller.abort();}this.pump();
  });
 }
 pump(){if(this.active||!this.document||!this.queue.length)return;const job=this.active=this.queue.shift();void this.run(job).then(job.resolve,job.reject).finally(()=>{job.signal?.removeEventListener('abort',job.abort);if(this.active===job)this.active=null;this.pump();});}
 async run(job){
  check(job.controller.signal);if(job.generation!==this.generation)throw aborted();const hit=job.cache.lease(job.key);if(hit)return hit;const document=this.document,handle=await document.page(job.page,{signal:job.controller.signal});let resource;
  try{
   check(job.controller.signal);const size=this.size(job.page,handle),maxPixels=Math.min(job.cache.maxBytes/4,16*1024*1024),scale=Math.min(8,job.maxDimension/Math.max(size.width,size.height),Math.sqrt(maxPixels/(size.width*size.height))),width=Math.max(1,Math.floor(size.width*scale)),height=Math.max(1,Math.floor(size.height*scale));
   resource=await handle.render({width,height,scale,thumbnail:job.thumbnail,signal:job.controller.signal});
   check(job.controller.signal);if(job.generation!==this.generation)throw aborted();
   if(!resource||![resource.width,resource.height].every(n=>Number.isInteger(n)&&n>0)||resource.width*resource.height>maxPixels)throw Error('Invalid PDF render result.');
   const bytes=Math.max(resource.width*resource.height*4,Number(resource.byteLength)||0);const published=resource;resource=null;job.cache.put(job.key,published,bytes);return job.cache.lease(job.key);
  }finally{resource?.dispose?.();handle.cleanup?.();}
 }
 async close(cancelOpen=true){
  if(cancelOpen)this.openRequest++;this.generation++;this.loadController?.abort();this.loadController=null;this.active?.controller.abort();for(const job of this.queue.splice(0)){job.signal?.removeEventListener('abort',job.abort);job.reject(aborted());}
  const document=this.document;this.document=null;this.identity=null;this.pages.clear();this.thumbnails.clear();this.sizes.clear();await closeDocument(document);
 }
 stats(){return {identity:this.identity,pageCount:this.document?.pageCount||0,pending:this.queue.length,active:!!this.active,pages:this.pages.stats(),thumbnails:this.thumbnails.stats(),knownSizes:this.sizes.size};}
}
module.exports={ReferenceSession,aborted,check};
