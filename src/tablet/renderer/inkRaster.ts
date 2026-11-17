import graphics from '../../graphics-pane.js'
import { pressureScale } from '@notemind/core'
import { inkOn,parsePaper } from './tabletPaper'
import { InkRecordTable,emptyRecord,type InkRecord } from './inkRecords'

type Config={width:number;height:number;paintWidth:number;paintHeight:number;ratio:number;region:{x:number;y:number;width:number;height:number};paper:any}
const EDGE=128,BLOCK=256,MAX_PIXELS=16*1024*1024,MAX_REFS=1000000,MAX_CELLS=64,MAX_BINARY=192*1024*1024
function configuration(raw:any):Config{
 const {width,height,ratio,region}=raw||{},paintWidth=raw?.paintWidth??width,paintHeight=raw?.paintHeight??height
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width>8192||height>8192||width*height>MAX_PIXELS||!Number.isFinite(ratio)||ratio<=0||!region||![region.x,region.y,region.width,region.height,region.x+region.width,region.y+region.height].every(Number.isFinite)||region.width<=0||region.height<=0)throw Error('Invalid ink raster size.')
 if(!Number.isFinite(paintWidth)||!Number.isFinite(paintHeight)||paintWidth<width||paintHeight<height||paintWidth>width+1||paintHeight>height+1)throw Error('Invalid ink pixel mapping.')
 return {width,height,paintWidth,paintHeight,ratio,region:{...region},paper:parsePaper(raw.paper)}
}
function frameRect(config:Config,id:number){const columns=Math.ceil(config.width/EDGE),x=id%columns*EDGE,y=Math.floor(id/columns)*EDGE;return{x,y,width:Math.min(EDGE,config.width-x),height:Math.min(EDGE,config.height-y)}}
const intersects=(ax:number,ay:number,bx:number,by:number,reach:number,rect:any)=>Math.max(ax,bx)+reach>=rect.x&&Math.min(ax,bx)-reach<=rect.x+rect.width&&Math.max(ay,by)+reach>=rect.y&&Math.min(ay,by)-reach<=rect.y+rect.height
const touches=(bounds:Float64Array,at:number,rect:any)=>bounds[at]!<=rect.x+rect.width&&bounds[at+2]!>=rect.x&&bounds[at+1]!<=rect.y+rect.height&&bounds[at+3]!>=rect.y
const pixelsOf=(stroke:InkRecord,config:Config)=>{const {paintWidth,paintHeight,region,ratio}=config,box=stroke.box,unit=paintWidth/(region.width*1000),reach=Math.max(ratio*.5,stroke.width*unit*1.8)/2+2;return{x:(box.x-region.x)/region.width*paintWidth-reach,y:(box.y-region.y)/region.height*paintHeight-reach,right:(box.right-region.x)/region.width*paintWidth+reach,bottom:(box.bottom-region.y)/region.height*paintHeight+reach,reach}}
function eachCell(bounds:{x:number;y:number;right:number;bottom:number},config:Config,visit?:(id:number)=>void){const {width,height}=config;if(bounds.right<0||bounds.bottom<0||bounds.x>width||bounds.y>height||bounds.x>bounds.right||bounds.y>bounds.bottom)return 0;const columns=Math.ceil(width/EDGE),x0=Math.max(0,Math.floor(bounds.x/EDGE)),x1=Math.min(columns-1,Math.floor(bounds.right/EDGE)),y0=Math.max(0,Math.floor(bounds.y/EDGE)),y1=Math.min(Math.ceil(height/EDGE)-1,Math.floor(bounds.bottom/EDGE)),count=(x1-x0+1)*(y1-y0+1);if(visit)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)visit(y*columns+x);return count}
const validateRect=(rect:any)=>{if(!rect||![rect.x,rect.y,rect.width,rect.height,rect.x+rect.width,rect.y+rect.height].every(Number.isFinite)||rect.width<0||rect.height<0)throw Error('Invalid ink dirty area.')}

/** One immutable binary owner and a bounded ordered block index; never one JS object per stroke. */
export class InkRaster{
 session:string|null=null;records=new InkRecordTable();blocks=new Float64Array(0);indexed=new Uint8Array(0);refs=0;overflow=0;bytes=0;points=0;config:Config|null=null;configKey='';dirty=new Set<number>();lastFrame=0;lastAck=0
 maxIndexRefs:number;maxBinaryBytes:number
 constructor({maxIndexRefs=MAX_REFS,maxBinaryBytes=MAX_BINARY}={}){if(!Number.isSafeInteger(maxIndexRefs)||maxIndexRefs<0||maxIndexRefs>MAX_REFS||!Number.isSafeInteger(maxBinaryBytes)||maxBinaryBytes<=0||maxBinaryBytes>MAX_BINARY)throw Error('Invalid ink cache budget.');this.maxIndexRefs=maxIndexRefs;this.maxBinaryBytes=maxBinaryBytes}
 private markAll(config=this.config!,dirty=this.dirty){const count=Math.ceil(config.width/EDGE)*Math.ceil(config.height/EDGE);for(let i=0;i<count;i++)dirty.add(i)}
 private mark(stroke:InkRecord,config:Config,dirty:Set<number>){if(!stroke.count)return;const bounds=pixelsOf(stroke,config);if(eachCell(bounds,config)>MAX_CELLS)this.markAll(config,dirty);else eachCell(bounds,config,id=>dirty.add(id))}
 private markRect(rect:any,config=this.config!,dirty=this.dirty){eachCell({x:rect.x,y:rect.y,right:rect.x+rect.width,bottom:rect.y+rect.height},config,id=>dirty.add(id))}
 async sync(request:any,cancelled:()=>boolean=()=>false){
  if(typeof request.session!=='string'||!request.session||request.session.length>128)throw Error('Invalid ink session.');if(request.session!==this.session&&!request.full)return{resync:true}
  const config=configuration(request.config);if(request.extraDirty){if(!Array.isArray(request.extraDirty)||request.extraDirty.length>32)throw Error('Too many ink dirty areas.');for(const rect of request.extraDirty)validateRect(rect)}
  if(request.selection){validateRect(request.selection);if(request.selection.width<=0||request.selection.height<=0)throw Error('Invalid ink selection.')}
  const pause=async()=>{if(cancelled())throw Error('Ink raster cancelled.');await graphics.yieldTask();if(cancelled())throw Error('Ink raster cancelled.')},previous=request.full?null:this.records,next=await InkRecordTable.prepare(previous,request,this.maxBinaryBytes,pause),key=JSON.stringify([config.width,config.height,config.paintWidth,config.paintHeight,config.ratio,config.region,config.paper.colour]),reset=request.session!==this.session||key!==this.configKey||!!request.full,acknowledged=!reset&&request.ack===this.lastFrame&&request.ack!==this.lastAck,dirty=reset||acknowledged?new Set<number>():new Set(this.dirty),blocks=new Float64Array(Math.ceil(next.order.length/BLOCK)*4),indexed=new Uint8Array(blocks.length/4),stroke=emptyRecord();let refs=0,overflow=0
  for(let block=0;block<indexed.length;block++){let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;const end=Math.min(next.order.length,(block+1)*BLOCK);for(let position=block*BLOCK;position<end;position++){next.read(next.order[position]!,stroke,false);if(!stroke.count)continue;const box=pixelsOf(stroke,config);left=Math.min(left,box.x);top=Math.min(top,box.y);right=Math.max(right,box.right);bottom=Math.max(bottom,box.bottom);if(!reset&&(previous?.lookup.get(stroke.id)??-1)<0)this.mark(stroke,config,dirty)}blocks.set([left,top,right,bottom],block*4);const cost=eachCell({x:left,y:top,right,bottom},config);if(refs+cost<=this.maxIndexRefs){indexed[block]=1;refs+=cost}else overflow+=end-block*BLOCK;if((block+1)%16===0)await pause()}
  let reordered=false
  if(!reset){let oldAt=0,newAt=0,work=0;const old=this.records;for(let index=0;index<old.order.length;index++){old.read(old.order[index]!,stroke,false);if(next.lookup.get(stroke.id)<0)this.mark(stroke,config,dirty);if((index+1)%4096===0)await pause()}
   for(;;){while(oldAt<old.order.length&&next.lookup.get(old.id(old.order[oldAt]!))<0){oldAt++;if(++work%8192===0)await pause()}while(newAt<next.order.length&&old.lookup.get(next.id(next.order[newAt]!))<0){newAt++;if(++work%8192===0)await pause()}if(oldAt===old.order.length||newAt===next.order.length){reordered=oldAt!==old.order.length||newAt!==next.order.length;break}if(old.id(old.order[oldAt++]!)!==next.id(next.order[newAt++]!)){reordered=true;break}if(++work%8192===0)await pause()}
  }
  if(reset||reordered||request.forceFull)this.markAll(config,dirty);for(const rect of request.extraDirty||[])this.markRect(rect,config,dirty);if(cancelled())throw Error('Ink raster cancelled.')
  this.session=request.session;this.records=next;this.blocks=blocks;this.indexed=indexed;this.refs=refs;this.overflow=overflow;this.config=config;this.configKey=key;this.bytes=next.bytes;this.points=next.points;this.dirty=dirty;if(acknowledged)this.lastAck=request.ack
  return{resync:false}
 }
 private async paint(ctx:any,rect:any,cancelled:()=>boolean,selected?:Uint8Array,selectMode=false){
  const config=this.config!,{paintWidth:width,paintHeight:height,region,ratio}=config,unit=width/(region.width*1000);let work=0
  ctx.lineCap='round';ctx.lineJoin='round'
  const x=(n:number)=>(n-region.x)/region.width*width,y=(n:number)=>(n-region.y)/region.height*height
  const stroke=emptyRecord(),order=this.records.order,blocks=this.blocks
  for(let position=0;position<order.length;position++){if(cancelled())return false;if(position%BLOCK===0&&this.indexed[Math.floor(position/BLOCK)]&&!touches(blocks,Math.floor(position/BLOCK)*4,rect)){position=Math.min(order.length,position+BLOCK)-1;if(++work%2048===0)await graphics.yieldTask();continue}if(selected&&!!selected[position]!==selectMode){if(++work%2048===0)await graphics.yieldTask();continue}this.records.read(order[position]!,stroke);if(!stroke.count){if(++work%2048===0)await graphics.yieldTask();continue;}const {view,stride}=stroke;let at=stroke.at,px=x(view.getFloat64(at,true)),py=y(view.getFloat64(at+8,true)),pressure=stroke.pressure?view.getFloat64(at+16,true):.5
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
  const selection=request.selection,config=this.config!,selected=new Uint8Array(this.records.order.length),affected=new Set<number>(),stroke=emptyRecord();let selectedCount=0,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,padding=0,allCells=false
  for(let position=0;position<this.records.order.length;position++){this.records.read(this.records.order[position]!,stroke,false);const box=stroke.box;if(stroke.count&&box.x>=selection.x&&box.y>=selection.y&&box.right<=selection.x+selection.width&&box.bottom<=selection.y+selection.height){selected[position]=1;selectedCount++;const bounds=pixelsOf(stroke,config);padding=Math.max(padding,bounds.reach);left=Math.min(left,bounds.x);top=Math.min(top,bounds.y);right=Math.max(right,bounds.right);bottom=Math.max(bottom,bounds.bottom);if(eachCell(bounds,config)>MAX_CELLS)allCells=true;else eachCell(bounds,config,id=>affected.add(id))}if((position+1)%4096===0){await graphics.yieldTask();if(cancelled())return{cancelled:true,accepted:true}}}
  const allSelected=selectedCount===this.records.order.length,whole={x:0,y:0,width:config.width,height:config.height},tileCount=Math.ceil(config.width/EDGE)*Math.ceil(config.height/EDGE),fixedRects=allSelected?[]:!request.previewBase||allCells||affected.size>Math.max(4,tileCount*.3)?[whole]:[...affected].map(id=>frameRect(config,id)),x=Math.max(0,Math.floor(left)),y=Math.max(0,Math.floor(top)),inkRect=selectedCount?{x,y,width:Math.max(0,Math.min(config.width,Math.ceil(right))-x),height:Math.max(0,Math.min(config.height,Math.ceil(bottom))-y)}:null
  const pixels=fixedRects.reduce((n,rect)=>n+rect.width*rect.height,0)+(inkRect?inkRect.width*inkRect.height:0),scale=Math.min(1,Math.sqrt(MAX_PIXELS/Math.max(1,pixels))),fixed:any[]=[];let ink:any=null
  const paint=async(rect:any,mode:boolean)=>{if(rect.width<=0||rect.height<=0)return null;const canvas=canvasFactory(Math.max(1,Math.floor(rect.width*scale)),Math.max(1,Math.floor(rect.height*scale)));try{const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not paint the selected ink.');if(scale!==1)ctx.scale(scale,scale);if(!await this.paint(ctx,rect,cancelled,selected,mode))return null;return{...rect,bitmap:canvas.transferToImageBitmap()}}finally{canvas.width=1;canvas.height=1}}
  try{for(const rect of fixedRects){if(cancelled())break;const layer=await paint(rect,false);if(layer)fixed.push(layer)}if(inkRect&&!cancelled())ink=await paint(inkRect,true);if(cancelled()){for(const layer of fixed)layer.bitmap.close();ink?.bitmap.close();return{cancelled:true,accepted:true}}return{frame:this.lastFrame,tiles:[],preview:{fixed,ink,clear:!request.previewBase||allSelected,padding}}}catch(error){for(const layer of fixed)layer.bitmap.close();ink?.bitmap.close();throw error}
 }
 async render(request:any,cancelled:()=>boolean=()=>false,canvasFactory=(w:number,h:number)=>new OffscreenCanvas(w,h)){
  const started=globalThis.performance?.now()??Date.now();let sync:any;try{sync=await this.sync(request,cancelled)}catch(error){if(cancelled())return{cancelled:true,accepted:false};throw error}if(sync.resync)return sync;const synced=globalThis.performance?.now()??Date.now();if(request.selection)return this.preview(request,cancelled,canvasFactory)
  const config=this.config!,tileCount=Math.ceil(config.width/EDGE)*Math.ceil(config.height/EDGE),full=this.dirty.size>Math.max(4,tileCount*.3),rects=full?[{x:0,y:0,width:config.width,height:config.height}]:[...this.dirty].map(id=>frameRect(config,id)),tiles:any[]=[]
  try{for(const rect of rects){if(cancelled())break;const canvas=canvasFactory(rect.width,rect.height);try{const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not paint drawing ink.');const complete=await this.paint(ctx,rect,cancelled);if(!complete)break;tiles.push({...rect,bitmap:canvas.transferToImageBitmap()})}finally{canvas.width=1;canvas.height=1}}}catch(error){for(const tile of tiles)tile.bitmap.close();throw error}
  if(cancelled()){for(const tile of tiles)tile.bitmap.close();return{cancelled:true,accepted:true}}
  return{frame:++this.lastFrame,tiles,stats:{syncMs:synced-started,paintMs:(globalThis.performance?.now()??Date.now())-synced,typedBytes:this.records.typedBytes+this.blocks.byteLength+this.indexed.byteLength,indexRefs:this.refs,overflow:this.overflow,binaryBytes:this.bytes,strokeRecords:this.records.size,storedRecords:this.records.storedRecords,points:this.points,tileCount,paintedTiles:rects.length}}
 }
}
