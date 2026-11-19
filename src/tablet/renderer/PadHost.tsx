import React,{useEffect,useLayoutEffect,useMemo,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {watchPenIn} from './penSettings'
import {installPenActions} from './penActions'
import {installPadPen} from './padPen'
import {PaneChromeContext,type PaneChromeSlot} from './PaneChrome'
import {PadMirror,usePadViewport} from './PadMirror'
import {useOrientation,usePadChromeOrientation} from './orientation'
import {padOrientationLayout} from './padOrientation'
import {watchLive} from './penLive'

type PadState={enabled:boolean,available:boolean,open:boolean,owned:boolean,bounds?:{width:number,height:number}|null,rotation?:number}
const FRAME='notemind-pen-display'
export function PadHost({children}:{children:ReactNode}){
 const [state,setState]=useState<PadState|null>(null),[target,setTarget]=useState<HTMLElement|null>(null),[frame,setFrame]=useState('')
 const [chromeRoot,setChromeRoot]=useState<HTMLDivElement|null>(null),orientation=useOrientation(),follow=usePadChromeOrientation()
 const [overlay,setOverlay]=useState<HTMLElement|null>(null)
 const viewport=usePadViewport(target)
 const chrome=useMemo(()=>chromeRoot?{...Object.fromEntries(['tabs','pen','header','find','footer'].map(slot=>[slot,chromeRoot.querySelector<HTMLElement>('[data-pane-slot='+slot+']')])),overlay} as Partial<Record<PaneChromeSlot,HTMLElement>>:null,[chromeRoot,overlay])
 useLayoutEffect(()=>{if(!target)return;const view=target.ownerDocument.defaultView!;const apply=()=>{const layout=padOrientationLayout(view.innerWidth,view.innerHeight,orientation,state?.rotation||0,follow);Object.assign(target.style,{width:layout.width+'px',height:layout.height+'px',transformOrigin:'0 0',transform:layout.transform});target.dataset.padTurns=String(layout.turns)};apply();view.addEventListener('resize',apply);return()=>view.removeEventListener('resize',apply)},[target,orientation,state?.rotation,follow])
 useEffect(()=>{
  const api=(window as any).notemind?.pad;if(!api)return
  let live=true;const receive=(next:PadState)=>{if(live&&next)setState(next)}
  api.state().then(receive).catch(()=>{});const off=api.onState(receive),offFrame=api.onFrame((data:string)=>{if(live)setFrame(data)})
  return()=>{live=false;off();offFrame()}
 },[])
 useEffect(()=>{
  if(!state?.available||!state.enabled||!state.owned){setTarget(null);return}
  let cancelled=false,pad:Window|null=null
  try{
   pad=window.open('about:blank',FRAME)
   if(!pad)return
   const d=pad.document;d.title='NoteMind Drawing';d.head.replaceChildren()
   for(const policy of document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]'))d.head.append(policy.cloneNode(true))
   const base=d.createElement('base');base.href=document.baseURI;d.head.append(base)
   for(const style of document.querySelectorAll('link[rel="stylesheet"],style'))d.head.append(style.cloneNode(true))
   const css=d.createElement('style');css.textContent='html,body,#notemind-pad-root{width:100%;height:100%;margin:0;overflow:hidden}#notemind-pad-root>.tablet-pane{height:100%;width:100%}';d.head.append(css)
   d.body.replaceChildren();const root=d.createElement('div');root.id='notemind-pad-root';d.body.append(root);setTarget(root)
   const lost=()=>{if(!cancelled)setTarget(null)};pad.addEventListener('beforeunload',lost)
   const stopTooltips=(window as any).NoteMindTooltips?.install(d),stopToolbar=(window as any).NoteMindToolbarKeys?.(pad.document),stopLive=watchLive(pad),stopWatch=watchPenIn(pad),stopActions=installPenActions(pad),stopPen=installPadPen(pad,(window as any).notemind.pad,()=>{})
   let lastActivity=-Infinity
   const activity=(event:Event)=>{if(event.type==='pointermove'&&!(event as PointerEvent).buttons)return;const now=performance.now();if(now-lastActivity<100)return;lastActivity=now;(window as any).notemind.pad.activity?.()}
   const activityEvents=['pointerdown','pointerup','pointermove','keydown','wheel','input','change']
   for(const type of activityEvents)d.addEventListener(type,activity,true)
   const forward=(event:KeyboardEvent)=>{if(event.defaultPrevented||event.isComposing||event.keyCode===229)return;const target=event.target as Element|null;if(target?.closest?.('input, textarea, select, [contenteditable=true]')&&event.key!=='Escape')return;if(!event.ctrlKey&&!event.metaKey&&event.key!=='Escape')return;const again=new KeyboardEvent('keydown',{key:event.key,code:event.code,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey,bubbles:true,cancelable:true});window.dispatchEvent(again);if(again.defaultPrevented)event.preventDefault()}
   pad.addEventListener('keydown',forward)
   const timer=window.setTimeout(()=>{if(!cancelled)(window as any).notemind.pad.ready().catch(()=>{})},50)
   return()=>{cancelled=true;window.clearTimeout(timer);stopPen();stopActions();stopWatch();stopLive?.();stopToolbar?.();stopTooltips?.();for(const type of activityEvents)d.removeEventListener(type,activity,true);pad?.removeEventListener('keydown',forward);pad?.removeEventListener('beforeunload',lost);if(pad&&!pad.closed)pad.close()}
  }catch(error){console.error('Could not open the pen display',error);if(pad&&!pad.closed)pad.close();setTarget(null)}
 },[state?.available,state?.enabled,state?.owned])
 return <PaneChromeContext.Provider value={chrome}>
  {target&&<div ref={setChromeRoot} className={'pad-placeholder tablet-pane camera'+(viewport?.document?' doc-pane':'')}>
   <div className="pane-chrome-slot" data-pane-slot="tabs"/>
   <div className="pane-chrome-slot" data-pane-slot="pen"/>
   <div className="pane-chrome-slot" data-pane-slot="header"/>
   <div className="pane-chrome-slot" data-pane-slot="find"/>
   <PadMirror frame={frame} viewport={viewport} overlayRef={setOverlay}/>
   <div className="pane-chrome-slot" data-pane-slot="footer"/>
  </div>}
  {target?createPortal(children,target):children}
 </PaneChromeContext.Provider>
}
