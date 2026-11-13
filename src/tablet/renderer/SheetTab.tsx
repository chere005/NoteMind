import React,{useState,useRef,useEffect} from 'react';
import {Icon} from './icons';
export function SheetTab({name,selected,live=false,dirty=false,guarded=false,onSelect,onRename,onClose,onDragStart,onDrop}){
 const [asking,setAsking]=useState(false);useEffect(()=>{if(!asking)return;const timer=setTimeout(()=>setAsking(false),3000);return()=>clearTimeout(timer)},[asking]);const close=()=>{if(guarded&&!asking){setAsking(true);return;}setAsking(false);onClose?.()};
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(name);const field=useRef<HTMLInputElement>(null),cancelled=useRef(false);
 useEffect(()=>{if(editing){field.current?.focus();field.current?.select()}},[editing]);
 const finish=()=>{if(!cancelled.current&&draft.trim())onRename(draft.trim());setEditing(false);cancelled.current=false};
 return <div role="tab" tabIndex={selected?0:-1} aria-selected={selected} className={'sheet-tab'+(live?' live':'')+(selected?' on':'')+(asking?' asking':'')} draggable={!editing} onDragStart={onDragStart} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();onDrop?.(e)}} onClick={onSelect} onDoubleClick={()=>{setDraft(name);setEditing(true)}} onAuxClick={e=>{if(e.button===1){e.preventDefault();close()}}} onKeyDown={e=>{if(!editing&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect()}}}>
 {live&&<span className="live-dot"/>}{editing?<input ref={field} className="name-field" value={draft} onChange={e=>setDraft(e.target.value)} onClick={e=>e.stopPropagation()} onBlur={finish} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish()}if(e.key==='Escape'){cancelled.current=true;setEditing(false)}}}/>:<span className="name">{name}</span>}{dirty&&<span className="sheet-dirty" aria-label="Unsaved changes" title="Unsaved changes">●</span>}{onClose&&<button className="sheet-close" title="Close tab" aria-label={'Close '+name} onClick={e=>{e.stopPropagation();close()}}>{asking?'Close?':<Icon name="close" size={10}/>}</button>}
 </div>;
}
