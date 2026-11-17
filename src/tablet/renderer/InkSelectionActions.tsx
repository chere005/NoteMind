import {useLayoutEffect,useRef,useState} from 'react'
import type {Rect} from '@notemind/core'
import {placeRow} from './boxRow'
import {Icon} from './icons'
import './inkSelection.css'

export function InkSelectionActions({box,sheet,count,busy,onDuplicate,onDelete,onClear}:{box:Rect;sheet:{x:number;y:number;width:number;height:number};count:number;busy:boolean;onDuplicate:()=>void;onDelete:()=>void;onClear:()=>void}){
 const row=useRef<HTMLDivElement|null>(null),[size,setSize]=useState({width:0,height:0})
 useLayoutEffect(()=>{const element=row.current;if(!element)return;const measure=()=>setSize({width:element.offsetWidth,height:element.offsetHeight});measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect()},[])
 const place=placeRow(box,sheet,size)
 return <div ref={row} className="ink-selection-actions" data-ink-selection="actions" role="toolbar" aria-label="Selected ink" aria-busy={busy} style={{left:sheet.x+place.left,top:sheet.y+place.top,visibility:size.width?'visible':'hidden'}} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()}>
   <span className="ink-selection-count" aria-label={`${count} selected strokes`}>{count}</span>
   <button type="button" title="Duplicate selected ink" aria-label="Duplicate selected ink" data-ink-action="duplicate" disabled={busy} onClick={onDuplicate}><Icon name="copy"/></button>
   <button type="button" title="Delete selected ink" aria-label="Delete selected ink" data-ink-action="delete" disabled={busy} onClick={onDelete}><Icon name="trash"/></button>
   <button type="button" title="Clear ink selection" aria-label="Clear ink selection" data-ink-action="clear" disabled={busy} onClick={onClear}><Icon name="close"/></button>
 </div>
}
