import {cameraRasterPlan,packCameraInk} from './cameraInkRaster'
import type {InkView} from './cameraInkGeometry'
import type {InkStroke} from './tabletPage'

const abort=()=>Object.assign(Error('Camera capture cancelled.'),{name:'AbortError'})
export function pngBlobDataURL(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error||Error('Could not read the captured picture.'));reader.onabort=()=>reject(abort());reader.readAsDataURL(blob)})}

type Result={blob:Blob;thumbnail?:Blob}
type Prepared={request:any;transfers:Transferable[];cleanup?:()=>void}
const graphics=require('../../graphics-pane.js')
async function ownBytes(source:Uint8Array,owned:boolean,signal:AbortSignal){
 if(!(source instanceof Uint8Array))throw Error('Invalid compact camera data.')
 if(owned&&source.byteOffset===0&&source.byteLength===source.buffer.byteLength)return source
 const bytes=new Uint8Array(source.byteLength)
 for(let at=0;at<bytes.length;at+=65536){if(signal.aborted)throw abort();bytes.set(source.subarray(at,at+65536),at);await graphics.yieldTask()}
 return bytes
}
/** One private capture at a time; image pixels and binary ink transfer ownership. */
export class CameraProcessing{
 private worker:Worker|null=null
 private closed=false
 private active:{reject:(reason:any)=>void;abort:()=>void;timer:ReturnType<typeof setTimeout>}|null=null
 constructor(private factory=()=>new Worker(new URL('camera-worker.js',document.baseURI))){}
 private async process(prepare:(signal:AbortSignal)=>Promise<Prepared>,signal?:AbortSignal):Promise<Result>{
  if(this.closed)throw abort();if(this.active)throw Error('A camera capture is already finishing.')
  let cancel=()=>{},prepared:Prepared|null=null,posted=false;const controller=new AbortController()
  const stopped=new Promise<never>((_resolve,reject)=>{this.active={reject,abort:()=>controller.abort(),timer:setTimeout(()=>{controller.abort();this.worker?.terminate();this.worker=null;reject(Error('Camera capture timed out.'))},120000)};cancel=()=>{controller.abort();reject(abort())};signal?.addEventListener('abort',cancel,{once:true})})
  try{
   if(signal?.aborted)throw abort()
   const preparing=prepare(controller.signal).then(value=>{if(this.closed||controller.signal.aborted){value.cleanup?.();throw abort()}return value})
   prepared=await Promise.race([preparing,stopped]);if(this.closed||controller.signal.aborted)throw abort()
   const worker=this.worker||=this.factory(),finished=new Promise<Result>((resolve,reject)=>{
    worker.onmessage=event=>{if(event.data?.error){reject(Error(event.data.error));return}const {blob,thumbnail}=event.data||{},valid=(value:any,max:number)=>value instanceof Blob&&value.type==='image/png'&&value.size>0&&value.size<=max;if(!valid(blob,80*1024*1024)||thumbnail&&!valid(thumbnail,1024*1024)){reject(Error('Invalid camera capture response.'));return}resolve({blob,...(thumbnail?{thumbnail}:{})})}
    worker.onerror=event=>{event.preventDefault?.();reject(Error(event.message||'Camera capture worker stopped.'))}
    worker.onmessageerror=()=>reject(Error('Camera capture returned unreadable data.'))
    worker.postMessage(prepared!.request,prepared!.transfers);posted=true
   })
   return await Promise.race([finished,stopped])
  }finally{
   controller.abort();if(!posted)prepared?.cleanup?.();signal?.removeEventListener('abort',cancel);if(this.active)clearTimeout(this.active.timer);this.active=null
   this.worker?.terminate();this.worker=null
  }
 }
 async run(canvas:HTMLCanvasElement,{strokes=[],view,box=null,corners=null,writing=false,colour='#000000',signal,ownedCanvas=false}: {strokes?:InkStroke[];view:InkView;box?:any;corners?:any;writing?:boolean;colour?:string;signal?:AbortSignal;ownedCanvas?:boolean}){
  if(canvas.width<1||canvas.height<1||canvas.width*canvas.height>16*1024*1024)throw Error('Camera capture dimensions are too large.')
  const result=await this.process(async current=>{
   const plan=cameraRasterPlan(view,1);if(!plan)throw Error('There is no camera picture to capture.')
   const bytes=await packCameraInk(strokes,1,plan.widthScale,{signal:current});if(current.aborted)throw abort()
   const bitmap=await createImageBitmap(canvas);if(current.aborted){bitmap.close();throw abort()}
   if(ownedCanvas)canvas.width=canvas.height=1
   return {request:{bitmap,bytes,plan:{config:plan.config,matrix:plan.workerToDevice,clip:plan.clip},box,corners,writing,colour},transfers:[bitmap,bytes.buffer],cleanup:()=>bitmap.close()}
  },signal)
  return result.blob
 }
 runCompact(packet:{bytes:Uint8Array;backdropBytes:Uint8Array;metadata:any},{owned=false,signal,thumbnail=false}: {owned?:boolean;signal?:AbortSignal;thumbnail?:boolean}={}){
  const metadata=structuredClone(packet.metadata)
  return this.process(async current=>{
   if((packet.bytes?.byteLength||0)+(packet.backdropBytes?.byteLength||0)>256*1024*1024)throw Error('Compact camera page is too large.')
   const bytes=await ownBytes(packet.bytes,owned,current),backdropBytes=await ownBytes(packet.backdropBytes,owned,current)
   return {request:{compact:true,bytes,backdropBytes,metadata,thumbnail},transfers:[...new Set([bytes.buffer,backdropBytes.buffer])]}
  },signal)
 }
 dispose(){if(this.closed)return;this.closed=true;this.active?.abort();this.active?.reject(abort());this.worker?.terminate();this.worker=null}
}
