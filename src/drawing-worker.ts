import graphics from './graphics-pane.js'
import {transformInkBinary} from './transform-ink.js'
import {inspectBinaryDrawing,cropBinaryDrawing,paintBinaryDrawing} from './binary-drawing.js'
import {pressureScale} from '@notemind/core'
import {snapshotDrawing,rasterDrawing} from './tablet/renderer/drawingSnapshot'
import {paintStrokesYielding} from './tablet/renderer/tabletPage'
import {paintPaper,inkOn} from './tablet/renderer/tabletPaper'
import {paintBackdrop} from './tablet/renderer/tabletBackdrop'
import {fingerprint,canonicalStrokeFingerprintAsync} from './stroke-signature.js'
import {InkRaster} from './tablet/renderer/inkRaster'

async function pngOf(canvas:OffscreenCanvas):Promise<string>{
 const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer())
 if(typeof (bytes as any).toBase64==='function')return 'data:image/png;base64,'+(bytes as any).toBase64()
 const parts:string[]=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)))
 return 'data:image/png;base64,'+btoa(parts.join(''))
}
async function asciiBytes(text:string,pause:()=>Promise<void>){const bytes=new Uint8Array(text.length),encode=new TextEncoder();for(let at=0;at<text.length;at+=65536){bytes.set(encode.encode(text.slice(at,at+65536)),at);await pause()}return bytes}
async function editable(source:any,region:any,signal:AbortSignal,pause:()=>Promise<void>){
 const result=await graphics.cropAsync(source,region,{signal,yieldControl:pause});delete result.extent
 if(source.backdrop&&region.x===0&&region.y===0&&region.width===1&&region.height===1)result.backdrop=source.backdrop
 if(source.backdrop&&(region.x!==0||region.y!==0||region.width!==1||region.height!==1)){
  const w=1000,h=1000/source.aspect
  result.backdrop='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${region.x*w} ${region.y*h} ${region.width*w} ${region.height*h}"><image href="${source.backdrop}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`)
 }
 return result
}
const ink=new InkRaster();let activeInk:any=null,pendingInk:any=null
async function pumpInk(){
 if(activeInk)return
 while(pendingInk){const job=pendingInk;pendingInk=null;let complete:any;const done=new Promise<void>(resolve=>complete=resolve),active=activeInk={job,cancelled:false,done}
  try{const result=await ink.render(job.ink,()=>active.cancelled),value:any=result,tiles=[...(value.tiles||[]),...(value.preview?.fixed||[]),...(value.preview?.ink?[value.preview.ink]:[])];self.postMessage({id:job.id,...result},tiles.map((tile:any)=>tile.bitmap))}
  catch(error){self.postMessage({id:job.id,error:error instanceof Error?error.message:String(error)})}
  finally{activeInk=null;complete()}
 }
}
function acceptInk(job:any){if(pendingInk)self.postMessage({id:pendingInk.id,cancelled:true,accepted:false});pendingInk=job;if(activeInk)activeInk.cancelled=true;void pumpInk()}
const background=new Map<number,AbortController>();let queue=Promise.resolve()
const sidecarAcks=new Map<number,{index:number;resolve:()=>void;reject:(error:Error)=>void}>()
async function sidecarChunk(job:any,index:number,text:string,signal:AbortSignal){let abort:any;try{await new Promise<void>((resolve,reject)=>{sidecarAcks.set(job.id,{index,resolve,reject});abort=()=>{sidecarAcks.delete(job.id);reject(Error('Drawing export cancelled.'))};signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return}self.postMessage({id:job.id,index,sidecarChunk:text})});}finally{signal.removeEventListener('abort',abort);sidecarAcks.delete(job.id)}}
async function runJob(job:any){
 const controller=new AbortController();background.set(job.id,controller);let canvas:OffscreenCanvas|null=null
 const pause=async()=>{if(controller.signal.aborted)throw Error('Drawing export cancelled.');await graphics.yieldTask();const visible=activeInk;if(visible)await visible.done;if(controller.signal.aborted)throw Error('Drawing export cancelled.')}
 try{
  if(job?.transform){
   const result=await transformInkBinary(job.bytes,job.transform.from,job.transform.to,{signal:controller.signal,yieldControl:pause})
   self.postMessage({id:job.id,...result},[result.bytes.buffer,result.indexes.buffer,result.hashBytes.buffer]);return
  }
  if(job?.normalize){
   if(!Number.isSafeInteger(job.id)||!job.bytes)throw Error('Invalid drawing load request.')
   const source=graphics.isBinary(job.bytes)?await graphics.decodeAsync(job.bytes,{signal:controller.signal,yieldControl:pause}):graphics.decode(job.bytes),{strokes,...metadata}=source,bytes=await graphics.encodeBytesAsync({...source,backdrop:null},{signal:controller.signal,yieldControl:pause}),hashBytes=new Uint8Array(strokes.length*8),view=new DataView(hashBytes.buffer);let work=0
   for(let i=0;i<strokes.length;i++){const hash=await canonicalStrokeFingerprintAsync(strokes[i],pause);view.setUint32(i*8,parseInt(hash.slice(0,8),16),true);view.setUint32(i*8+4,parseInt(hash.slice(8),16),true);work+=strokes[i].points.length+1;if(work>=8192){work=0;await pause()}}
   const backdropBytes=source.backdrop?await asciiBytes(source.backdrop,pause):null,backdropHash=source.backdrop?fingerprint(source.backdrop):null;metadata.backdrop=null
   self.postMessage({id:job.id,bytes,metadata,hashBytes,backdropBytes,backdropHash},[bytes.buffer,hashBytes.buffer,...(backdropBytes?[backdropBytes.buffer]:[])]);return
  }
  if(!job||!Number.isSafeInteger(job.id)||!job.bytes||!job.region||![job.region.x,job.region.y,job.region.width,job.region.height].every(Number.isFinite)||job.region.width<=0||job.region.height<=0)throw Error('Invalid drawing export request.')
  if(graphics.isBinary(job.bytes)&&new DataView(job.bytes.buffer,job.bytes.byteOffset,job.bytes.byteLength).getUint32(16,true)>=50000){
   const source=await inspectBinaryDrawing(job.bytes,{signal:controller.signal,yieldControl:pause}),snapshot=snapshotDrawing({...source.metadata,strokes:[],viewport:job.region}),result:any={id:job.id}
   if(job.png){if(source.metadata.backdrop&&!job.bitmap)throw Error('Could not load the drawing background.');canvas=await rasterDrawing(snapshot,job.withPaper!==false,{canvas:()=>new OffscreenCanvas(1,1),paintPaper,paintBackdrop,paintStrokes:(ctx:any)=>paintBinaryDrawing(ctx,source,(x:number,y:number)=>({x:x*1000,y:y*1000/source.metadata.aspect}),1,job.withPaper!==false?(colour:string)=>inkOn(source.metadata.paper,colour):null,pressureScale,{signal:controller.signal,yieldControl:pause}),inkOn,backdropReady:async()=>job.bitmap,maxPixels:job.maxPixels,maxDimension:job.maxDimension});if(controller.signal.aborted)throw Error('Drawing export cancelled.');result.png=await pngOf(canvas!)}
   if(job.sidecar){const bytes=job.crop?await cropBinaryDrawing(source,job.region,{signal:controller.signal,yieldControl:pause}):source.bytes;let index=0,length=0;for(let at=0;at<bytes.length;at+=196608){await pause();const text=graphics.bytesBase64(bytes.subarray(at,at+196608));length+=text.length;await sidecarChunk(job,index++,text,controller.signal)}result.sidecarLength=length}
   self.postMessage(result);return
  }
  const source=await graphics.decodeAsync(job.bytes,{signal:controller.signal,yieldControl:pause}),snapshot=snapshotDrawing({...source,viewport:job.region}),result:any={id:job.id}
  if(job.png){
   if(source.backdrop&&!job.bitmap)throw Error('Could not load the drawing background.')
   canvas=await rasterDrawing(snapshot,job.withPaper!==false,{canvas:()=>new OffscreenCanvas(1,1),paintPaper,paintBackdrop,paintStrokes:(...args:any[])=>paintStrokesYielding(args[0],args[1],args[2],args[3],args[4],args[5],args[6],{cancelled:()=>controller.signal.aborted,yieldControl:pause}),inkOn,backdropReady:async()=>job.bitmap,maxPixels:job.maxPixels,maxDimension:job.maxDimension})
   if(controller.signal.aborted)throw Error('Drawing export cancelled.');result.png=await pngOf(canvas!)
  }
  if(job.sidecar){
   const selected=job.crop?await editable(source,job.region,controller.signal,pause):source,bytes=await graphics.encodeBytesAsync(selected,{signal:controller.signal,yieldControl:pause});let index=0,length=0
   for(let at=0;at<bytes.length;at+=196608){await pause();const text=graphics.bytesBase64(bytes.subarray(at,at+196608));length+=text.length;await sidecarChunk(job,index++,text,controller.signal)}result.sidecarLength=length
  }
  self.postMessage(result)
 }catch(error){self.postMessage({id:job?.id,error:error instanceof Error?error.message:String(error)})}
 finally{background.delete(job.id);job?.bitmap?.close();if(canvas){canvas.width=1;canvas.height=1}job.bytes=null;job.bitmap=null}
}
self.onmessage=event=>{
 const job=event.data
 if(job?.sidecarAck){const held=sidecarAcks.get(job.sidecarAck);if(held?.index===job.index){sidecarAcks.delete(job.sidecarAck);held.resolve()}return}
 if(job?.inkCancel){if(activeInk?.job.ink.session===job.inkCancel)activeInk.cancelled=true;if(pendingInk?.ink.session===job.inkCancel){self.postMessage({id:pendingInk.id,cancelled:true,accepted:false});pendingInk=null}return}
 if(job?.cancelExport){background.get(job.cancelExport)?.abort();return}
 if(job?.ink){acceptInk(job);return}
 if(job?.transform){void runJob(job);return}
 queue=queue.catch(()=>{}).then(()=>runJob(job))
}
