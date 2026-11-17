import React,{useEffect,useLayoutEffect,useRef,useState} from 'react'
import {forwardPadMirrorPointer,forwardPadMirrorKey} from './padMirrorInput'

type Viewport={x:number,y:number,width:number,height:number,displayWidth:number,displayHeight:number,turns:number,document:boolean}

export function usePadViewport(root:HTMLElement|null){
 const [viewport,setViewport]=useState<Viewport|null>(null)
 useLayoutEffect(()=>{
  if(!root){setViewport(null);return}
  const view=root.ownerDocument.defaultView!
  const measure=()=>{
   const elements=Array.from(root.querySelectorAll<HTMLElement>('[data-pad-content]'))
   for(const element of elements)resize.observe(element)
   const content=elements.find(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0})
   const r=content?.getBoundingClientRect()
   const next=r?{x:r.left,y:r.top,width:r.width,height:r.height,displayWidth:view.innerWidth,displayHeight:view.innerHeight,turns:Number(root.dataset.padTurns)||0,document:!!content?.closest('.doc-pane')}:null
   setViewport(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next)
  }
  const resize=new ResizeObserver(measure),changes=new MutationObserver(measure)
  resize.observe(root);changes.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','data-pad-turns']})
  view.addEventListener('resize',measure);measure()
  return()=>{resize.disconnect();changes.disconnect();view.removeEventListener('resize',measure)}
 },[root])
 return viewport
}

export function PadMirror({frame,viewport}:{frame:string,viewport:Viewport|null}){
 const stage=useRef<HTMLDivElement>(null),held=useRef<any>(null)
 const [size,setSize]=useState({width:0,height:0})
 useLayoutEffect(()=>{const element=stage.current;if(!element)return;const measure=()=>{const r=element.getBoundingClientRect();setSize(previous=>previous.width===r.width&&previous.height===r.height?previous:{width:r.width,height:r.height})};const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect()},[])
 const cancel=()=>{if(held.current)forwardPadMirrorPointer({...held.current,type:'pointercancel',buttons:0,pressure:0});held.current=null}
 useEffect(()=>{window.addEventListener('blur',cancel);return()=>{window.removeEventListener('blur',cancel);cancel()}},[])
 const q=viewport?.turns||0,odd=q%2!==0,w=viewport?(odd?viewport.height:viewport.width):0,h=viewport?(odd?viewport.width:viewport.height):0
 const scale=w&&h?Math.min(size.width/w,size.height/h):0
 const at=(event:{clientX:number,clientY:number,currentTarget:HTMLElement})=>{
  const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/scale,y=(event.clientY-rect.top)/scale,v=viewport!
  const point=q===1?{x:v.width-y,y:x}:q===2?{x:v.width-x,y:v.height-y}:q===3?{x:y,y:v.height-x}:{x,y}
  return {x:v.x+point.x,y:v.y+point.y}
 }
 const send=(event:React.PointerEvent<HTMLDivElement>,type:'pointerdown'|'pointermove'|'pointerup'|'pointercancel')=>{
  if(event.pointerType!=='mouse'||!viewport||!scale)return
  if(type==='pointerdown'){event.currentTarget.focus({preventScroll:true});try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}}
  const point=at(event),packet={type,x:point.x/viewport.displayWidth,y:point.y/viewport.displayHeight,button:event.button,buttons:event.buttons,pressure:event.pressure,detail:event.detail,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey}
  if(type==='pointerdown'||held.current)held.current=packet
  if(forwardPadMirrorPointer(packet))event.preventDefault()
  if(type==='pointerup'||type==='pointercancel'){held.current=null;try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}}
 }
 const key=(event:React.KeyboardEvent)=>{if(event.ctrlKey||event.metaKey||event.nativeEvent.isComposing||event.keyCode===229)return;if(forwardPadMirrorKey({type:event.type as 'keydown'|'keyup',key:event.key,code:event.code,repeat:event.repeat,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey})){event.preventDefault();event.stopPropagation()}}
 const wheel=(event:React.WheelEvent<HTMLDivElement>)=>{if(!viewport||!scale)return;const point=at(event);(window as any).notemind.pad.input({type:'mouseWheel',...point,deltaX:event.deltaX,deltaY:event.deltaY});event.preventDefault()}
 const unturn=q===1?`translate(0,${h*scale}px) rotate(-90deg)`:q===2?`translate(${w*scale}px,${h*scale}px) rotate(180deg)`:q===3?`translate(${w*scale}px,0) rotate(90deg)`:'none'
 return <div className="pad-mirror" ref={stage} aria-label="Wacom page mirror">
  {frame&&viewport&&scale>0?<div className="pad-mirror-viewport" data-pad-viewport={JSON.stringify(viewport)} style={{width:w*scale,height:h*scale}} tabIndex={0} aria-label="Drawing on pen display. Use the mouse to interact."
   onContextMenu={event=>event.preventDefault()} onPointerDown={event=>send(event,'pointerdown')} onPointerMove={event=>send(event,'pointermove')} onPointerUp={event=>send(event,'pointerup')} onPointerCancel={event=>send(event,'pointercancel')} onLostPointerCapture={cancel} onKeyDown={key} onKeyUp={key} onWheel={wheel}>
   <div className="pad-mirror-image" style={{width:viewport.width*scale,height:viewport.height*scale,transform:unturn}}><img alt="Drawing on pen display" draggable={false} src={'data:image/jpeg;base64,'+frame} style={{width:viewport.displayWidth*scale,height:viewport.displayHeight*scale,left:-viewport.x*scale,top:-viewport.y*scale}}/></div>
  </div>:<p>Opening the drawing page…</p>}
 </div>
}
