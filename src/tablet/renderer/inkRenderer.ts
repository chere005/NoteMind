import graphics from '../../graphics-pane.js'
import {renderInk,cancelInk,holdDrawingWorker} from '../../drawing-export.js'

type Scene={page:object;strokes:any[];aspect:number;config:any;forceFull?:boolean;selection?:any;previewBase?:boolean;extraDirty?:any[];session?:string;generation?:number}
const closeFrame=(frame:any)=>{for(const tile of [...(frame?.tiles||[]),...(frame?.preview?.fixed||[]),...(frame?.preview?.ink?[frame.preview.ink]:[])])tile.bitmap?.close()}

/** One in-flight scene and one latest replacement; source points are never cloned or mutated. */
export class InkRenderer{
 ids=new WeakMap<object,number>();nextId=1;known=new Set<number>();session='';page:object|null=null;generation=0;ack=0;full=true;pending:any=null;active:any=null;running=false;disposed=false;waiters:(()=>void)[]=[];life=new AbortController();release:()=>void
 constructor(private options:{render?:typeof renderInk;cancel?:typeof cancelInk;hold?:typeof holdDrawingWorker;pack?:typeof graphics.encodeBytesAsync;id?:()=>string}={}){this.release=(options.hold||holdDrawingWorker)()}
 private freshId(){return (this.options.id||(()=>crypto.randomUUID()))()}
 request(source:Scene,onFrame:(frame:any,scene:Scene)=>boolean,onError?:(error:any,scene:Scene,current:()=>boolean)=>any,onDispose?:()=>void){
  if(this.disposed)return
  if(source.page!==this.page){if(this.session)(this.options.cancel||cancelInk)(this.session);this.page=source.page;this.session=this.freshId();this.known.clear();this.ack=0;this.full=true}
  const scene={...source,selection:source.selection?{...source.selection}:null,extraDirty:source.extraDirty?.map(rect=>({...rect})),config:{...source.config,region:{...source.config.region},paper:{...source.config.paper}},session:this.session,generation:++this.generation}
  this.pending?.onDispose?.();this.pending={scene,onFrame,onError,onDispose,retries:0}
  if(this.active){this.active.controller.abort();if(this.active.posted)(this.options.cancel||cancelInk)(this.active.item.scene.session)}
  if(!this.running){this.running=true;void Promise.resolve().then(()=>this.pump())}
 }
 current(scene:Scene){return !this.disposed&&scene.session===this.session&&scene.generation===this.generation}
 private async build(scene:Scene,signal:AbortSignal){
  const order=new Float64Array(scene.strokes.length),added:any[]=[],addIds:number[]=[],used=new Set<number>(),full=this.full
  for(let i=0;i<scene.strokes.length;i++){
   if(signal.aborted||!this.current(scene))return null
   const stroke=scene.strokes[i]!;let id=this.ids.get(stroke);if(!id){id=this.nextId++;this.ids.set(stroke,id)}order[i]=id
   if(!used.has(id)&&(full||!this.known.has(id))){added.push(stroke);addIds.push(id)}used.add(id)
   if((i+1)%8192===0)await graphics.yieldTask()
  }
  const additions=added.length?await (this.options.pack||graphics.encodeBytesAsync)({name:'Ink',aspect:scene.aspect,strokes:added,paper:scene.config.paper,backdrop:null},{signal}):null
  if(signal.aborted||!this.current(scene))return null
  return{used,request:{session:scene.session,full,ack:this.ack,order,additions,addIds:Float64Array.from(addIds),config:scene.config,forceFull:!!scene.forceFull,selection:scene.selection,previewBase:scene.previewBase,extraDirty:scene.extraDirty}}
 }
 private async pump(){
  while(this.pending&&!this.disposed){const item=this.pending;this.pending=null;const active=this.active={item,controller:new AbortController(),posted:false};let built:any
   try{
    built=await this.build(item.scene,active.controller.signal);if(!built)continue;active.posted=true
    const frame=await (this.options.render||renderInk)(built.request,{signal:this.life.signal})
    if(frame.resync){if(item.scene.session===this.session){this.known.clear();this.full=true;if(this.current(item.scene)&&item.retries++<2)this.pending=item;else if(this.current(item.scene))throw Error('Drawing paint could not resynchronize.')}continue}
    if(item.scene.session===this.session&&frame.accepted!==false){this.known=built.used;this.full=false}
    if(frame.cancelled){if(this.current(item.scene)&&!this.pending){if(item.retries++<2)this.pending=item;else throw Error('Drawing paint was repeatedly interrupted.')}continue}
    try{if(this.current(item.scene)&&item.onFrame(frame,item.scene))this.ack=frame.frame}finally{closeFrame(frame)}
   }catch(error){if(this.disposed)break;if(this.current(item.scene)){this.full=true;this.known.clear();await item.onError?.(error,item.scene,()=>this.current(item.scene))}}
   finally{if(this.pending!==item)item.onDispose?.();this.active=null}
  }
  this.running=false;for(const resolve of this.waiters.splice(0))resolve()
 }
 whenIdle(){return !this.disposed&&(this.running||this.pending)?new Promise<void>(resolve=>this.waiters.push(resolve)):Promise.resolve()}
 dispose(){if(this.disposed)return;this.disposed=true;this.pending?.onDispose?.();this.pending=null;this.active?.controller.abort();this.life.abort();if(this.session)(this.options.cancel||cancelInk)(this.session);this.release();for(const resolve of this.waiters.splice(0))resolve()}
}
