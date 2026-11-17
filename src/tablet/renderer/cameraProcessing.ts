import {cameraRasterPlan,packCameraInk} from './cameraInkRaster'
import type {InkView} from './cameraInkGeometry'
import type {InkStroke} from './tabletPage'

const abort=()=>Object.assign(Error('Camera capture cancelled.'),{name:'AbortError'})
export function pngBlobDataURL(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error||Error('Could not read the captured picture.'));reader.onabort=()=>reject(abort());reader.readAsDataURL(blob)})}

/** One private capture at a time; image pixels and binary ink transfer ownership. */
export class CameraProcessing{
 private worker:Worker|null=null
 private closed=false
 private active:{reject:(reason:any)=>void;abort:()=>void;timer:ReturnType<typeof setTimeout>}|null=null
 constructor(private factory=()=>new Worker(new URL('camera-worker.js',document.baseURI))){}
 async run(canvas:HTMLCanvasElement,{strokes=[],view,box=null,corners=null,writing=false,colour='#000000',signal}: {strokes?:InkStroke[];view:InkView;box?:any;corners?:any;writing?:boolean;colour?:string;signal?:AbortSignal}){
  if(this.closed)throw abort();if(this.active)throw Error('A camera capture is already finishing.')
  if(canvas.width<1||canvas.height<1||canvas.width*canvas.height>16*1024*1024)throw Error('Camera capture dimensions are too large.')
  let cancel=()=>{},bitmap:ImageBitmap|null=null;const controller=new AbortController()
  const stopped=new Promise<never>((_resolve,reject)=>{this.active={reject,abort:()=>controller.abort(),timer:setTimeout(()=>{controller.abort();this.worker?.terminate();this.worker=null;reject(Error('Camera capture timed out.'))},120000)};cancel=()=>{controller.abort();reject(abort())};signal?.addEventListener('abort',cancel,{once:true})})
  try{
   if(signal?.aborted)throw abort()
   const plan=cameraRasterPlan(view,1);if(!plan)throw Error('There is no camera picture to capture.')
   const bytes=await Promise.race([packCameraInk(strokes,1,plan.widthScale,{signal:controller.signal}),stopped]);if(this.closed||controller.signal.aborted)throw abort()
   const opening=createImageBitmap(canvas).then(value=>{if(this.closed||controller.signal.aborted){value.close();throw abort()}return value})
   bitmap=await Promise.race([opening,stopped]);if(this.closed||controller.signal.aborted)throw abort()
   const worker=this.worker||=this.factory()
   const finished=new Promise<Blob>((resolve,reject)=>{
    worker.onmessage=event=>{if(event.data?.error){reject(Error(event.data.error));return}const blob=event.data?.blob;if(!(blob instanceof Blob)||blob.type!=='image/png'||!blob.size||blob.size>80*1024*1024){reject(Error('Invalid camera capture response.'));return}resolve(blob)}
    worker.onerror=event=>{event.preventDefault?.();reject(Error(event.message||'Camera capture worker stopped.'))}
    worker.onmessageerror=()=>reject(Error('Camera capture returned unreadable data.'))
    worker.postMessage({bitmap,bytes,plan:{config:plan.config,matrix:plan.workerToDevice,clip:plan.clip},box,corners,writing,colour},[bitmap!,bytes.buffer]);bitmap=null
   })
   return await Promise.race([finished,stopped])
  }finally{
   controller.abort();bitmap?.close();signal?.removeEventListener('abort',cancel);if(this.active)clearTimeout(this.active.timer);this.active=null
   // Capture-only workers must release their full-resolution buffers between
   // jobs, rather than retaining the last scan while the user keeps writing.
   this.worker?.terminate();this.worker=null
  }
 }
 dispose(){if(this.closed)return;this.closed=true;this.active?.abort();this.active?.reject(abort());this.worker?.terminate();this.worker=null}
}
