import {InkRaster} from './tablet/renderer/inkRaster'
import {warpToPage,quadFromPixels} from './tablet/renderer/perspective'
import {liftedWriting} from './tablet/renderer/liftedWriting'
import graphics from './graphics-pane.js'

const MAX_PIXELS=16*1024*1024
const validSize=(w:number,h:number)=>Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w<=32768&&h<=32768&&w*h<=MAX_PIXELS
const canvas=(w:number,h:number)=>{if(!validSize(w,h))throw Error('Camera capture dimensions are too large.');return new OffscreenCanvas(w,h)}
export async function processCameraCapture(request:any){
 const {bitmap,bytes,plan,box,corners,writing,colour}=request
 let output:OffscreenCanvas|null=null
 try{
  output=canvas(bitmap.width,bitmap.height);const context=output.getContext('2d',{willReadFrequently:!!corners||writing});if(!context)throw Error('Could not prepare camera capture.');context.drawImage(bitmap,0,0);bitmap.close()
  graphics.validateBinary(bytes);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(12,true),ids=new Float64Array(count);for(let i=0;i<count;i++)ids[i]=i+1
  const raster=new InkRaster(),frame:any=await raster.render({session:'camera-capture',full:true,ack:0,order:ids,addIds:ids,additions:bytes,config:plan.config})
  try{context.save();context.beginPath();context.rect(plan.clip.x,plan.clip.y,plan.clip.width,plan.clip.height);context.clip();context.setTransform(...plan.matrix);for(const tile of frame.tiles)context.drawImage(tile.bitmap,tile.x,tile.y);context.restore()}finally{for(const tile of frame.tiles)tile.bitmap.close()}
  if(corners){
   const keys=['topLeft','topRight','bottomRight','bottomLeft'],points=keys.map(key=>corners[key]);if(points.some(p=>!p||![p.x,p.y].every((n:any)=>Number.isFinite(n)&&n>=0&&n<=1)))throw Error('Invalid page corners.')
   let sign=0;for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4],cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(cross)<1e-10||sign&&sign*cross<=0)throw Error('Page corners must form a single page.');sign=cross}
   const cc=Object.fromEntries(keys.map(key=>[key,{x:corners[key].x*output!.width,y:corners[key].y*output!.height}])),distance=(a:any,b:any)=>Math.hypot(a.x-b.x,a.y-b.y),rw=Math.max(1,Math.round((distance(cc.topLeft,cc.topRight)+distance(cc.bottomLeft,cc.bottomRight))/2)),rh=Math.max(1,Math.round((distance(cc.topLeft,cc.bottomLeft)+distance(cc.topRight,cc.bottomRight))/2)),scale=Math.min(1,1600/Math.max(rw,rh)),width=Math.max(1,Math.round(rw*scale)),height=Math.max(1,Math.round(rh*scale)),warped=warpToPage(context.getImageData(0,0,output.width,output.height).data,output.width,output.height,quadFromPixels(cc as any,output.height),{width,height}),next=canvas(width,height)
   next.getContext('2d')!.putImageData(new ImageData(warped,width,height),0,0);output.width=output.height=1;output=next
  }else if(box){
   if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>1+1e-9||box.y+box.height>1+1e-9)throw Error('Invalid camera selection.')
   const next=canvas(Math.max(1,Math.round(box.width*output.width)),Math.max(1,Math.round(box.height*output.height)));next.getContext('2d')!.drawImage(output,box.x*output.width,box.y*output.height,box.width*output.width,box.height*output.height,0,0,next.width,next.height);output.width=output.height=1;output=next
  }
  if(writing){const context=output.getContext('2d',{willReadFrequently:true})!,pixels=context.getImageData(0,0,output.width,output.height);context.putImageData(new ImageData(liftedWriting(pixels.data,output.width,output.height,colour),output.width,output.height),0,0)}
  return await output.convertToBlob({type:'image/png'})
 }finally{bitmap?.close();if(output)output.width=output.height=1}
}
if(typeof self!=='undefined')self.onmessage=async event=>{try{const blob=await processCameraCapture(event.data);self.postMessage({blob})}catch(error:any){self.postMessage({error:error.message||String(error)})}}
