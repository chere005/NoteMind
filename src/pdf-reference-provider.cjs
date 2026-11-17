const abort=()=>Object.assign(Error('PDF operation cancelled.'),{name:'AbortError'}),check=signal=>{if(signal?.aborted)throw abort();};
// PDF.js stays behind this injectable boundary; opening a document never renders a page.
function create({pdfjs,makeCanvas=()=>document.createElement('canvas'),baseURL,maxBytes=150*1024*1024,maxTextBytes=50*1024*1024}={}){
 if(!pdfjs?.getDocument)throw Error('PDF rendering is unavailable.');
 return {async open(source,{signal}={}){
  check(signal);const data=source?.data||source,password=source?.password;if(!(data instanceof Uint8Array)||data.byteLength>maxBytes)throw Error('Choose a PDF up to 150 MB.');
  const options={data,password,isEvalSupported:false,useSystemFonts:true,maxImageSize:16000000,canvasMaxAreaInBytes:64*1024*1024,stopAtErrors:true};if(baseURL){options.cMapUrl=new URL('./vendor/pdfjs/cmaps/',baseURL).href;options.cMapPacked=true;options.standardFontDataUrl=new URL('./vendor/pdfjs/standard_fonts/',baseURL).href;options.wasmUrl=new URL('./vendor/pdfjs/wasm/',baseURL).href;}
  const task=pdfjs.getDocument(options),cancel=()=>{void Promise.resolve(task.destroy()).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});let pdf;
  try{pdf=await task.promise;check(signal);}catch(error){await task.destroy().catch(()=>{});if(signal?.aborted)throw abort();throw error;}finally{signal?.removeEventListener('abort',cancel);}
  let closed=false;
  return {pageCount:pdf.numPages,bytes:()=>pdf.getData(),async close(){if(closed)return;closed=true;await task.destroy();},async page(number,{signal}={}){
   check(signal);if(closed)throw abort();const page=await pdf.getPage(number);if(signal?.aborted||closed){page.cleanup();throw abort();}const viewport=page.getViewport({scale:1}),view=page.view;
   return {width:viewport.width,height:viewport.height,rotation:page.rotate,crop:{x:view[0],y:view[1],width:view[2]-view[0],height:view[3]-view[1]},cleanup:()=>page.cleanup(),async text({signal}={}){check(signal);if(closed)throw abort();const reader=page.streamTextContent().getReader(),cancel=()=>{void reader.cancel(abort()).catch(()=>{});},parts=[];let bytes=0;signal?.addEventListener('abort',cancel,{once:true});try{for(;;){check(signal);if(closed)throw abort();const chunk=await reader.read();check(signal);if(closed)throw abort();if(chunk.done)break;for(const item of chunk.value.items){if(typeof item.str!=='string')continue;const part=item.str+(item.hasEOL?'\n':' ');bytes+=new TextEncoder().encode(part).byteLength;if(bytes>maxTextBytes)throw Error('PDF page text exceeds the text budget.');parts.push(part);}}return parts.join('').trim();}catch(error){if(signal?.aborted||closed)throw abort();throw error;}finally{signal?.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}},async render({width,height,scale,signal}){
    check(signal);if(closed)throw abort();if(![width,height].every(value=>Number.isInteger(value)&&value>0&&value<=4096)||width*height>16*1024*1024||!Number.isFinite(scale)||scale<=0||scale>8)throw Error('Invalid PDF render size.');const canvas=makeCanvas();canvas.width=width;canvas.height=height;let rendering;
    const cancel=()=>rendering?.cancel();signal?.addEventListener('abort',cancel,{once:true});
    try{rendering=page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale}),background:'#ffffff'});await rendering.promise;check(signal);if(closed)throw abort();const url=canvas.toDataURL('image/png'),data=url.slice(url.indexOf(',')+1),resource={width,height,data,byteLength:data.length,dispose(){this.data='';}};return resource;}
    catch(error){if(signal?.aborted||closed)throw abort();throw error;}
    finally{signal?.removeEventListener('abort',cancel);canvas.width=canvas.height=1;}
   }};
  }};
 }};
}
module.exports={create};
