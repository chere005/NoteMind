import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import type {Rect} from '@notemind/core'
import {placeRow} from './boxRow'
import {Icon} from './icons'
import './inkSelection.css'

export function InkSelectionActions({box,sheet,count,busy,colour,width,onColour,onWidth,onDuplicate,onDelete,onClear}:{box:Rect;sheet:{x:number;y:number;width:number;height:number};count:number;busy:boolean;colour:string|null;width:number|null;onColour:(value:string)=>void;onWidth:(value:number)=>void;onDuplicate:()=>void;onDelete:()=>void;onClear:()=>void}){
 const row=useRef<HTMLDivElement|null>(null),[size,setSize]=useState({width:0,height:0})
 const colourInput=useRef<HTMLInputElement|null>(null),colourCommit=useRef(onColour),colourEditing=useRef(false),[colourDraft,setColourDraft]=useState(colour||'#000000')
 const widthCommit=useRef(onWidth),widthInput=useRef<HTMLInputElement|null>(null),changed=useRef(false),[draft,setDraft]=useState(width===null?'':String(width))
 useEffect(()=>{if(widthInput.current?.ownerDocument.activeElement!==widthInput.current){setDraft(width===null?'':String(width));changed.current=false}},[width])
 useEffect(()=>{if(!colourEditing.current)setColourDraft(colour||'#000000')},[colour])
 useLayoutEffect(()=>{const element=colourInput.current;if(!element)return;const commit=()=>{if(!colourEditing.current)return;colourEditing.current=false;colourCommit.current(element.value)};element.addEventListener('change',commit);return()=>element.removeEventListener('change',commit)},[])
 const commitWidth=()=>{if(!changed.current)return;changed.current=false;const text=widthInput.current?.value??draft,value=Number(text);if(text&&Number.isFinite(value)&&value>0)widthCommit.current(value);else setDraft(width===null?'':String(width))}
 useLayoutEffect(()=>{const element=row.current;if(!element)return;const measure=()=>setSize({width:element.offsetWidth,height:element.offsetHeight});measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect()},[])
 const place=placeRow(box,sheet,size)
 return <div ref={row} className="ink-selection-actions" data-ink-selection="actions" role="toolbar" aria-label="Selected ink" aria-busy={busy} style={{left:sheet.x+place.left,top:sheet.y+place.top,visibility:size.width?'visible':'hidden'}} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()}>
   <span className="ink-selection-count" aria-label={`${count} selected strokes`}>{count}</span>
   <input ref={colourInput} type="color" className="ink-selection-colour" title="Set selected ink colour" aria-label="Selected ink colour" data-ink-action="colour" data-mixed={colour===null?'true':undefined} value={colourDraft} disabled={busy} onPointerDown={()=>{colourCommit.current=onColour;colourEditing.current=true}} onFocus={()=>{colourCommit.current=onColour;colourEditing.current=true}} onInput={event=>{colourEditing.current=true;setColourDraft(event.currentTarget.value)}} onChange={()=>{}}/>
   <input ref={widthInput} type="number" className="ink-selection-width" title="Set selected ink width" aria-label="Selected ink width" data-ink-action="width" step="any" placeholder="—" value={draft} disabled={busy} onFocus={()=>{widthCommit.current=onWidth}} onChange={event=>{changed.current=true;setDraft(event.target.value)}} onBlur={commitWidth} onKeyDown={event=>{if(event.defaultPrevented||event.nativeEvent?.isComposing||event.keyCode===229)return;if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur()}if(event.key==='Escape'){changed.current=false;setDraft(width===null?'':String(width));event.currentTarget.blur()}}}/>
   <button type="button" title="Duplicate selected ink" aria-label="Duplicate selected ink" data-ink-action="duplicate" disabled={busy} onClick={onDuplicate}><Icon name="copy"/></button>
   <button type="button" title="Delete selected ink" aria-label="Delete selected ink" data-ink-action="delete" disabled={busy} onClick={onDelete}><Icon name="trash"/></button>
   <button type="button" title="Clear ink selection" aria-label="Clear ink selection" data-ink-action="clear" disabled={busy} onClick={onClear}><Icon name="close"/></button>
 </div>
}
