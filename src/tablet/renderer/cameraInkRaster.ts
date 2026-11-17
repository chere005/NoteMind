import graphics from '../../graphics-pane.js'
import {InkRenderer} from './inkRenderer'
import {inkToScreen,inkPictureRect,type InkView} from './cameraInkGeometry'
import type {InkStroke} from './tabletPage'

type Point={x:number;y:number}
type Matrix=[number,number,number,number,number,number]
const MAX_PIXELS=16*1024*1024,MAX_DIMENSION=8192
const finite=(n:number)=>Number.isFinite(n)&&Number.isFinite(n*10000)
const abort=()=>Object.assign(Error('Camera ink paint cancelled.'),{name:'AbortError'})
const plain={kind:'blank',spacing:'medium',colour:'white'}
export function cameraRasterPlan(view:InkView,ratio=1){
 const {size,shown}=view||{},turns=view?.turns||0
 if(!size||!shown||![size.width,size.height,shown.x,shown.y,shown.width,shown.height,ratio].every(finite)||size.width<0||size.height<0||shown.width<=0||shown.height<=0||ratio<=0||!Number.isInteger(turns)||turns<0||turns>3)throw Error('Invalid camera ink frame.')
 if(!size.width||!size.height)return null
 const origin=inkToScreen({x:0,y:0},view),px=inkToScreen({x:1,y:0},view),py=inkToScreen({x:0,y:1},view),x={x:px.x-origin.x,y:px.y-origin.y},y={x:py.x-origin.x,y:py.y-origin.y},basisX=Math.hypot(x.x,x.y),basisY=Math.hypot(y.x,y.y)
 if(![origin.x,origin.y,x.x,x.y,y.x,y.y,basisX,basisY].every(finite)||basisX<=0||basisY<=0)throw Error('Invalid camera ink transform.')
 const picture=inkPictureRect(view),left=Math.max(0,picture.x),top=Math.max(0,picture.y),right=Math.min(size.width,picture.x+picture.width),bottom=Math.min(size.height,picture.y+picture.height)
 if(![left,top,right,bottom].every(finite))throw Error('Invalid camera ink clip.')
 if(right<=left||bottom<=top)return null
 const clip={x:left,y:top,width:right-left,height:bottom-top},inverse=(p:Point)=>({x:((p.x-origin.x)*(x.x/basisX)+(p.y-origin.y)*(x.y/basisX))/basisX,y:((p.x-origin.x)*(y.x/basisY)+(p.y-origin.y)*(y.y/basisY))/basisY}),corners=[{x:left,y:top},{x:right,y:top},{x:left,y:bottom},{x:right,y:bottom}].map(inverse),rx=Math.min(...corners.map(p=>p.x)),ry=Math.min(...corners.map(p=>p.y)),region={x:rx,y:ry,width:Math.max(...corners.map(p=>p.x))-rx,height:Math.max(...corners.map(p=>p.y))-ry}
 const rasterRatio=Math.min(ratio,MAX_DIMENSION/clip.width,MAX_DIMENSION/clip.height,Math.sqrt(MAX_PIXELS)/Math.sqrt(clip.width)/Math.sqrt(clip.height)),paintWidth=Math.max(1,(turns%2?clip.height:clip.width)*rasterRatio),paintHeight=Math.max(1,(turns%2?clip.width:clip.height)*rasterRatio),width=Math.max(1,Math.floor(paintWidth)),height=Math.max(1,Math.floor(paintHeight)),widthScale=Math.max(basisX,basisY)/basisX
 const matrix:Matrix=[x.x*region.width/paintWidth,x.y*region.width/paintWidth,y.x*region.height/paintHeight,y.y*region.height/paintHeight,origin.x+x.x*rx+y.x*ry,origin.y+x.y*rx+y.y*ry]
 if(![...Object.values(region),...matrix,widthScale,rasterRatio].every(finite)||region.width<=0||region.height<=0||rasterRatio<=0||width*height>MAX_PIXELS||width>MAX_DIMENSION||height>MAX_DIMENSION)throw Error('Camera ink raster exceeds its bounded canvas.')
 const deviceMatrix=matrix.map(n=>n*ratio) as Matrix,canonicalToWorker:Matrix=[paintWidth/region.width,0,0,paintHeight/region.height,-region.x*paintWidth/region.width,-region.y*paintHeight/region.height];if(![...deviceMatrix,...canonicalToWorker].every(finite))throw Error('Camera output transform exceeds the numeric range.');Object.freeze(matrix);Object.freeze(deviceMatrix);Object.freeze(canonicalToWorker);Object.freeze(clip);Object.freeze(region);return Object.freeze({key:JSON.stringify([matrix,clip,width,height,paintWidth,paintHeight,ratio]),clip,region,width,height,paintWidth,paintHeight,ratio,rasterRatio,widthScale,matrix,deviceMatrix,canonicalToWorker,workerToDevice:deviceMatrix,config:Object.freeze({width,height,paintWidth,paintHeight,ratio:rasterRatio,region,paper:Object.freeze({...plain,cameraWidthScale:widthScale})})})
}
export type CameraRasterPlan=NonNullable<ReturnType<typeof cameraRasterPlan>>
export async function packCameraInk(sheet:any,options:any={},pack:any=graphics.encodeBytesAsync,extra:any={}){
 if(Array.isArray(sheet)){const aspect=typeof options==='number'?options:options.aspect??1,widthScale=typeof pack==='number'?pack:options.widthScale??1,settings=typeof options==='number'||typeof pack==='number'?extra:options;return packCameraInk({name:'Camera ink',aspect,strokes:sheet,paper:{...plain,cameraWidthScale:widthScale}},settings,graphics.encodeBytesAsync)}
 const scale=sheet.paper?.cameraWidthScale??1,{cameraWidthScale:ignored,...paper}=sheet.paper||plain
 if(!finite(scale)||scale<=0)throw Error('Invalid camera ink width scale.')
 const check=()=>{if(options.signal?.aborted)throw abort()},yieldControl=options.yieldControl||graphics.yieldTask;check()
 if(scale===1)return pack({...sheet,paper},options)
 const strokes=new Array(sheet.strokes.length)
 for(let i=0;i<strokes.length;i++){const source=sheet.strokes[i],width=source.width*scale;if(!finite(width)||width<=0)throw Error('Camera pen width exceeds the numeric range.');strokes[i]={...source,width};if(i%2048===2047){check();await yieldControl();check();}}
 check();return pack({...sheet,strokes,paper},options)
}
const viewKey=(view:InkView,ratio:number)=>JSON.stringify([view?.size?.width,view?.size?.height,view?.shown,view?.zoom,view?.clip,view?.turns||0,ratio])
/** Frames own their bitmaps only during the synchronous onFrame callback. */
export class CameraInkRenderer{
 private renderer:InkRenderer|null=null
 private owner:WeakRef<object>|null=null
 private token:object={}
 private factor=0
 private appliedKey=''
 private generation=0
 private closed=false
 constructor(private options:any={}){}
 private create(){return new InkRenderer({...this.options,pack:(sheet:any,options:any)=>packCameraInk(sheet,options,this.options.pack||graphics.encodeBytesAsync)})}
 request(source:{page:any;strokes:InkStroke[];ownerStrokes?:InkStroke[];view:InkView;ratio:number;forceFull?:boolean;valid?:()=>boolean},onFrame:(frame:any,plan:CameraRasterPlan,current:()=>boolean)=>boolean,onError?:(error:any,plan:CameraRasterPlan|null,current:()=>boolean)=>any){
  if(this.closed)return null
  const generation=++this.generation,page=new WeakRef(source.page),strokes=new WeakRef(source.ownerStrokes??source.strokes),valid=source.valid,view=source.view,ratio=source.ratio,key=viewKey(view,ratio),current=()=>{const owner=page.deref(),ink=strokes.deref();return !this.closed&&generation===this.generation&&!!owner&&!!ink&&viewKey(view,ratio)===key&&(!(owner as any).strokes||(owner as any).strokes===ink)&&(valid?.()??true)}
  let plan:CameraRasterPlan|null
  try{plan=cameraRasterPlan(source.view,source.ratio)}catch(error){onError?.(error,null,current);return null}
  if(!plan){this.renderer?.dispose();this.renderer=null;this.owner=null;this.appliedKey='';return null}
  if(this.owner?.deref()!==source.page||Math.abs(this.factor-plan.widthScale)>1e-12*Math.max(1,this.factor,plan.widthScale)){this.owner=page;this.factor=plan.widthScale;this.token={}}
  this.renderer ||=this.create()
  const captured=plan,config=this.factor===captured.widthScale?captured.config:{...captured.config,paper:{...captured.config.paper,cameraWidthScale:this.factor}}
  this.renderer.request({page:this.token,strokes:source.strokes,aspect:1,config,forceFull:!!source.forceFull||captured.key!==this.appliedKey},frame=>{if(!current())return false;const applied=onFrame(frame,captured,current)===true;if(applied)this.appliedKey=captured.key;return applied;},(error,_scene,owned)=>{if(current()&&owned())return onError?.(error,captured,()=>current()&&owned())})
  return captured
 }
 whenIdle(){return this.renderer?.whenIdle()||Promise.resolve()}
 dispose(){if(this.closed)return;this.closed=true;this.generation++;this.renderer?.dispose();this.renderer=null;this.owner=null}
}
