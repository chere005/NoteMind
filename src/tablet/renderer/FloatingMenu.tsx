import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { chordGlyphs } from "../shared/chord"
import { hostPlatform } from "./hostPlatform"
import { Icon, type IconName } from "./icons"
import { menuLeft } from "./splitButton"

export type MenuItem =
  | "-"
  /** A small caption over the rows that follow ("regions", "Colour"). */
  | { header: string }
  /** A row the menu does not make itself (the pen's swatches and widths). Its buttons join the arrow keys. A function is given the way to close the menu. */
  | { custom: ReactNode | ((close: () => void) => ReactNode) }
  | {
    label: string
    onClick?: () => void
    disabled?: boolean
    /** Items that open beside this one. */
    submenu?: MenuItem[]
    /** A word shown on the right (a key, a count). */
    hint?: string
    /** A line icon before the label (icons.tsx). */
    icon?: IconName
    /** A check mark before the label: true is the current choice, false keeps the column (the menu lines up). */
    checked?: boolean
    /** The label set in its own style (the Style menu shows each level in its own weight and size). */
    labelStyle?: CSSProperties
    /** A switch on the right instead of a hint; its state. The menu stays up when it is clicked. */
    toggle?: boolean
    /** The menu stays up after the click (Turn Left, a switch). */
    keepOpen?: boolean
    /** Test hook: `data-bar` on the row's button. */
    dataBar?: string
    /** Drawn as a warning (Move to Trash…). */
    danger?: boolean
  }

type CloseReason="dismiss"|"action"|"outside"|"switch"
interface Props {
  x: number; y: number; items: MenuItem[]
  above?: boolean; right?: boolean; leftX?: number
  onClose(reason?:CloseReason): void
  trigger?:HTMLElement
  triggerKey?:string
  id?: string; dataBar?: string; label?: string
  ownerDocument?: Document
  returnTo?: HTMLElement | null
  initialFocus?: "first" | "last" | "none"
}

// Menus belong to their triggering window, including the separate pen display.
export function FloatingMenu({x,y,items,above,right,leftX,onClose,id,dataBar,label="Actions",ownerDocument:doc=document,returnTo,trigger,triggerKey,initialFocus="none"}:Props) {
  const token=useId(),restore=useRef(true),closing=useRef(false),back=useRef(returnTo??doc.activeElement),window=doc.defaultView!
  const dismiss=(focus=true,reason:CloseReason="dismiss")=>{if(closing.current)return;closing.current=true;restore.current=focus;onClose(reason)}
  useLayoutEffect(()=>{
    const opening=(event:CustomEvent)=>{if(event.detail!==token)dismiss(false,"switch")}
    doc.dispatchEvent(new window.CustomEvent("notemind-menu-opening",{detail:token}))
    doc.addEventListener("notemind-menu-opening",opening as EventListener)
    // The opening button handles its own toggle on click, after the complete pointer press.
    const onTrigger=(target:Element)=>trigger?.matches('button,[role="button"]')&&trigger.contains(target)||!!triggerKey&&target?.closest?.('button,[role="button"]')?.getAttribute('data-menu-trigger')===triggerKey
    const away=(event:PointerEvent)=>{const target=event.target as Element;if(!onTrigger(target)&&target?.closest?.('[data-menu-owner]')?.getAttribute('data-menu-owner')!==token)dismiss(false,"outside")}
    const focusAway=(event:FocusEvent)=>{const target=event.target as Element;if(!onTrigger(target)&&target?.closest?.('[data-menu-owner]')?.getAttribute('data-menu-owner')!==token)dismiss(false,"outside")}
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();dismiss()}}
    const resized=()=>dismiss(false,"outside")
    const commanded=()=>dismiss(false,"outside")
    doc.addEventListener("pointerdown",away,true);doc.addEventListener("focusin",focusAway);doc.addEventListener("notemind-menu-dismiss",commanded);window.addEventListener("keydown",escape);window.addEventListener("resize",resized);window.addEventListener("blur",resized)
    return()=>{doc.removeEventListener("notemind-menu-opening",opening as EventListener);doc.removeEventListener("pointerdown",away,true);doc.removeEventListener("focusin",focusAway);doc.removeEventListener("notemind-menu-dismiss",commanded);window.removeEventListener("keydown",escape);window.removeEventListener("resize",resized);window.removeEventListener("blur",resized)}
  },[])
  useEffect(()=>()=>{
    if(!restore.current||window.closed)return
    window.setTimeout(()=>{let previous=back.current as HTMLElement;const active=doc.activeElement as HTMLElement;if(doc.querySelector('dialog[open],.float-menu'))return;if(active&&active!==doc.body&&active.isConnected&&!active.closest('.float-menu'))return;if(!previous?.isConnected&&triggerKey)previous=[...doc.querySelectorAll<HTMLElement>('[data-menu-trigger]')].find(button=>button.getAttribute('data-menu-trigger')===triggerKey);if(previous?.isConnected&&previous.getClientRects().length)previous.focus({preventScroll:true})},0)
  },[])
  const tab=(event:React.KeyboardEvent)=>{
    event.preventDefault();restore.current=false
    const controls=[...doc.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex],[contenteditable=true]')].filter(el=>!el.closest('.float-menu')&&!el.matches(':disabled,[tabindex="-1"]')&&el.getClientRects().length)
    const at=controls.indexOf(back.current as HTMLElement),next=controls[at+(event.shiftKey?-1:1)]
    onClose("dismiss");window.setTimeout(()=>next?.focus({preventScroll:true}),0)
  }
  return createPortal(<MenuLevel items={items} doc={doc} token={token} id={id||token} dataBar={dataBar} label={label} point={{x,y,above,right,leftX}} initialFocus={initialFocus} onClose={reason=>dismiss(true,reason)} onTab={tab}/>,doc.body)
}

interface LevelProps {
  items:MenuItem[];doc:Document;token:string;id:string;label:string
  dataBar?:string;point?:{x:number;y:number;above?:boolean;right?:boolean;leftX?:number};anchor?:HTMLElement
  initialFocus?:"first"|"last"|"none"
  onClose(reason?:CloseReason):void;onTab(event:React.KeyboardEvent):void;onBack?():void
}
function MenuLevel({items,doc,token,id,label,dataBar,point,anchor,initialFocus="none",onClose,onTab,onBack}:LevelProps) {
  const box=useRef<HTMLDivElement>(null),[at,setAt]=useState({x:point?.x||0,y:point?.y||0}),[open,setOpen]=useState<{index:number;anchor:HTMLElement;keyboard:boolean}|null>(null),typed=useRef({text:'',time:0}),[activeIndex,setActiveIndex]=useState<number|null>(null)
  const buttons=()=>[...box.current.querySelectorAll<HTMLElement>(':scope > .float-row > button:not(:disabled),:scope > .float-custom button:not(:disabled),:scope > .float-custom select:not(:disabled),:scope > .float-custom input:not(:disabled)')]
  const focus=(element:HTMLElement)=>{if(!element)return;setActiveIndex(element.hasAttribute('data-menu-index')?Number(element.getAttribute('data-menu-index')):null);element.focus()}
  useLayoutEffect(()=>{
    const element=box.current,win=doc.defaultView!,width=element.offsetWidth,height=element.offsetHeight
    let left,top
    if(anchor){const r=anchor.getBoundingClientRect();left=r.right+2+width<=win.innerWidth-4?r.right+2:Math.max(4,r.left-width-2);top=Math.max(4,Math.min(r.top-5,win.innerHeight-height-4))}
    else{left=menuLeft(width,point.x,!!point.right,point.leftX,win.innerWidth);top=point.above?Math.max(4,point.y-height):Math.max(4,Math.min(point.y,win.innerHeight-height-4))}
    setAt({x:left,y:top})
  },[items,anchor,point?.x,point?.y])
  useLayoutEffect(()=>{if(anchor&&initialFocus==="none")return;const list=buttons();focus(initialFocus==='first'?list[0]:initialFocus==='last'?list.at(-1):box.current)},[])
  const ticks=items.some(item=>typeof item==='object'&&'label' in item&&item.checked!==undefined)
  return <div ref={box} className={'float-menu'+(anchor?' sub':'')} role="menu" aria-label={label} id={id} data-bar={dataBar} data-menu-owner={token} tabIndex={-1} style={{left:at.x,top:at.y}} onScroll={()=>setOpen(null)} onContextMenu={event=>{event.preventDefault();event.stopPropagation()}}
    onKeyDown={event=>{
      if(event.isComposing)return
      const list=buttons(),index=list.indexOf(doc.activeElement as HTMLElement)
      if(event.key==='Escape'||(event.key==='ArrowLeft'&&onBack)){event.preventDefault();event.stopPropagation();onBack?onBack():onClose("dismiss");return}
      if(event.key==='Tab'){onTab(event);event.stopPropagation();return}
      if((event.target as Element).matches('input,select,textarea'))return
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();setOpen(null);const next=event.key==='Home'?0:event.key==='End'?list.length-1:event.key==='ArrowDown'?(index+1)%list.length:index<0?list.length-1:(index+list.length-1)%list.length;focus(list[next]);return}
      if(event.key.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&event.key!==' '){const now=Date.now();typed.current={text:now-typed.current.time<700?typed.current.text+event.key:event.key,time:now};let query=typed.current.text.toLocaleLowerCase();if([...query].every(letter=>letter===query[0]))query=query[0];for(let step=1;step<=list.length;step++){const candidate=list[(index+step)%list.length];if((candidate.getAttribute('data-menu-label')||candidate.textContent||'').trim().toLocaleLowerCase().startsWith(query)){focus(candidate);event.preventDefault();event.stopPropagation();break}}}
    }}>
    {items.map((item,index)=>{
      if(item==='-')return <hr role="separator" key={index}/>
      if('header' in item)return <div className="float-header" key={index}>{item.header}</div>
      if('custom' in item)return <div className="float-custom" key={index}>{typeof item.custom==='function'?item.custom(()=>onClose("action")):item.custom}</div>
      const nested=item.submenu,expanded=open?.index===index,childId=id+'-'+index
      const show=(anchor:HTMLElement,keyboard=false)=>setOpen({index,anchor,keyboard})
      return <div className="float-row" key={index} onMouseEnter={event=>{if(item.disabled){setOpen(null);focus(box.current);return}const button=event.currentTarget.querySelector('button');focus(button);nested?show(button):setOpen(null)}}>
        <button role={item.checked!==undefined||item.toggle!==undefined?'menuitemcheckbox':'menuitem'} tabIndex={-1} aria-checked={item.checked??item.toggle} aria-haspopup={nested?'menu':undefined} aria-expanded={nested?expanded:undefined} aria-controls={expanded?childId:undefined} data-menu-label={item.label} data-menu-index={index} data-active={activeIndex===index?true:undefined} onFocus={()=>setActiveIndex(index)} disabled={item.disabled} data-bar={item.dataBar} className={item.danger?'danger':undefined}
          onKeyDown={event=>{if(nested&&['ArrowRight','Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();show(event.currentTarget,true)}else if(!nested&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();event.currentTarget.click()}}}
          onClick={event=>{if(nested){show(event.currentTarget,event.detail===0);return}if(!item.keepOpen&&item.toggle===undefined)onClose("action");item.onClick?.()}}>
          {ticks&&<span className="float-mark" aria-hidden="true">{item.checked?'✓':null}</span>}
          {item.icon&&<span className="float-icon" aria-hidden="true"><Icon name={item.icon} size={14}/></span>}
          <span className="float-label" style={item.labelStyle}>{item.label}</span>
          {item.toggle!==undefined?<span className={'float-switch'+(item.toggle?' on':'')} aria-hidden="true"/>:nested?<span className="hint" aria-hidden="true">›</span>:item.hint?<span className="hint">{chordGlyphs(item.hint,hostPlatform())}</span>:null}
        </button>
        {nested&&expanded&&createPortal(<MenuLevel key={index} items={nested} doc={doc} token={token} id={childId} label={item.label} anchor={open.anchor} initialFocus={open.keyboard?'first':'none'} onClose={onClose} onTab={onTab} onBack={()=>{const parent=open.anchor;setOpen(null);parent.focus({preventScroll:true})}}/>,doc.body)}
      </div>
    })}
  </div>
}
