// One-page image admission/embedding. Only compressed PDF streams survive a page.
const fs=require('node:fs/promises'),{parentPort,workerData}=require('node:worker_threads');
const {decodeScanPNG}=require('./scan-png.cjs');
const limits=require('./scan-limits.js');
const cancelled=()=>Object.assign(Error('Scan preparation cancelled.'),{name:'AbortError'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Image-size reads EXIF without decoding pixel channels; pdf-lib otherwise ignores it.
function imagePlacement(width,height,orientation=1){
 const swap=orientation>=5&&orientation<=8,scale=Math.min(204/25.4*72/(swap?height:width),290/25.4*72/(swap?width:height)),w=width*scale,h=height*scale,x=(210/25.4*72-(swap?h:w))/2,y=(297/25.4*72-(swap?w:h))/2;
 // Affine maps the image's unit square (PDF bottom-left) to its oriented box.
 const transforms={1:[w,0,0,h,x,y],2:[-w,0,0,h,x+w,y],3:[-w,0,0,-h,x+w,y+h],4:[w,0,0,-h,x,y+h],5:[0,-w,-h,0,x+h,y+w],6:[0,-w,h,0,x,y+w],7:[0,w,h,0,x,y],8:[0,w,-h,0,x+h,y]};
 return transforms[orientation]||transforms[1];
}
async function writeScanPDF(packet,{check=()=>{},onPage=()=>{}}={}){
 if(require('pdf-lib/package.json').version!=='1.17.1')throw Error('Unsupported scan PDF writer version.');
 const {PDFDocument,PDFImage,PngEmbedder,PDFName,PDFRawStream,pushGraphicsState,popGraphicsState,concatTransformationMatrix,drawObject}=require('pdf-lib'),{imageSize}=require('image-size');
 limits.assertPageCount(packet.pages?.length,{allowEmpty:false});const doc=await PDFDocument.create();doc.setTitle('Scan');let compressed=0;
 for(let index=0;index<packet.pages.length;index++){
  check();const source=packet.pages[index];let bytes=await fs.readFile(source.file);check();const info=await limits.validateBytes(bytes,{signal:{get aborted(){try{check();return false}catch{return true}}}});if(info.mime!==source.mime)throw Error('Scan image type changed.');
  let image;if(info.mime==='image/png'){const channels=await decodeScanPNG(bytes,{check});const ref=doc.context.nextRef();image=PDFImage.of(ref,doc,new PngEmbedder(channels));doc.images.push(image);}else image=await doc.embedJpg(bytes);let orientation=1;if(info.mime==='image/jpeg')orientation=imageSize(bytes).orientation||1;
  check();await image.embed();check();if(image.embedder!==undefined)throw Error('Scan image channels were retained after embedding.');
  const page=doc.addPage([210/25.4*72,297/25.4*72]),name=page.node.newXObject('Image',image.ref);page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...imagePlacement(image.width,image.height,orientation)),drawObject(name),popGraphicsState());
  // Context owns encoded image/alpha streams only. Count immediately, before
  // accepting another image; PDF serialization has a separate exact final cap.
  let total=0;for(const [,object]of doc.context.enumerateIndirectObjects())if(object instanceof PDFRawStream){const filter=object.dict.get(PDFName.of('Filter'));if(filter)total+=object.getContentsSize();}
  compressed=total;if(compressed>limits.ENTRY_BYTES)throw Error('The generated scan PDF exceeds the 50 MiB attachment limit.');
  bytes=null;await onPage({index,compressed,embedderReleased:image.embedder===undefined});await tick();check();
 }
 const output=await doc.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:16});check();limits.assertPDFSize(output.byteLength);await fs.writeFile(packet.output,output,{flag:'wx',mode:0o600});check();return {bytes:output.byteLength,pages:packet.pages.length,compressed};
}
if(parentPort){const flag=workerData?.cancel?new Int32Array(workerData.cancel):null,check=()=>{if(flag&&Atomics.load(flag,0))throw cancelled()};writeScanPDF(workerData,{check}).then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:{message:error.message,name:error.name}}));}
module.exports={writeScanPDF,imagePlacement};
