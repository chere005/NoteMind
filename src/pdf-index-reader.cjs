const {EventEmitter}=require('node:events'),os=require('node:os'),path=require('node:path');
const abort=()=>Object.assign(Error('PDF indexing cancelled.'),{name:'AbortError'});
// One background PDF source, separate from the user's reference, with only one
// raster page alive at a time. Foreground attachment preparation can interrupt it.
class PDFIndexReader{
 constructor({service,files,reader,maxBytes=384*1024*1024,maxPending=16,maxTextBytes=16*1024*1024}){Object.assign(this,{service,files,reader,maxBytes,maxPending,maxTextBytes});this.owner=Object.assign(new EventEmitter(),{isDestroyed:()=>this.closed});this.queue=[];this.active=null;this.bytes=0;this.closed=false;}
 hash(data,options){return this.files.call('hash',{data},options);}
 summary(file,options={}){return this.enqueue({file,summary:true},options);}
 read(data,options={}){return this.enqueue({data,summary:false},options);}
 enqueue(input,{signal,background=false,onProgress=()=>{}}={}){
  if(this.closed)return Promise.reject(Error('PDF indexing is closed.'));if(signal?.aborted)return Promise.reject(abort());const bytes=input.data?.length||0;if(this.queue.length+(this.active?1:0)>=this.maxPending||this.bytes+bytes>this.maxBytes)return Promise.reject(Error('PDF indexing is busy.'));
  return new Promise((resolve,reject)=>{const job={...input,bytes,signal,background,onProgress,resolve,reject,abort:null,preempted:false,controller:null,text:'',textBytes:0,nextPage:1,pageCount:null};job.abort=()=>{const at=this.queue.indexOf(job);if(at>=0){this.queue.splice(at,1);this.finish(job,abort());}else job.controller?.abort();};signal?.addEventListener('abort',job.abort,{once:true});this.bytes+=bytes;background?this.queue.push(job):this.queue.unshift(job);if(!background&&this.active?.background){this.active.preempted=true;this.active.controller.abort();}void this.pump();});
 }
 finish(job,error,value){this.bytes-=job.bytes;job.signal?.removeEventListener('abort',job.abort);job.data=null;job.text=null;error?job.reject(error):job.resolve(value);}
 async pump(){if(this.active||this.closed)return;while(this.queue.length&&!this.closed){const job=this.active=this.queue.shift();job.preempted=false;job.controller=new AbortController();try{const value=await this.run(job);this.finish(job,null,value);}catch(error){if(job.preempted&&!job.signal?.aborted&&!this.closed)this.queue.push(job);else this.finish(job,error);}finally{this.active=null;}}}
 async run(job){
  const signal=job.controller.signal;signal.throwIfAborted();let file=job.file;if(!file){const prepared=await this.files.call('attachment',{name:'source.pdf',data:job.data,directory:path.join(os.tmpdir(),'notemind-previews')},{signal});file=prepared.path;}signal.throwIfAborted();const source=await this.service.open(this.owner,{file});
  try{
   if(job.summary){const first=await this.service.page(this.owner,source.id,1,{thumbnail:true,maxDimension:256,requestId:'summary'});signal.throwIfAborted();return{pages:source.pageCount,thumbnail:first.data};}
   if(job.pageCount!==null&&job.pageCount!==source.pageCount)throw Error('The indexed PDF source changed.');job.pageCount=source.pageCount;
   for(let page=job.nextPage;page<=source.pageCount;page++){
    signal.throwIfAborted();try{job.onProgress({page,pages:source.pageCount});}catch{}
    let value;const textId='index-pdf-text-'+require('node:crypto').randomUUID(),cancelText=()=>this.service.cancel(this.owner,source.id,textId);signal.addEventListener('abort',cancelText,{once:true});try{value=await this.service.text(this.owner,source.id,page,{requestId:textId});}finally{signal.removeEventListener('abort',cancelText);}signal.throwIfAborted();if(value.replace(/\s/g,'').length<15){const id='index-pdf-'+require('node:crypto').randomUUID(),cancel=()=>{this.service.cancel(this.owner,source.id,id);};signal.addEventListener('abort',cancel,{once:true});try{const image=await this.service.page(this.owner,source.id,page,{maxDimension:2048,requestId:id});signal.throwIfAborted();value=(await this.reader.read(Buffer.from(image.data,'base64'),{id,language:'auto',priority:job.background?'background':'foreground',signal})).text;}finally{signal.removeEventListener('abort',cancel);}}
    signal.throwIfAborted();const size=job.textBytes+Buffer.byteLength(value,'utf8')+2;if(size>this.maxTextBytes)throw Error('This PDF has too much text to index at once.');job.text+=(page===1?'':'\n\n')+value;job.textBytes=size;job.nextPage=page+1;
   }
   return{text:job.text};
  }finally{try{await this.service.close(this.owner,source.id);}catch(error){if(!this.closed)throw error;}}
 }
 async dispose(){this.closed=true;for(const job of this.queue.splice(0))this.finish(job,abort());this.active?.controller.abort();this.owner.emit('destroyed');await this.service.dispose();}
}
module.exports={PDFIndexReader};
