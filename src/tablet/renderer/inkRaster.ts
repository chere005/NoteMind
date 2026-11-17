import graphics from '../../graphics-pane.js'
import { pressureScale } from '@notemind/core'
import { inkOn,parsePaper } from './tabletPaper'

type Box={x:number;y:number;right:number;bottom:number}
type Stroke={id:number;view:DataView;at:number;count:number;stride:number;pressure:boolean;width:number;colour:string;box:Box;cells:number[]|null}
type Config={width:number;height:number;paintWidth:number;paintHeight:number;ratio:number;region:{x:number;y:number;width:number;height:number};paper:any}
const EDGE=128,MAX_PIXELS=16*1024*1024,MAX_REFS=1000000,MAX_CELLS=64,MAX_BINARY=192*1024*1024,MAX_POINTS=2000000
const validId=(id:number)=>Number.isSafeInteger(id)&&id>0
const idsOf=(value:any):number[]=>{if(!ArrayBuffer.isView(value)||value.byteLength%8)throw Error('Invalid ink identities.');const view=new DataView(value.buffer,value.byteOffset,value.byteLength),ids=[];for(let at=0;at<view.byteLength;at+=8){const id=view.getFloat64(at,true);if(!validId(id))throw Error('Invalid ink identity.');ids.push(id)}return ids}
function recordsOf(bytes:Uint8Array,ids:number[]):Stroke[]{
 graphics.validateBinary(bytes);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(12,true);if(count!==ids.length)throw Error('Ink identities do not match geometry.')
 let at=24+view.getUint32(8,true);const records:Stroke[]=[]
 for(let i=0;i<count;i++){const flags=view.getUint8(at+3),pressure=!!(flags&1),width=view.getFloat64(at+4,true),points=view.getUint32(at+12,true),hex=[view.getUint8(at),view.getUint8(at+1),view.getUint8(at+2)].map(v=>v.toString(16).padStart(2,'0')).join(''),colour='#'+[...hex].map((c,n)=>flags&(1<<(n+1))?c.toUpperCase():c).join('');at+=16;const start=at,stride=pressure?24:16,box={x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity};for(let point=0;point<points;point++,at+=stride){const x=view.getFloat64(at,true),y=view.getFloat64(at+8,true);box.x=Math.min(box.x,x);box.y=Math.min(box.y,y);box.right=Math.max(box.right,x);box.bottom=Math.max(box.bottom,y)}records.push({id:ids[i]!,view,at:start,count:points,stride,pressure,width,colour,box,cells:null})}
 return records
}
function configuration(raw:any):Config{
 const {width,height,ratio,region}=raw||{},paintWidth=raw?.paintWidth??width,paintHeight=raw?.paintHeight??height
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width>8192||height>8192||width*height>MAX_PIXELS||!Number.isFinite(ratio)||ratio<=0||!region||![region.x,region.y,region.width,region.height,region.x+region.width,region.y+region.height].every(Number.isFinite)||region.width<=0||region.height<=0)throw Error('Invalid ink raster size.')
 if(!Number.isFinite(paintWidth)||!Number.isFinite(paintHeight)||paintWidth<width||paintHeight<height||paintWidth>width+1||paintHeight>height+1)throw Error('Invalid ink pixel mapping.')
 return {width,height,paintWidth,paintHeight,ratio,region:{...region},paper:parsePaper(raw.paper)}
}
function sameOrder(a:number[],b:number[]){return a.length===b.length&&a.every((id,index)=>id===b[index])}
function frameRect(config:Config,id:number){const columns=Math.ceil(config.width/EDGE),x=id%columns*EDGE,y=Math.floor(id/columns)*EDGE;return{x,y,width:Math.min(EDGE,config.width-x),height:Math.min(EDGE,config.height-y)}}
function cellsOf(stroke:Stroke,config:Config):number[]|null{
 if(!stroke.count)return[]
 const {width,height,paintWidth,paintHeight,region,ratio}=config,box=stroke.box,unit=paintWidth/(region.width*1000),reach=Math.max(ratio*.5,stroke.width*unit*1.8)/2+2
 const left=(box.x-region.x)/region.width*paintWidth-reach,right=(box.right-region.x)/region.width*paintWidth+reach,top=(box.y-region.y)/region.height*paintHeight-reach,bottom=(box.bottom-region.y)/region.height*paintHeight+reach
 if(right<0||bottom<0||left>width||top>height)return[]
 const columns=Math.ceil(width/EDGE),x0=Math.max(0,Math.floor(left/EDGE)),x1=Math.min(columns-1,Math.floor(right/EDGE)),y0=Math.max(0,Math.floor(top/EDGE)),y1=Math.min(Math.ceil(height/EDGE)-1,Math.floor(bottom/EDGE))
 if((x1-x0+1)*(y1-y0+1)>MAX_CELLS)return null
 const cells=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)cells.push(y*columns+x);return cells
}
const intersects=(ax:number,ay:number,bx:number,by:number,reach:number,rect:any)=>Math.max(ax,bx)+reach>=rect.x&&Math.min(ax,bx)-reach<=rect.x+rect.width&&Math.max(ay,by)+reach>=rect.y&&Math.min(ay,by)-reach<=rect.y+rect.height

export class InkRaster{
 session:string|null=null;records=new Map<number,Stroke>();order:number[]=[];positions=new Map<number,number[]>();index=new Map<number,Set<number>>();overflow=new Set<number>();refs=0;bytes=0;points=0;config:Config|null=null;configKey='';dirty=new Set<number>();lastFrame=0;lastAck=0
 maxIndexRefs:number;maxBinaryBytes:number
 constructor({maxIndexRefs=MAX_REFS,maxBinaryBytes=MAX_BINARY}={}){if(!Number.isSafeInteger(maxIndexRefs)||maxIndexRefs<0||maxIndexRefs>MAX_REFS||!Number.isSafeInteger(maxBinaryBytes)||maxBinaryBytes<=0||maxBinaryBytes>MAX_BINARY)throw Error('Invalid ink cache budget.');this.maxIndexRefs=maxIndexRefs;this.maxBinaryBytes=maxBinaryBytes}
 private markAll(){if(!this.config)return;const count=Math.ceil(this.config.width/EDGE)*Math.ceil(this.config.height/EDGE);for(let i=0;i<count;i++)this.dirty.add(i)}
 private remove(stroke:Stroke){if(stroke.cells===null)this.overflow.delete(stroke.id);else for(const cell of stroke.cells){const held=this.index.get(cell);if(held?.delete(stroke.id))this.refs--;if(!held?.size)this.index.delete(cell)}}
 private add(stroke:Stroke){let cells=cellsOf(stroke,this.config!);if(cells&&this.refs+cells.length>this.maxIndexRefs)cells=null;stroke.cells=cells;if(cells===null)this.overflow.add(stroke.id);else for(const cell of cells){let held=this.index.get(cell);if(!held){held=new Set();this.index.set(cell,held)}if(!held.has(stroke.id)){held.add(stroke.id);this.refs++}}}
 private mark(stroke:Stroke){if(stroke.cells===null)this.markAll();else for(const cell of stroke.cells)this.dirty.add(cell)}
 private markRect(rect:any){if(!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<0||rect.height<0)throw Error('Invalid ink dirty area.');const config=this.config!,columns=Math.ceil(config.width/EDGE),x0=Math.max(0,Math.floor(rect.x/EDGE)),y0=Math.max(0,Math.floor(rect.y/EDGE)),x1=Math.min(columns-1,Math.floor((rect.x+rect.width)/EDGE)),y1=Math.min(Math.ceil(config.height/EDGE)-1,Math.floor((rect.y+rect.height)/EDGE));for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)this.dirty.add(y*columns+x)}
 sync(request:any){
  if(typeof request.session!=='string'||!request.session||request.session.length>128)throw Error('Invalid ink session.')
  if(request.session!==this.session&&!request.full)return {resync:true}
  const config=configuration(request.config),order=idsOf(request.order);if(order.length>MAX_POINTS)throw Error('Too many ink strokes.')
  const fresh=request.full?new Map<number,Stroke>():new Map(this.records),added=request.additions?recordsOf(request.additions,idsOf(request.addIds)):[]
  for(const stroke of added){if(fresh.has(stroke.id))throw Error('Duplicate ink geometry.');fresh.set(stroke.id,stroke)}
  const used=new Set(order),positions=new Map<number,number[]>();let points=0
  for(let index=0;index<order.length;index++){const id=order[index]!,stroke=fresh.get(id);if(!stroke)throw Error('Unknown ink geometry.');points+=stroke.count;if(points>MAX_POINTS)throw Error('Too many ink points.');let list=positions.get(id);if(!list){list=[];positions.set(id,list)}list.push(index)}
  for(const id of fresh.keys())if(!used.has(id))fresh.delete(id)
  const buffers=new Set<ArrayBufferLike>();let bytes=0;for(const stroke of fresh.values())if(!buffers.has(stroke.view.buffer)){buffers.add(stroke.view.buffer);bytes+=stroke.view.buffer.byteLength}if(bytes>this.maxBinaryBytes)throw Error('Ink cache is too large.')
  const key=JSON.stringify([config.width,config.height,config.paintWidth,config.paintHeight,config.ratio,config.region,config.paper.colour]),reset=request.session!==this.session||key!==this.configKey||!!request.full,reordered=!reset&&!sameOrder(this.order.filter(id=>used.has(id)),order.filter(id=>this.records.has(id)))
  if(!reset&&request.ack===this.lastFrame&&request.ack!==this.lastAck){this.dirty.clear();this.lastAck=request.ack}
  if(reset){this.index.clear();this.overflow.clear();this.refs=0;this.dirty.clear();this.config=config;for(const stroke of fresh.values())this.add(stroke);this.markAll()}
  else{for(const [id,stroke]of this.records)if(!fresh.has(id)){this.mark(stroke);this.remove(stroke)}for(const stroke of added)if(fresh.has(stroke.id)){this.add(stroke);this.mark(stroke)}if(reordered||request.forceFull)this.markAll()}
  this.session=request.session;this.records=fresh;this.order=order;this.positions=positions;this.config=config;this.configKey=key;this.bytes=bytes;this.points=points
  if(request.extraDirty){if(!Array.isArray(request.extraDirty)||request.extraDirty.length>32)throw Error('Too many ink dirty areas.');for(const rect of request.extraDirty)this.markRect(rect)}
  return {resync:false}
 }
 private orderedAt(rect:any,excluded?:Set<number>){
  const config=this.config!
  if(rect.x===0&&rect.y===0&&rect.width===config.width&&rect.height===config.height)return this.order.filter(id=>!excluded?.has(id)).map(id=>this.records.get(id)!)
  const columns=Math.ceil(config.width/EDGE),cell=Math.floor(rect.y/EDGE)*columns+Math.floor(rect.x/EDGE),candidates=new Set([...(this.index.get(cell)||[]),...this.overflow]),positions:number[]=[]
  for(const id of candidates)if(!excluded?.has(id))for(const position of this.positions.get(id)!)positions.push(position)
  positions.sort((a,b)=>a-b);return positions.map(index=>this.records.get(this.order[index]!)!)
 }
 private async paint(ctx:any,records:Stroke[],rect:any,cancelled:()=>boolean){
  const config=this.config!,{paintWidth:width,paintHeight:height,region,ratio}=config,unit=width/(region.width*1000);let work=0
  ctx.lineCap='round';ctx.lineJoin='round'
  const x=(n:number)=>(n-region.x)/region.width*width,y=(n:number)=>(n-region.y)/region.height*height
  for(const stroke of records){if(cancelled())return false;if(!stroke.count){if(++work%2048===0)await graphics.yieldTask();continue;}const {view,stride}=stroke;let at=stroke.at,px=x(view.getFloat64(at,true)),py=y(view.getFloat64(at+8,true)),pressure=stroke.pressure?view.getFloat64(at+16,true):.5
   ctx.strokeStyle=inkOn(config.paper,stroke.colour)
   if(stroke.count===1){const line=Math.max(.5*ratio,stroke.width*unit);if(intersects(px,py,px,py,line/2+2,rect)){ctx.lineWidth=line;ctx.beginPath();ctx.moveTo(px-rect.x,py-rect.y);ctx.lineTo(px-rect.x+.01*ratio,py-rect.y);ctx.stroke()}if(++work%2048===0){await graphics.yieldTask();if(cancelled())return false}continue}
   const line=Math.max(.5*ratio,stroke.width*unit);let running=false,made=false;if(!stroke.pressure){ctx.lineWidth=line;ctx.beginPath()}
   for(let i=1;i<stroke.count;i++){at+=stride;const nx=x(view.getFloat64(at,true)),ny=y(view.getFloat64(at+8,true)),nextPressure=stroke.pressure?view.getFloat64(at+16,true):.5,thickness=stroke.pressure?Math.max(.25*ratio,stroke.width*unit*pressureScale((pressure+nextPressure)/2)):line
    if(intersects(px,py,nx,ny,thickness/2+2,rect)){if(stroke.pressure){ctx.lineWidth=thickness;ctx.beginPath();ctx.moveTo(px-rect.x,py-rect.y);ctx.lineTo(nx-rect.x,ny-rect.y);ctx.stroke()}else{if(!running)ctx.moveTo(px-rect.x,py-rect.y);ctx.lineTo(nx-rect.x,ny-rect.y);running=true;made=true}}else running=false
    px=nx;py=ny;pressure=nextPressure
    if(++work%2048===0){await graphics.yieldTask();if(cancelled())return false}
   }
   if(!stroke.pressure&&made)ctx.stroke()
   if(++work%2048===0){await graphics.yieldTask();if(cancelled())return false}
  }
  return !cancelled()
 }
 private async preview(request:any,cancelled:()=>boolean,canvasFactory:any){
  const selection=request.selection,config=this.config!
  if(!selection||![selection.x,selection.y,selection.width,selection.height,selection.x+selection.width,selection.y+selection.height].every(Number.isFinite)||selection.width<=0||selection.height<=0)throw Error('Invalid ink selection.')
  const selected=new Set<number>(),affected=new Set<number>();let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,padding=0,allCells=false
  for(const [id,stroke]of this.records){const box=stroke.box;if(!stroke.count||box.x<selection.x||box.y<selection.y||box.right>selection.x+selection.width||box.bottom>selection.y+selection.height)continue;selected.add(id);const reach=Math.max(config.ratio*.5,stroke.width*config.paintWidth/(config.region.width*1000)*1.8)/2+2;padding=Math.max(padding,reach);left=Math.min(left,(box.x-config.region.x)/config.region.width*config.paintWidth-reach);right=Math.max(right,(box.right-config.region.x)/config.region.width*config.paintWidth+reach);top=Math.min(top,(box.y-config.region.y)/config.region.height*config.paintHeight-reach);bottom=Math.max(bottom,(box.bottom-config.region.y)/config.region.height*config.paintHeight+reach);if(stroke.cells===null)allCells=true;else for(const cell of stroke.cells)affected.add(cell)}
  const allSelected=selected.size===this.records.size,whole={x:0,y:0,width:config.width,height:config.height},tileCount=Math.ceil(config.width/EDGE)*Math.ceil(config.height/EDGE),fixedRects=allSelected?[]:!request.previewBase||allCells||affected.size>Math.max(4,tileCount*.3)?[whole]:[...affected].map(id=>frameRect(config,id)),x=Math.max(0,Math.floor(left)),y=Math.max(0,Math.floor(top)),inkRect=selected.size?{x,y,width:Math.max(0,Math.min(config.width,Math.ceil(right))-x),height:Math.max(0,Math.min(config.height,Math.ceil(bottom))-y)}:null
  const pixels=fixedRects.reduce((n,rect)=>n+rect.width*rect.height,0)+(inkRect?inkRect.width*inkRect.height:0),scale=Math.min(1,Math.sqrt(MAX_PIXELS/Math.max(1,pixels))),fixed:any[]=[];let ink:any=null
  const paint=async(rect:any,records:Stroke[])=>{if(rect.width<=0||rect.height<=0)return null;const canvas=canvasFactory(Math.max(1,Math.floor(rect.width*scale)),Math.max(1,Math.floor(rect.height*scale)));try{const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not paint the selected ink.');if(scale!==1)ctx.scale(scale,scale);if(!await this.paint(ctx,records,rect,cancelled))return null;return{...rect,bitmap:canvas.transferToImageBitmap()};}finally{canvas.width=1;canvas.height=1}}
  try{for(const rect of fixedRects){if(cancelled())break;const layer=await paint(rect,this.orderedAt(rect,selected));if(layer)fixed.push(layer)}if(inkRect&&!cancelled())ink=await paint(inkRect,this.order.filter(id=>selected.has(id)).map(id=>this.records.get(id)!));if(cancelled()){for(const layer of fixed)layer.bitmap.close();ink?.bitmap.close();return{cancelled:true,accepted:true}}return{frame:this.lastFrame,tiles:[],preview:{fixed,ink,clear:!request.previewBase||allSelected,padding}}}
  catch(error){for(const layer of fixed)layer.bitmap.close();ink?.bitmap.close();throw error}
 }
 async render(request:any,cancelled:()=>boolean=()=>false,canvasFactory=(w:number,h:number)=>new OffscreenCanvas(w,h)){
  const sync=this.sync(request);if(sync.resync)return sync
  if(request.selection)return this.preview(request,cancelled,canvasFactory)
  const config=this.config!,tileCount=Math.ceil(config.width/EDGE)*Math.ceil(config.height/EDGE),full=this.dirty.size>Math.max(4,tileCount*.3),rects=full?[{x:0,y:0,width:config.width,height:config.height}]:[...this.dirty].map(id=>frameRect(config,id)),tiles:any[]=[]
  try{for(const rect of rects){if(cancelled())break;const canvas=canvasFactory(rect.width,rect.height);try{const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not paint drawing ink.');let ordered:Stroke[]
   ordered=full?this.order.map(id=>this.records.get(id)!):this.orderedAt(rect)
   const complete=await this.paint(ctx,ordered,rect,cancelled);if(!complete)break;const bitmap=canvas.transferToImageBitmap();tiles.push({...rect,bitmap})
  }finally{canvas.width=1;canvas.height=1}}}catch(error){for(const tile of tiles)tile.bitmap.close();throw error}
  if(cancelled()){for(const tile of tiles)tile.bitmap.close();return {cancelled:true,accepted:true}}
  return {frame:++this.lastFrame,tiles,stats:{indexRefs:this.refs,overflow:this.overflow.size,binaryBytes:this.bytes,strokeRecords:this.records.size,points:this.points,tileCount,paintedTiles:rects.length}}
 }
}
