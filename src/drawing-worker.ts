import graphics from './graphics-pane.js'
import {snapshotDrawing,rasterDrawing} from './tablet/renderer/drawingSnapshot'
import {paintStrokes} from './tablet/renderer/tabletPage'
import {paintPaper,inkOn} from './tablet/renderer/tabletPaper'
import {paintBackdrop} from './tablet/renderer/tabletBackdrop'

async function pngOf(canvas: OffscreenCanvas): Promise<string> {
 const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer())
 if(typeof (bytes as any).toBase64==='function')return 'data:image/png;base64,'+(bytes as any).toBase64()
 const parts:string[]=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)))
 return 'data:image/png;base64,'+btoa(parts.join(''))
}
function editable(source:any,region:any) {
 const result=graphics.crop(source,region)
 delete result.extent
 if(source.backdrop&&region.x===0&&region.y===0&&region.width===1&&region.height===1)result.backdrop=source.backdrop
 if(source.backdrop&&(region.x!==0||region.y!==0||region.width!==1||region.height!==1)){
  const w=1000,h=1000/source.aspect
  result.backdrop='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${region.x*w} ${region.y*h} ${region.width*w} ${region.height*h}"><image href="${source.backdrop}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`)
 }
 return result
}
let queue=Promise.resolve()
self.onmessage=event=>{const job=event.data;queue=queue.catch(()=>{}).then(async()=>{
 let canvas:OffscreenCanvas|null=null
 try{
  if(!job||!Number.isSafeInteger(job.id)||!job.bytes||!job.region||![job.region.x,job.region.y,job.region.width,job.region.height].every(Number.isFinite)||job.region.width<=0||job.region.height<=0)throw Error('Invalid drawing export request.')
  const source=graphics.decode(job.bytes),snapshot=snapshotDrawing({...source,viewport:job.region})
  const result:{id:number;png?:string;sidecar?:string}={id:job.id}
  if(job.png){
   if(source.backdrop&&!job.bitmap)throw Error('Could not load the drawing background.')
   canvas=await rasterDrawing(snapshot,job.withPaper!==false,{canvas:()=>new OffscreenCanvas(1,1),paintPaper,paintBackdrop,paintStrokes,inkOn,backdropReady:async()=>job.bitmap,maxPixels:job.maxPixels,maxDimension:job.maxDimension})
   result.png=await pngOf(canvas!)
  }
  if(job.sidecar)result.sidecar=graphics.bytesBase64(graphics.encodeBytes(job.crop?editable(source,job.region):source))
  self.postMessage(result)
 }catch(error){self.postMessage({id:job?.id,error:error instanceof Error?error.message:String(error)})}
 finally{job?.bitmap?.close();if(canvas){canvas.width=1;canvas.height=1}}
})}
