import {imageSize} from 'image-size'
import {inspectBinaryDrawing,paintBinaryDrawing} from './binary-drawing.js'
import {snapshotDrawing,rasterDrawing} from './tablet/renderer/drawingSnapshot'
import {paintPaper,inkOn,parsePaper} from './tablet/renderer/tabletPaper'
import {paintBackdrop} from './tablet/renderer/tabletBackdrop'
import {pressureScale} from '@notemind/core'
import graphics from './graphics-pane.js'
import {cameraMetadata} from './camera-schema.cjs'
import {cameraReference,inkToPreview} from './tablet/renderer/cameraReference'
const originalDimensions=new WeakMap<object,{width:number;height:number}>()
const MAX_SOURCE=256*1024*1024,MAX_IMAGE_PIXELS=16*1024*1024
const abort=()=>Object.assign(Error('Page thumbnail cancelled.'),{name:'AbortError'})
export async function backdropOf(bytes:Uint8Array,signal:AbortSignal,makeBitmap=globalThis.createImageBitmap){
 const check=()=>{if(signal.aborted)throw abort()},decode=new TextDecoder('utf-8',{fatal:true}),prefix=decode.decode(bytes.subarray(0,128)),comma=prefix.indexOf(','),mime=prefix.slice(0,comma)
 if(comma<0||!/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64$/i.test(mime))throw Error('Invalid overview background.')
 const parts:Uint8Array[]=[];let pending='',total=0,padded=false
 for(let at=comma+1;at<bytes.length;at+=65536){check();const text=decode.decode(bytes.subarray(at,Math.min(bytes.length,at+65536))).replace(/[\r\n]/g,'');if(!/^[a-z0-9+/=]*$/i.test(text)||padded&&text)throw Error('Invalid overview background encoding.');pending+=text;const length=Math.floor(pending.length/4)*4;if(length){const block=pending.slice(0,length);if(!/^[a-z0-9+/]*={0,2}$/i.test(block))throw Error('Invalid overview background encoding.');padded=block.includes('=');const raw=typeof (Uint8Array as any).fromBase64==='function'?(Uint8Array as any).fromBase64(block):Uint8Array.from(atob(block),c=>c.charCodeAt(0));parts.push(raw);total+=raw.length;pending=pending.slice(length);}await graphics.yieldTask()}
 if(pending||!total)throw Error('Invalid overview background encoding.')
 const raw=new Uint8Array(total);let at=0;for(const part of parts){raw.set(part,at);at+=part.length;if(signal.aborted)throw abort();if(at%1048576<part.length)await graphics.yieldTask()}parts.length=0
 const dimensions=imageSize(raw),rotated=(dimensions.orientation||0)>=5&&(dimensions.orientation||0)<=8,width=rotated?dimensions.height:dimensions.width,height=rotated?dimensions.width:dimensions.height
 if(!width||!height||width>32768||height>32768||width*height>MAX_IMAGE_PIXELS)throw Error('The page background exceeds the thumbnail decode budget.')
 const scale=Math.min(1,512/width,512/height),bitmap=await makeBitmap(new Blob([raw],{type:mime.slice(5,-7)}),{resizeWidth:Math.max(1,Math.round(width*scale)),resizeHeight:Math.max(1,Math.round(height*scale)),resizeQuality:'high'})
 if(signal.aborted){bitmap.close();throw abort()}originalDimensions.set(bitmap,{width,height});return bitmap
}
export async function paintCameraThumbnail(surface:any,bitmap:any,source:any,metadata:any,maxDimension:number,pause:()=>Promise<void>){
 const raw=originalDimensions.get(bitmap)||{width:bitmap.width,height:bitmap.height},layout=cameraReference(raw,metadata.camera),preview=layout.preview,aspect=preview.width/preview.height,scale=Math.min(1,maxDimension/preview.width,maxDimension/preview.height),width=Math.max(1,Math.floor(preview.width*scale)),height=Math.max(1,Math.floor(preview.height*scale))
 surface.width=width;surface.height=height;const ctx=surface.getContext('2d'),sx=width/preview.width,sy=height/preview.height,rotation=metadata.camera.rotation||0,matrix=rotation===90?[0,1,-1,0,raw.height,0]:rotation===180?[-1,0,0,-1,raw.width,raw.height]:rotation===270?[0,-1,1,0,0,raw.width]:[1,0,0,1,0,0]
 ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.setTransform(matrix[0]*sx,matrix[1]*sy,matrix[2]*sx,matrix[3]*sy,(matrix[4]-preview.x)*sx,(matrix[5]-preview.y)*sy);ctx.drawImage(bitmap,0,0,raw.width,raw.height);ctx.resetTransform();ctx.save();ctx.scale(width/1000,height/(1000/aspect))
 try{await paintBinaryDrawing(ctx,source,(x:number,y:number)=>{const point=inkToPreview({x,y},layout);return{x:point.x*1000,y:point.y*1000/aspect}},Math.max(layout.reference.width,layout.reference.height)/preview.width,undefined,pressureScale,{yieldControl:pause})}finally{ctx.restore()}
}
export async function renderOverviewThumbnail(packet:any,{signal=new AbortController().signal,canvas=()=>new OffscreenCanvas(1,1),decodeBackdrop=backdropOf,maxDimension=160}={}){
 if(signal.aborted)throw abort()
 if(!packet||!ArrayBuffer.isView(packet.bytes)||packet.bytes.byteLength+(packet.backdropBytes?.byteLength||0)>MAX_SOURCE||!Number.isInteger(maxDimension)||maxDimension<16||maxDimension>256)throw Error('Invalid overview thumbnail source.')
 const pause=async()=>{if(signal.aborted)throw abort();await graphics.yieldTask();if(signal.aborted)throw abort()},source=await inspectBinaryDrawing(packet.bytes,{signal,yieldControl:pause}),metadata={...source.metadata,...packet.metadata},region=metadata.extent||{x:0,y:0,width:1,height:1}
 graphics.validate({...metadata,strokes:[]});metadata.paper=parsePaper(metadata.paper);if(metadata.camera)metadata.camera=cameraMetadata({...metadata.camera,name:'Overview'}).camera
 // Compact store packets keep the image separate from geometry. Decode it only
 // inside this worker, never in the visible page's point/image cache.
 let bitmap:any=null,surface:any=null
 try{if(packet.backdropBytes){if(!ArrayBuffer.isView(packet.backdropBytes))throw Error('Invalid overview background bytes.');bitmap=await decodeBackdrop(new Uint8Array(packet.backdropBytes.buffer,packet.backdropBytes.byteOffset,packet.backdropBytes.byteLength),signal);metadata.backdrop='data:image/png;base64,AA=='}else if(metadata.backdrop){throw Error('Overview background bytes are missing.')}
  if(metadata.camera&&bitmap){surface=canvas();await paintCameraThumbnail(surface,bitmap,source,metadata,maxDimension,pause)}else{const snapshot=snapshotDrawing({...metadata,strokes:[],viewport:region});surface=await rasterDrawing(snapshot,true,{canvas,paintPaper,paintBackdrop,inkOn,maxDimension,maxPixels:maxDimension*maxDimension,backdropReady:async()=>bitmap,paintStrokes:(ctx:any)=>paintBinaryDrawing(ctx,source,(x:number,y:number)=>({x:x*1000,y:y*1000/metadata.aspect}),1,(colour:string)=>inkOn(metadata.paper,colour),pressureScale,{signal,yieldControl:pause})});}if(signal.aborted)throw abort();const width=surface.width,height=surface.height,blob=await surface.convertToBlob({type:'image/png'});if(signal.aborted)throw abort();if(blob.size>512*1024)throw Error('Overview thumbnail is too large.');return{blob,width,height}
 }catch(error){if(signal.aborted)throw abort();throw error}finally{bitmap?.close();if(surface){surface.width=1;surface.height=1}}
}
