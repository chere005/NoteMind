// One-page image admission/embedding. Only compressed PDF streams survive a page.
const fs=require('node:fs/promises'),{parentPort,workerData}=require('node:worker_threads');
const {decodeScanPNG,crc}=require('./scan-png.cjs');
const limits=require('./scan-limits.js');
const cancelled=()=>Object.assign(Error('Scan preparation cancelled.'),{name:'AbortError'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function pngThumbnail(image,rotation=0){
 const swap=rotation%180!==0,viewWidth=swap?image.height:image.width,viewHeight=swap?image.width:image.height,scale=Math.min(1,320/viewWidth,320/viewHeight),width=Math.max(1,Math.round(viewWidth*scale)),height=Math.max(1,Math.round(viewHeight*scale)),rows=Buffer.alloc((width*3+1)*height),pixel=(x,y,c)=>{const at=y*image.width+x,alpha=image.alphaChannel?image.alphaChannel[at]/255:1;return image.rgbChannel[at*3+c]*alpha+255*(1-alpha)};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const u=(x+.5)/width,v=(y+.5)/height,[su,sv]=rotation===90?[v,1-u]:rotation===180?[1-u,1-v]:rotation===270?[1-v,u]:[u,v],sx=Math.max(0,Math.min(image.width-1,su*image.width-.5)),sy=Math.max(0,Math.min(image.height-1,sv*image.height-.5)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(image.width-1,x0+1),y1=Math.min(image.height-1,y0+1),fx=sx-x0,fy=sy-y0,o=y*(width*3+1)+1+x*3;for(let c=0;c<3;c++)rows[o+c]=Math.round((pixel(x0,y0,c)*(1-fx)+pixel(x1,y0,c)*fx)*(1-fy)+(pixel(x0,y1,c)*(1-fx)+pixel(x1,y1,c)*fx)*fy);}
 const chunk=(type,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out},header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',require('node:zlib').deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
// Image-size reads EXIF without decoding pixel channels; pdf-lib otherwise ignores it.
function imagePlacement(width,height,orientation=1,rotation=0){
 if(![0,90,180,270].includes(rotation))throw Error('Invalid scan rotation.');
 const base=({1:[1,0,0,1,0,0],2:[-1,0,0,1,1,0],3:[-1,0,0,-1,1,1],4:[1,0,0,-1,0,1],5:[0,-1,-1,0,1,1],6:[0,-1,1,0,0,1],7:[0,1,1,0,0,0],8:[0,1,-1,0,1,0]})[orientation]||[1,0,0,1,0,0],turn=({0:[1,0,0,1,0,0],90:[0,-1,1,0,0,1],180:[-1,0,0,-1,1,1],270:[0,1,-1,0,1,0]})[rotation];
 const matrix=[turn[0]*base[0]+turn[2]*base[1],turn[1]*base[0]+turn[3]*base[1],turn[0]*base[2]+turn[2]*base[3],turn[1]*base[2]+turn[3]*base[3],turn[0]*base[4]+turn[2]*base[5]+turn[4],turn[1]*base[4]+turn[3]*base[5]+turn[5]],swap=!!matrix[1],effectiveWidth=swap?height:width,effectiveHeight=swap?width:height,scale=Math.min(204/25.4*72/effectiveWidth,290/25.4*72/effectiveHeight),w=effectiveWidth*scale,h=effectiveHeight*scale,x=(210/25.4*72-w)/2,y=(297/25.4*72-h)/2;
 return[matrix[0]*w,matrix[1]*h,matrix[2]*w,matrix[3]*h,matrix[4]*w+x,matrix[5]*h+y];
}
async function writeScanPDF(packet,{check=()=>{},onPage=()=>{}}={}){
 if(require('pdf-lib/package.json').version!=='1.17.1')throw Error('Unsupported scan PDF writer version.');
 const {PDFDocument,PDFImage,PngEmbedder,PDFName,PDFRawStream,pushGraphicsState,popGraphicsState,concatTransformationMatrix,drawObject}=require('pdf-lib'),{imageSize}=require('image-size');
 limits.assertPageCount(packet.pages?.length,{allowEmpty:false});const doc=await PDFDocument.create();doc.setTitle('Scan');let compressed=0;
 for(let index=0;index<packet.pages.length;index++){
  check();const source=packet.pages[index];if(![0,90,180,270].includes(source.rotation??0))throw Error('Invalid scan rotation.');let bytes=await fs.readFile(source.file);check();const info=await limits.validateBytes(bytes,{signal:{get aborted(){try{check();return false}catch{return true}}}});if(info.mime!==source.mime)throw Error('Scan image type changed.');
  let image,sourceReleased=false;if(info.mime==='image/png'){const channels=await decodeScanPNG(bytes,{check});if(bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&typeof bytes.buffer.transfer==='function'){bytes.buffer.transfer(0);sourceReleased=true;}bytes=null;if(index===0&&packet.thumbnail){check();await fs.writeFile(packet.thumbnail,pngThumbnail(channels,source.rotation??0),{flag:'wx',mode:0o600});check();}const ref=doc.context.nextRef();image=PDFImage.of(ref,doc,new PngEmbedder(channels));doc.images.push(image);}else image=await doc.embedJpg(bytes);let orientation=1;if(info.mime==='image/jpeg')orientation=imageSize(bytes).orientation||1;
  check();await image.embed();check();if(image.embedder!==undefined)throw Error('Scan image channels were retained after embedding.');
  const page=doc.addPage([210/25.4*72,297/25.4*72]),name=page.node.newXObject('Image',image.ref);page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...imagePlacement(image.width,image.height,orientation,source.rotation??0)),drawObject(name),popGraphicsState());
  // Context owns encoded image/alpha streams only. Count immediately, before
  // accepting another image; PDF serialization has a separate exact final cap.
  let total=0;for(const [,object]of doc.context.enumerateIndirectObjects())if(object instanceof PDFRawStream){const filter=object.dict.get(PDFName.of('Filter'));if(filter)total+=object.getContentsSize();}
  compressed=total;if(compressed>limits.ENTRY_BYTES)throw Error('The generated scan PDF exceeds the 50 MiB attachment limit.');
  bytes=null;await onPage({index,compressed,embedderReleased:image.embedder===undefined,sourceReleased});await tick();check();
 }
 const output=await doc.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:16});check();limits.assertPDFSize(output.byteLength);await fs.writeFile(packet.output,output,{flag:'wx',mode:0o600});check();return {bytes:output.byteLength,pages:packet.pages.length,compressed};
}
if(parentPort){const flag=workerData?.cancel?new Int32Array(workerData.cancel):null,check=()=>{if(flag&&Atomics.load(flag,0))throw cancelled()},onPage=workerData.telemetry?stage=>parentPort.postMessage({telemetry:{...stage,memory:process.memoryUsage(),heapLimit:require('node:v8').getHeapStatistics().heap_size_limit}}):undefined;writeScanPDF(workerData,{check,onPage}).then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:{message:error.message,name:error.name}}));}
module.exports={writeScanPDF,imagePlacement,pngThumbnail};
