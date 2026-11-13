import React,{useEffect,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {watchPenIn} from './penSettings'
import {installPenActions} from './penActions'
import {installPadPen} from './padPen'
import {forwardPadMirrorPointer,forwardPadMirrorKey} from './padMirrorInput'
import {DrawingLocation} from './DrawingLocation'

type PadState={enabled:boolean,available:boolean,open:boolean,owned:boolean,bounds?:{width:number,height:number}|null}
const FRAME='notemind-pen-display'
export function PadHost({children}:{children:ReactNode}){
 const [state,setState]=useState<PadState|null>(null),[target,setTarget]=useState<HTMLElement|null>(null),[frame,setFrame]=useState(''),[penStatus,setPenStatus]=useState('')
 useEffect(()=>{
  const api=(window as any).notemind?.pad;if(!api)return
  let live=true;const receive=(next:PadState)=>{if(live&&next)setState(next)}
  api.state().then(receive).catch(()=>{});const off=api.onState(receive),offFrame=api.onFrame((data:string)=>{if(live)setFrame(data)})
  const toggle=(event:Event)=>{if((event as CustomEvent).detail==='padToggle')api.set(!state?.enabled).then(receive).catch(()=>{})}
  window.addEventListener('notemind-command',toggle)
  return()=>{live=false;off();offFrame();window.removeEventListener('notemind-command',toggle)}
 },[state?.enabled])
 useEffect(()=>{
  if(!state?.available||!state.enabled||!state.owned){setTarget(null);return}
  let cancelled=false,pad:Window|null=null
  try{
   pad=window.open('about:blank',FRAME)
   if(!pad)return
   const d=pad.document;d.title='NoteMind Drawing';d.head.replaceChildren()
   const base=d.createElement('base');base.href=document.baseURI;d.head.append(base)
   for(const style of document.querySelectorAll('link[rel="stylesheet"],style'))d.head.append(style.cloneNode(true))
   const css=d.createElement('style');css.textContent='html,body,#notemind-pad-root{width:100%;height:100%;margin:0;overflow:hidden}#notemind-pad-root>.tablet-pane{height:100%;width:100%}';d.head.append(css)
   d.body.replaceChildren();const root=d.createElement('div');root.id='notemind-pad-root';d.body.append(root);setTarget(root)
   const lost=()=>{if(!cancelled)setTarget(null)};pad.addEventListener('beforeunload',lost)
   setPenStatus('');const stopWatch=watchPenIn(pad),stopActions=installPenActions(pad),stopPen=installPadPen(pad,(window as any).notemind.pad,status=>setPenStatus(status.reason||''))
   const forward=(event:KeyboardEvent)=>{if(event.defaultPrevented)return;const target=event.target as Element|null;if(target?.closest?.('input, textarea, select, [contenteditable=true]')&&event.key!=='Escape')return;if(!event.ctrlKey&&!event.metaKey&&event.key!=='Escape')return;const again=new KeyboardEvent('keydown',{key:event.key,code:event.code,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey,bubbles:true,cancelable:true});window.dispatchEvent(again);if(again.defaultPrevented)event.preventDefault()}
   pad.addEventListener('keydown',forward)
   const timer=window.setTimeout(()=>{if(!cancelled)(window as any).notemind.pad.ready().catch(()=>{})},50)
   return()=>{cancelled=true;window.clearTimeout(timer);stopPen();stopActions();stopWatch();pad?.removeEventListener('keydown',forward);pad?.removeEventListener('beforeunload',lost);if(pad&&!pad.closed)pad.close()}
  }catch(error){console.error('Could not open the pen display',error);if(pad&&!pad.closed)pad.close();setTarget(null)}
 },[state?.available,state?.enabled,state?.owned])
 if(!target)return <>{children}</>
 const send=(event:React.PointerEvent<HTMLImageElement>,type:'pointerdown'|'pointermove'|'pointerup'|'pointercancel')=>{
  if(event.pointerType!=='mouse')return;const rect=event.currentTarget.getBoundingClientRect();if(!rect.width||!rect.height)return
  if(type==='pointerdown'){event.currentTarget.focus({preventScroll:true});try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}}
  const routed=forwardPadMirrorPointer({type,x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height,button:event.button,buttons:event.buttons,pressure:event.pressure,detail:event.detail,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey})
  if(routed)event.preventDefault()
 }
 const sendKey=(event:React.KeyboardEvent<HTMLImageElement>)=>{if(event.ctrlKey||event.metaKey||event.nativeEvent.isComposing)return;if(forwardPadMirrorKey({type:event.type as 'keydown'|'keyup',key:event.key,code:event.code,repeat:event.repeat,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey})){event.preventDefault();event.stopPropagation()}}
 const wheel=(event:React.WheelEvent<HTMLImageElement>)=>{if(!state?.bounds)return;const r=event.currentTarget.getBoundingClientRect();if(!r.width||!r.height)return;(window as any).notemind.pad.input({type:'mouseWheel',x:(event.clientX-r.left)*state.bounds.width/r.width,y:(event.clientY-r.top)*state.bounds.height/r.height,deltaX:event.deltaX,deltaY:event.deltaY});event.preventDefault()}
 return <><div className="pad-placeholder"><div className="pad-mirror">{frame?<img alt="Drawing on pen display" tabIndex={0} draggable={false} src={'data:image/jpeg;base64,'+frame} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>send(e,'pointerdown')} onPointerMove={e=>send(e,'pointermove')} onPointerUp={e=>send(e,'pointerup')} onPointerCancel={e=>send(e,'pointercancel')} onKeyDown={sendKey} onKeyUp={sendKey} onWheel={wheel}/>:<p>Drawing is on the pen display.</p>}</div>{penStatus&&<p className="pad-status" role="status">{penStatus}</p>}<DrawingLocation /></div>{createPortal(children,target)}</>
}
