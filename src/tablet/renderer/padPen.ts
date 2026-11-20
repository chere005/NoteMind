import type {PenSample} from '../shared/pen'
import {createDispatcher,SYNTH_POINTER_ID,type DispatchEnv} from './penFeed'
import {createGate} from './penGate'
import {cancelPenTap} from './penActions'
import {registerPadMirrorInput} from './padMirrorInput'

// The exclusive display feed is hit-tested in the display window, without moving the system mouse.
export function createPadDispatcher(env:Omit<DispatchEnv,'turns'|'surface'>){
 let resetting=false
 const dispatcher=createDispatcher({...env,turns:()=>0,clickable:target=>resetting?null:env.clickable(target)})
 return {batch:(samples:PenSample[])=>dispatcher.batch(samples.map(s=>({...s,y:1-s.y}))),reset(){resetting=true;try{dispatcher.reset()}finally{resetting=false}}}
}
export function installPadPen(view:Window,api:any,onStatus:(value:any)=>void):()=>void{
 const doc=view.document,gate=createGate({target:view,root:doc.documentElement,now:Date.now}),offGate=gate.install()
 gate.setState({available:true,enabled:true,sheetShowing:true,opened:true})
 const offMirror=registerPadMirrorInput(view as Window & typeof globalThis,fn=>gate.emit(fn))
 const keys={ctrlKey:false,altKey:false,shiftKey:false,metaKey:false}
 const dispatcher=createPadDispatcher({
  sheetRect:()=>view.closed?null:{left:0,top:0,width:view.innerWidth,height:view.innerHeight},
  elementAt:(x,y)=>doc.elementFromPoint(x,y),fallbackTarget:()=>doc.body,modifiers:()=>({...keys}),
  dispatch(target,init){const flat=init.type==='pointerenter'||init.type==='pointerleave';gate.emit(()=>target.dispatchEvent(new (view as any).PointerEvent(init.type,{...init,pointerId:SYNTH_POINTER_ID,pointerType:'pen',isPrimary:true,width:1,height:1,bubbles:!flat,cancelable:!flat,composed:true,view,screenX:view.screenX+init.clientX,screenY:view.screenY+init.clientY})))},
  clickable(target){const button=target.closest<HTMLElement>('button,[role="button"],[role="tab"],summary,a[href]');if(!button||button.closest('[data-tablet="surface"]')||button.matches(':disabled,[aria-disabled="true"]'))return null;return button},
  handover:target=>target.closest('[data-pen-handover]')?doc.querySelector('[data-tablet="surface"]'):null,
 })
 let active=true
 const offSamples=api.onPenSamples((samples:PenSample[])=>{if(!active||view.closed||gate.domContact())return;try{if(samples.length){const inRange=samples[samples.length-1].inRange;if(!inRange)cancelPenTap();gate.setState({nativeLive:inRange})}if(samples.some(s=>s.tip))gate.noteTip();dispatcher.batch(samples)}catch{active=false;dispatcher.reset();gate.setState({nativeLive:false});api.penStop()}})
 const offStatus=api.onPenStatus((status:any)=>{onStatus(status);if(status.state!=='active'){cancelPenTap();dispatcher.reset();gate.setState({nativeLive:false})}})
 const offFault=gate.onSelfOpen(()=>{active=false;dispatcher.reset();api.penStop()})
 const track=(event:KeyboardEvent)=>{keys.ctrlKey=event.ctrlKey;keys.altKey=event.altKey;keys.shiftKey=event.shiftKey;keys.metaKey=event.metaKey}
 const clear=()=>{keys.ctrlKey=keys.altKey=keys.shiftKey=keys.metaKey=false}
 view.addEventListener('keydown',track,true);view.addEventListener('keyup',track,true);view.addEventListener('blur',clear)
 const heartbeat=()=>{if(active&&!view.closed)api.penHeartbeat()};heartbeat();const timer=window.setInterval(heartbeat,250)
 return ()=>{active=false;window.clearInterval(timer);offSamples();offStatus();offFault();dispatcher.reset();offMirror();offGate();api.penStop();view.removeEventListener('keydown',track,true);view.removeEventListener('keyup',track,true);view.removeEventListener('blur',clear)}
}
