// One-page image admission/embedding. Only compressed PDF streams survive a page.
const fs=require('node:fs/promises'),{parentPort,workerData}=require('node:worker_threads');
const {decodeScanPNG}=require('./scan-png.cjs');
const limits=require('./scan-limits.js');
const cancelled=()=>Object.assign(Error('Scan preparation cancelled.'),{name:'AbortError'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
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
  check();const source=packet.pages[index];let bytes=await fs.readFile(source.file);check();const info=await limits.validateBytes(bytes,{signal:{get aborted(){try{check();return false}catch{return true}}}});if(info.mime!==source.mime)throw Error('Scan image type changed.');
  let image;if(info.mime==='image/png'){const channels=await decodeScanPNG(bytes,{check});const ref=doc.context.nextRef();image=PDFImage.of(ref,doc,new PngEmbedder(channels));doc.images.push(image);}else image=await doc.embedJpg(bytes);let orientation=1;if(info.mime==='image/jpeg')orientation=imageSize(bytes).orientation||1;
  check();await image.embed();check();if(image.embedder!==undefined)throw Error('Scan image channels were retained after embedding.');
  const page=doc.addPage([210/25.4*72,297/25.4*72]),name=page.node.newXObject('Image',image.ref);page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...imagePlacement(image.width,image.height,orientation,source.rotation??0)),drawObject(name),popGraphicsState());
  // Context owns encoded image/alpha streams only. Count immediately, before
  // accepting another image; PDF serialization has a separate exact final cap.
  let total=0;for(const [,object]of doc.context.enumerateIndirectObjects())if(object instanceof PDFRawStream){const filter=object.dict.get(PDFName.of('Filter'));if(filter)total+=object.getContentsSize();}
  compressed=total;if(compressed>limits.ENTRY_BYTES)throw Error('The generated scan PDF exceeds the 50 MiB attachment limit.');
  bytes=null;await onPage({index,compressed,embedderReleased:image.embedder===undefined});await tick();check();
 }
 const output=await doc.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:16});check();limits.assertPDFSize(output.byteLength);await fs.writeFile(packet.output,output,{flag:'wx',mode:0o600});check();return {bytes:output.byteLength,pages:packet.pages.length,compressed};
}
if(parentPort){const flag=workerData?.cancel?new Int32Array(workerData.cancel):null,check=()=>{if(flag&&Atomics.load(flag,0))throw cancelled()},onPage=workerData.telemetry?stage=>parentPort.postMessage({telemetry:{...stage,memory:process.memoryUsage(),heapLimit:require('node:v8').getHeapStatistics().heap_size_limit}}):undefined;writeScanPDF(workerData,{check,onPage}).then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:{message:error.message,name:error.name}}));}
module.exports={writeScanPDF,imagePlacement};
