const {check}=require('./pdf-reference-session.cjs');
const stopped=()=>Object.assign(Error('The original Notepad is no longer open.'),{name:'AbortError'});
const dataBytes=data=>Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
// Completed pages remain in their initiating Notepad; cancellation never starts another page or late insertion.
class PageImportController {
 constructor({render,recognize,commit,isOwnerOpen,maxPages=10000,maxBytes=199*1024*1024}){Object.assign(this,{render,recognize,commit,isOwnerOpen,maxPages,maxBytes});this.active=null;this.closed=false;}
 start({owner,pages,readText=false,signal,onProgress=()=>{}}){
  if(this.closed)return Promise.reject(Error('PDF importing is closed.'));if(this.active)return Promise.reject(Error('A page import is already running.'));
  if(!owner||!Array.isArray(pages)||!pages.length||pages.length>this.maxPages||pages.some(page=>!Number.isInteger(page)||page<1)||new Set(pages).size!==pages.length)return Promise.reject(Error('Choose valid PDF pages.'));
  const controller=new AbortController(),abort=()=>controller.abort(),request={owner,pages:[...pages],controller,promise:null,completed:[],bytes:0};if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});this.active=request;
  request.promise=this.run(request,readText,onProgress).finally(()=>{signal?.removeEventListener('abort',abort);if(this.active===request)this.active=null;});return request.promise;
 }
 assertCurrent(request){check(request.controller.signal);if(this.active!==request||!this.isOwnerOpen(request.owner))throw stopped();}
 async run(request,readText,onProgress){
  try{
   for(const page of request.pages){
    this.assertCurrent(request);onProgress({page,completed:request.completed.length,total:request.pages.length,phase:'Rendering page'});let lease;
    try{
     lease=await this.render(page,{signal:request.controller.signal});this.assertCurrent(request);const image=lease.value||lease;
     if(typeof image.data!=='string'||image.data.length%4!==0||!(/^[A-Za-z0-9+/]*={0,2}$/).test(image.data)||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>16*1024*1024)throw Error('Invalid imported page image.');
     const bytes=dataBytes(image.data);if(bytes<0||request.bytes+bytes>this.maxBytes)throw Error('These page images exceed the Notepad asset budget.');let text=image.text||'';
     if(readText&&text.replace(/\s/g,'').length<15){if(typeof this.recognize!=='function')throw Error('Image text reading is unavailable.');onProgress({page,completed:request.completed.length,total:request.pages.length,phase:'Reading page text'});const result=await this.recognize(image,{signal:request.controller.signal,page});this.assertCurrent(request);text=result.text||'';}
     this.assertCurrent(request);await this.commit(request.owner,{page,data:image.data,width:image.width,height:image.height,text},{signal:request.controller.signal});request.completed.push(page);request.bytes+=bytes;
     onProgress({page,completed:request.completed.length,total:request.pages.length,phase:'Page imported'});
    }finally{lease?.release?.();}
   }
   return {cancelled:false,completed:[...request.completed],bytes:request.bytes};
  }catch(error){if(error.name==='AbortError'||request.controller.signal.aborted)return {cancelled:true,completed:[...request.completed],bytes:request.bytes};throw Object.assign(error,{completed:[...request.completed],importedBytes:request.bytes});}
 }
 cancel(){this.active?.controller.abort();}
 async dispose(){this.closed=true;this.cancel();await this.active?.promise.catch(()=>{});}
}
module.exports={PageImportController,dataBytes};
