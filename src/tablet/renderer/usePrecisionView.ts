import {useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react'
import type {Point,Rect,Size} from '@notemind/core'
import type {TabletPage} from './tabletPage'
import {PrecisionView,viewport,fit,lockScale,zoomAt,pan} from '../../precision-view.cjs'
import {elementPoint} from './padCoordinates'

// A portal remount retains only view scalars, keyed weakly by its owning page.
const savedViews=new WeakMap()
let toolState={line:false,angle:0};const toolListeners=new Set<()=>void>(),subscribeTools=(listener:()=>void)=>{toolListeners.add(listener);return()=>toolListeners.delete(listener)},readTools=()=>toolState,changeTools=(change:Partial<typeof toolState>)=>{toolState={...toolState,...change};for(const listener of toolListeners)listener()}
type Options={page:TabletPage;focusRoot:()=>HTMLElement|null;beforeChange:()=>void;onViewport:(view:Rect)=>void;onError:(error:any)=>void;
 onDrawingZoom?:(zoom:number|null)=>void}
export function usePrecisionView(options:Options){
 const latest=useRef(options);latest.current=options
 const model=useRef<InstanceType<typeof PrecisionView>|null>(null);
 model.current ||=new PrecisionView({stateCache:savedViews,minZoom:options.onDrawingZoom ? .5 : 1})
 const [zoom,setZoom]=useState(1),[panArmed,setPanArmed]=useState(false),[panning,setPanning]=useState(false)
 const {line,angle}=useSyncExternalStore(subscribeTools,readTools,readTools)
 const dragging=useRef<{id:number;last:Point}|null>(null)
 const reportZoom=()=>{const state=model.current!.state;setZoom(state.zoom);latest.current.onDrawingZoom?.(state.fixedScale?state.zoom:null)}
 const apply=()=>{reportZoom();latest.current.onViewport(viewport(model.current!.state))}
 const configure=(frame:Rect,size:Size,aspect:number)=>{model.current!.bind(latest.current.page,{frame,size,aspect});reportZoom();return viewport(model.current!.state)}
 const change=(update:any)=>{if(model.current!.owner?.deref()!==latest.current.page)return;latest.current.beforeChange();model.current!.change(update);apply()}
 const zoomBy=(factor:number,anchor?:Point)=>change(state=>zoomAt(latest.current.onDrawingZoom?lockScale(state):state,factor,anchor))
 const magnify=(zoom:number)=>change(state=>zoomAt(lockScale(state),zoom/state.zoom))
 const fitPage=()=>change(fit)
 const beginPan=(event:PointerEvent,point:Point)=>{latest.current.beforeChange();dragging.current={id:event.pointerId,last:point};setPanning(true)}
 const movePan=(event:PointerEvent,point:Point)=>{const g=dragging.current;if(!g||g.id!==event.pointerId)return false;const delta={x:point.x-g.last.x,y:point.y-g.last.y};g.last=point;model.current!.change(state=>pan(state,delta));apply();return true}
 const endPan=()=>{dragging.current=null;setPanning(false)}
 useLayoutEffect(()=>{
   const element=latest.current.focusRoot(),doc=element?.ownerDocument,view=doc?.defaultView;if(!element||!doc||!view)return
   const editable=(event:KeyboardEvent)=>{const target=event.target as HTMLElement|null;return target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]')}
   const key=(event:KeyboardEvent)=>{if(event.defaultPrevented||event.isComposing||event.keyCode===229||editable(event)||!element.contains(doc.activeElement))return
     if(event.code==='Space'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setPanArmed(true)}
     else if(event.ctrlKey||event.metaKey){if(event.key==='0'){event.preventDefault();event.stopPropagation();fitPage()}else if(event.key==='+'||event.key==='='){event.preventDefault();event.stopPropagation();zoomBy(2)}else if(event.key==='-'){event.preventDefault();event.stopPropagation();zoomBy(.5)}}
   }
   const release=(event?:KeyboardEvent)=>{if(!event||event.code==='Space'){setPanArmed(false);if(!event)endPan()}}
   const wheel=(event:WheelEvent)=>{const state=model.current!.state;if(!event.ctrlKey&&!event.metaKey&&state.zoom<=1){const view=viewport(state);if(!state.fixedScale||view.width>=state.frame.width&&view.height>=state.frame.height)return}event.preventDefault();event.stopPropagation();try{
     if(event.ctrlKey||event.metaKey){const p=elementPoint(element,event),dy=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?state.stage.height:1);zoomBy(Math.exp(Math.max(-6,Math.min(6,-dy*.002))),{x:p.x,y:p.y})}
     else{latest.current.beforeChange();const first=elementPoint(element,event),last=elementPoint(element,{clientX:event.clientX+event.deltaX*(event.deltaMode===1?16:event.deltaMode===2?state.stage.width:1),clientY:event.clientY+event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?state.stage.height:1)});model.current!.change(value=>pan(value,{x:first.x-last.x,y:first.y-last.y}));apply()}
   }catch(error){latest.current.onError(error)}}
   const command=(event:CustomEvent)=>{if(!['zoomIn','zoomOut','zoomReset'].includes(event.detail))return;const root=element.closest('.tablet-host'),active=doc.activeElement,main=document.activeElement,here=doc===document?root?.contains(active):doc.hasFocus()&&root?.contains(active),mirror=doc!==document&&main?.closest?.('.pad-placeholder .pad-mirror')&&root?.contains(active);if(!here&&!mirror)return;event.preventDefault();event.stopImmediatePropagation();if(event.detail==='zoomReset')fitPage();else zoomBy(event.detail==='zoomIn'?2:.5)}
   window.addEventListener('notemind-command',command,true)
   doc.addEventListener('keydown',key,true);doc.addEventListener('keyup',release);element.addEventListener('wheel',wheel,{passive:false})
   const blur=()=>release()
   // Store the same function for removal; hidden/secondary views never gain focus here.
   view.addEventListener('blur',blur)
   return()=>{dragging.current=null;window.removeEventListener('notemind-command',command,true);doc.removeEventListener('keydown',key,true);doc.removeEventListener('keyup',release);view.removeEventListener('blur',blur);element.removeEventListener('wheel',wheel)}
 },[options.page])
 return{configure,zoom,zoomBy,magnify,fit:fitPage,panArmed,panning,beginPan,movePan,endPan,active:(id:number)=>dragging.current?.id===id,pendingGesture:()=>!!dragging.current,line,angle,setLine:(enabled:boolean)=>{latest.current.beforeChange();changeTools({line:enabled})},setAngle:(value:number)=>{latest.current.beforeChange();changeTools({angle:value})}}
}
