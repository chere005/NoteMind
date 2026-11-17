import {textOfBlocks} from './pdf-text.mjs';
import * as pdfjs from './vendor/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
const fromBase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
window.documentTools={
 async image(data,type,clean=false){const image=new Image();image.src='data:'+type+';base64,'+data;await image.decode();const c=document.createElement('canvas');const scale=Math.min(1,2400/Math.max(image.width,image.height));c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);if(clean){const worker=new Worker(new URL('./paper-worker.js',import.meta.url));try{const ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,c.width,c.height);const result=await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data);worker.onerror=e=>reject(Error(e.message));worker.postMessage({id:1,width:c.width,height:c.height,pixels:pixels.data.buffer},[pixels.data.buffer])});if(result.cleaned)ctx.putImageData(new ImageData(new Uint8ClampedArray(result.pixels),c.width,c.height),0,0);}finally{worker.terminate()}}return {data:c.toDataURL('image/png').split(',')[1],width:c.width,height:c.height};},
 async pdf(data,password){
  const task=pdfjs.getDocument({data:fromBase64(data),password,cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href,useSystemFonts:true,isEvalSupported:false});
  try{const pdf=await task.promise;const pages=[];let imageBytes=0;if(pdf.numPages>300)throw Error('Import up to 300 pages at a time.');
   for(let index=1;index<=pdf.numPages;index++){const page=await pdf.getPage(index),viewport=page.getViewport({scale:Math.min(2,1800/Math.max(page.getViewport({scale:1}).width,page.getViewport({scale:1}).height))}),content=await page.getTextContent();
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const blocks=content.items.filter(i=>'str'in i&&i.str.trim()).map(i=>{const t=pdfjs.Util.transform(viewport.transform,i.transform),h=Math.hypot(t[2],t[3]);return {text:i.str,x:t[4]/viewport.width,y:(t[5]-h)/viewport.height,width:i.width*viewport.scale/viewport.width,height:h/viewport.height};});const image=canvas.toDataURL('image/png').split(',')[1];imageBytes+=image.length*.75;if(imageBytes>150*1024*1024)throw Error('These page images exceed 150 MB. Open a smaller section of the PDF.');pages.push({page:index,text:textOfBlocks(blocks),blocks,width:canvas.width,height:canvas.height,image});canvas.width=canvas.height=1;page.cleanup();
   }return pages;
  }finally{await task.destroy();}
 }
};
