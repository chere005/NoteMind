import {useLayoutEffect,useMemo,useRef,useState} from 'react'
import type {Point,Rect,Size} from '@notemind/core'
import type {TabletPage} from './tabletPage'
import {InkSelection} from '../../ink-selection.cjs'
import {selectionMode,selectionRectangle} from '../../ink-selection-input.cjs'

type Sample={point:Point;px:Point}
type Drag={id:number;page:TabletPage;start:Sample;last:Sample;mode:string;moved:boolean;move:boolean;origin:Rect|null;area:Rect|null}
type Options={page:TabletPage;focusRoot:()=>HTMLElement|null;pixelSize:()=>Size;widthScale:()=>number;onEdited:(owner:TabletPage)=>void;onError:(error:any)=>void;finish:()=>void}
export function useInkSelection(options:Options){
 const latest=useRef(options);latest.current=options
 const [count,setCount]=useState(0),[bounds,setBounds]=useState<Rect|null>(null),[marquee,setMarquee]=useState<Rect|null>(null),[area,setArea]=useState<Rect|null>(null),[busy,setBusy]=useState(false),[style,setStyle]=useState<{colour:string|null;width:number|null}>({colour:null,width:null})
 const region=useRef<Rect|null>(null),gestureEpoch=useRef(0)
 const setRegion=(value:Rect|null)=>{region.current=value;setArea(value)}
 const infoJob=useRef<AbortController|null>(null)
 const live=useRef<InkSelection|null>(null),mounted=useRef(false),epoch=useRef(0),drag=useRef<Drag|null>(null),lifetimes=useRef(new WeakMap<object,object>())
 const controller=useMemo(()=>new InkSelection({onChange:model=>{
   if(!mounted.current||live.current!==model)return
   infoJob.current?.abort();const job=new AbortController();infoJob.current=job;const version=++epoch.current;setCount(model.bits.count)
   if(!model.bits.count){setBounds(null);setRegion(null);setStyle({colour:null,width:null});return}
   void Promise.all([model.bounds({signal:job.signal}),model.style({signal:job.signal})]).then(([value,look])=>{if(mounted.current&&live.current===model&&epoch.current===version){setBounds(value);setStyle(look)}}).catch(error=>{if(error.name!=='AbortError')latest.current.onError(error)})
 }}),[options.page])
 useLayoutEffect(()=>{
   mounted.current=true;live.current=controller;setBusy(!!controller.editJob);setMarquee(null);setRegion(null);const token={};lifetimes.current.set(controller,token);controller.bind(options.page)
   return()=>{
     mounted.current=false;infoJob.current?.abort();if(drag.current?.page===options.page)drag.current=null
     // A command accepted before a portal/tab unmount still belongs to its old page.
     queueMicrotask(()=>{if(lifetimes.current.get(controller)!==token||live.current===controller&&mounted.current)return
       controller.queryJob?.controller.abort()
       void controller.pending().catch(()=>{}).finally(()=>controller.dispose())
     })
   }
 },[controller,options.page])
 const failed=(error:any)=>{if(error?.name!=='AbortError')latest.current.onError(error)}
 const run=(action:any)=>{
   const model=controller,owner=model.ownerPage();if(!owner||model.editJob)return Promise.resolve(false)
   latest.current.finish();setBusy(true)
   const selectedArea=region.current
   const pending=model.edit(action)
   void pending.then(changed=>{if(changed){
     if(action.type==='move'&&selectedArea&&region.current===selectedArea&&mounted.current&&live.current===model){
       setRegion({...selectedArea,x:selectedArea.x+action.dx,y:selectedArea.y+action.dy})
     }
     latest.current.onEdited(owner)
   }}).catch(failed).finally(()=>{if(mounted.current&&live.current===model)setBusy(false)})
   return pending
 }
 useLayoutEffect(()=>{
   const element=latest.current.focusRoot(),doc=element?.ownerDocument;if(!element||!doc)return
   const key=(event:KeyboardEvent)=>{
     if(event.defaultPrevented||event.isComposing||event.keyCode===229)return
     const active=doc.activeElement as HTMLElement|null,target=event.target as HTMLElement|null
     if(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]'))return
     if(!element.contains(active))return
     if(event.key==='Escape'&&(controller.bits.count||drag.current||region.current||controller.queryJob)){event.preventDefault();event.stopPropagation();clear()}
     else if((event.key==='Delete'||event.key==='Backspace')&&controller.bits.count&&!controller.editJob){event.preventDefault();event.stopPropagation();void run({type:'delete'})}
     else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&!event.ctrlKey&&!event.metaKey&&controller.bits.count&&!controller.editJob){event.preventDefault();event.stopPropagation();const scale=latest.current.pixelSize(),step=event.shiftKey?10:1;void run({type:'move',dx:(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)/Math.max(1,scale.width),dy:(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)/Math.max(1,scale.height)})}
     else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'&&controller.bits.count&&!controller.editJob){event.preventDefault();event.stopPropagation();void run({type:'duplicate'})}
   }
   doc.addEventListener('keydown',key,true);return()=>doc.removeEventListener('keydown',key,true)
 },[controller])
 const clear=()=>{gestureEpoch.current++;controller.clear();drag.current=null;setMarquee(null);setRegion(null)}
 const begin=(event:PointerEvent,sample:Sample,press:any)=>{
   if(controller.editJob||drag.current)return false
   const mode=selectionMode(event,press),area=bounds,scale=latest.current.pixelSize(),slopX=6/Math.max(1,scale.width),slopY=6/Math.max(1,scale.height)
   const moving=mode==='replace'&&!!count&&!!area&&sample.point.x>=area.x-slopX&&sample.point.x<=area.x+area.width+slopX&&sample.point.y>=area.y-slopY&&sample.point.y<=area.y+area.height+slopY
   drag.current={id:event.pointerId,page:options.page,start:sample,last:sample,mode,moved:false,move:moving,origin:area?{...area}:null,area:region.current}
   gestureEpoch.current++;controller.queryJob?.controller.abort();setMarquee(null);setRegion(null);return true
 }
 const move=(event:PointerEvent,sample:Sample)=>{
   const g=drag.current;if(!g||g.id!==event.pointerId)return false
   g.last=sample;g.moved ||=Math.hypot(sample.px.x-g.start.px.x,sample.px.y-g.start.px.y)>4
   if(g.move&&g.origin){if(g.moved)setBounds({...g.origin,x:g.origin.x+sample.point.x-g.start.point.x,y:g.origin.y+sample.point.y-g.start.point.y})}
   else if(g.moved)setMarquee(selectionRectangle(g.start,sample))
   return true
 }
 const end=(cancelled=false)=>{
   const g=drag.current;if(!g)return;drag.current=null;setMarquee(null)
   if(cancelled){if(g.origin)setBounds(g.origin);setRegion(g.area);return}
   if(g.move){
     const dx=g.last.point.x-g.start.point.x,dy=g.last.point.y-g.start.point.y
     setRegion(g.area)
     if(g.moved)void run({type:'move',dx,dy})
     return
   }
   const scale=latest.current.pixelSize(),settings={mode:g.mode,scaleX:Math.max(1,scale.width),scaleY:Math.max(1,scale.height),widthScale:latest.current.widthScale(),radius:6}
   const box=selectionRectangle(g.start,g.last),version=gestureEpoch.current
   if(!box){void controller.click(g.last.point,settings).catch(failed);return}
   const {x,y,width,height}=box
   void controller.lasso([{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}],settings).then(()=>{
     if(g.mode==='replace'&&mounted.current&&live.current===controller&&gestureEpoch.current===version)setRegion(box)
   }).catch(failed)
 }
 return{controller,count,bounds,marquee,area,busy,style,run,clear,begin,move,end,active:(id:number)=>drag.current?.id===id,pendingGesture:()=>!!drag.current,finish:()=>end(false),cancel:()=>{end(true);controller.cancel()}}
}
