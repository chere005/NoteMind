import {InkRaster} from './tablet/renderer/inkRaster'
import {warpToPage,quadFromPixels} from './tablet/renderer/perspective'
import {liftedWriting} from './tablet/renderer/liftedWriting'
import graphics from './graphics-pane.js'
import {preparePNGBytes} from './camera-picture-bytes.js'
import {cameraReference,cameraInkView} from './tablet/renderer/cameraReference'
import {cameraRasterPlan} from './tablet/renderer/cameraInkRaster'
import {cameraMetadata} from './camera-schema.cjs'

const MAX_PIXELS=16*1024*1024
const validSize=(w:number,h:number)=>Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w<=32768&&h<=32768&&w*h<=MAX_PIXELS
const canvas=(w:number,h:number)=>{if(!validSize(w,h))throw Error('Camera capture dimensions are too large.');return new OffscreenCanvas(w,h)}
async function pngResult(output:OffscreenCanvas,thumbnail:boolean){
 const blob=await output.convertToBlob({type:'image/png'});if(!thumbnail)return {blob}
 const scale=Math.min(1,220/output.width,300/output.height),small=canvas(Math.max(1,Math.round(output.width*scale)),Math.max(1,Math.round(output.height*scale)))
 try{small.getContext('2d')!.drawImage(output,0,0,small.width,small.height);return {blob,thumbnail:await small.convertToBlob({type:'image/png'})}}finally{small.width=small.height=1}
}
function inkHeader(bytes:Uint8Array){
 if(!(bytes instanceof Uint8Array)||!graphics.isBinary(bytes)||bytes.length<24||bytes.length>graphics.MAX_BINARY_BYTES)throw Error('Invalid binary camera ink.')
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),metadataLength=view.getUint32(8,true),count=view.getUint32(12,true),points=view.getUint32(16,true)
 if(view.getUint32(20,true)!==bytes.length||metadataLength>70*1024*1024||metadataLength>bytes.length-24||count>2000000||points>2000000)throw Error('Invalid binary camera ink size.')
 return {view,metadataLength,count,points}
}
export async function processCameraCapture(request:any){
 const {bitmap,bytes,plan,box,corners,writing,colour}=request
 let output:OffscreenCanvas|null=null
 try{
  output=canvas(bitmap.width,bitmap.height);const context=output.getContext('2d',{willReadFrequently:!!corners||writing});if(!context)throw Error('Could not prepare camera capture.');context.drawImage(bitmap,0,0);bitmap.close()
  const {count}=inkHeader(bytes)
  if(!count)graphics.validateBinary(bytes)
  else{
   const ids=new Float64Array(count);for(let i=0;i<count;i++)ids[i]=i+1
   // InkRaster's binary inspector is the sole full geometry validator here.
   const raster=new InkRaster(),frame:any=await raster.render({session:'camera-capture',full:true,ack:0,order:ids,addIds:ids,additions:bytes,config:plan.config})
   try{context.save();context.beginPath();context.rect(plan.clip.x,plan.clip.y,plan.clip.width,plan.clip.height);context.clip();context.setTransform(...plan.matrix);for(const tile of frame.tiles)context.drawImage(tile.bitmap,tile.x,tile.y);context.restore()}finally{for(const tile of frame.tiles)tile.bitmap.close()}
  }
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
  return await pngResult(output,!!request.thumbnail)
 }finally{bitmap?.close();if(output)output.width=output.height=1}
}
export async function processCameraImage(request:any){
 let bitmap:ImageBitmap|null=request.bitmap,output:OffscreenCanvas|null=null
 try{
  const rotation=request.rotation??0;if(!bitmap||![0,90,180,270].includes(rotation)||!validSize(bitmap.width,bitmap.height))throw Error('Invalid scan image dimensions or rotation.')
  const width=bitmap.width,height=bitmap.height,turned=rotation===90||rotation===270,w=turned?height:width,h=turned?width:height,scale=request.thumbnailOnly?Math.min(1,220/w,300/h):1;output=canvas(Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale)))
  const context=output.getContext('2d')!,sx=output.width/w,sy=output.height/h;if(rotation===90)context.setTransform(0,sy,-sx,0,height*sx,0);else if(rotation===180)context.setTransform(-sx,0,0,-sy,width*sx,height*sy);else if(rotation===270)context.setTransform(0,-sy,sx,0,0,width*sy);else context.setTransform(sx,0,0,sy,0,0)
  context.drawImage(bitmap,0,0);bitmap.close();bitmap=null
  return await pngResult(output,!request.thumbnailOnly&&!!request.thumbnail)
 }finally{bitmap?.close();if(output)output.width=output.height=1}
}

async function compactPicture(request:any){
 let bytes=request.backdropBytes;request.backdropBytes=null
 const picture=await preparePNGBytes(bytes);bytes=null
 const image=await createImageBitmap(picture.blob)
 if(image.width!==picture.width||image.height!==picture.height){image.close();throw Error('Camera picture dimensions changed while loading.')}
 return image
}
export async function processCompactCameraPage(request:any){
 const bytes:Uint8Array=request.bytes,settings=request.metadata?.camera
 if(!settings||!request.backdropBytes)throw Error('The saved camera page has no picture.')
 cameraMetadata({...settings,name:request.metadata.name})
 const header=inkHeader(bytes)
 let source:ImageBitmap|null=await compactPicture(request),output:OffscreenCanvas|null=null
 try{
  const layout=cameraReference({width:source.width,height:source.height},settings),preview=layout.preview
  output=canvas(Math.max(1,Math.floor(preview.width)),Math.max(1,Math.floor(preview.height)))
  const context=output.getContext('2d')!,rotation=settings.rotation||0,sx=output.width/preview.width,sy=output.height/preview.height
  const matrix=rotation===90?[0,1,-1,0,source.height,0]:rotation===180?[-1,0,0,-1,source.width,source.height]:rotation===270?[0,-1,1,0,0,source.width]:[1,0,0,1,0,0]
  context.setTransform(matrix[0]*sx,matrix[1]*sy,matrix[2]*sx,matrix[3]*sy,(matrix[4]-preview.x)*sx,(matrix[5]-preview.y)*sy);context.drawImage(source,0,0);context.resetTransform();source.close();source=null
  const view=cameraInkView(layout,{size:{width:output.width,height:output.height},shown:{x:0,y:0,width:output.width,height:output.height},zoom:null}),plan=cameraRasterPlan(view,1)
  if(!plan)throw Error('The saved camera page has no visible picture.')
  // This is the worker's explicitly owned transfer buffer. Scale widths in its
  // binary records without creating another editable point/stroke graph.
  if(plan.widthScale!==1){const {view:data,count,points}=header;let at=24+header.metadataLength,seen=0
   for(let i=0;i<count;i++){
    if(at+16>bytes.length)throw Error('Truncated binary camera ink.');const flags=data.getUint8(at+3),size=data.getUint32(at+12,true),stride=flags&1?24:16,rawWidth=data.getFloat64(at+4,true),width=rawWidth*plan.widthScale
    if(flags>127||!Number.isFinite(rawWidth*10000)||!Number.isFinite(width*10000)||width<=0||size>points-seen||at+16+size*stride>bytes.length)throw Error('Invalid camera pen width or record.')
    data.setFloat64(at+4,width,true);at+=16+size*stride;seen+=size;if(i%8192===8191)await graphics.yieldTask()
   }
   if(seen!==points||at!==bytes.length)throw Error('Invalid binary camera ink length.')
  }
  const bitmap=output.transferToImageBitmap();output.width=output.height=1;output=null
  return await processCameraCapture({bitmap,bytes,plan:{config:plan.config,matrix:plan.workerToDevice,clip:plan.clip},box:settings.box||null,corners:settings.corners||null,thumbnail:!!request.thumbnail})
 }finally{source?.close();if(output)output.width=output.height=1}
}
if(typeof self!=='undefined')self.onmessage=async event=>{try{const result=await(event.data?.imageOnly?processCameraImage(event.data):event.data?.compact?processCompactCameraPage(event.data):processCameraCapture(event.data));self.postMessage(result)}catch(error:any){self.postMessage({error:error.message||String(error)})}}
