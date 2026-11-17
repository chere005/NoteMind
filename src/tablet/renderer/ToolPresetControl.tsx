import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {MenuButton} from './MenuButton';
import type {MenuItem} from './FloatingMenu';
import {MAX_TOOL_PRESETS,type ToolPresetState,type ToolSettings} from './toolPresets';
import type {ToolPresetController} from './toolPresetController';
import {installToolPresetKeyboard} from './toolPresetKeyboard';
import './toolPresets.css';
type Naming={kind:'add'|'rename';id?:string;name:string;settings:ToolSettings;doc:Document};
export function ToolPresetControl({controller,state,enabled=true,onError}:{controller:ToolPresetController;state:ToolPresetState;enabled?:boolean;onError?:(message:string)=>void}){
 const host=useRef<HTMLSpanElement>(null),active=useRef(enabled),[naming,setNaming]=useState<Naming|null>(null);active.current=enabled;
 const run=(action:()=>unknown)=>{try{action();}catch(error){onError?.((error as Error).message||String(error));}};
 useEffect(()=>{const element=host.current,view=element?.ownerDocument.defaultView;if(!view)return;return installToolPresetKeyboard(view as Window&typeof globalThis,controller,()=>active.current&&!!host.current?.getClientRects().length&&!host.current?.closest('[hidden]'));},[controller]);
 const name=(kind:Naming['kind'],id?:string)=>{const doc=host.current?.ownerDocument;if(!doc)return;const preset=state.presets.find(p=>p.id===id);setNaming({kind,id,name:preset?.name||'',settings:controller.current(),doc});};
 const items=():MenuItem[]=>[
  ...state.presets.map((preset,index)=>({label:preset.name,icon:preset.settings.tool==='pen'?'pen':preset.settings.tool==='eraser'?'eraser':'select',hint:index<9?String(index+1):undefined,checked:state.activeId===preset.id,dataBar:'tool-preset-'+preset.id,onClick:()=>run(()=>controller.activate(preset.id))} as MenuItem)),
  ...(state.presets.length?['-' as const]:[]),
  {label:'Save current tool…',icon:'plus',disabled:state.presets.length>=MAX_TOOL_PRESETS,dataBar:'tool-preset-save',onClick:()=>name('add')},
  {label:'Update preset',disabled:!state.presets.length,dataBar:'tool-preset-update',submenu:state.presets.map(preset=>({label:preset.name,onClick:()=>run(()=>controller.update(preset.id,controller.current()))}))},
  {label:'Rename preset…',disabled:!state.presets.length,dataBar:'tool-preset-rename',submenu:state.presets.map(preset=>({label:preset.name,onClick:()=>name('rename',preset.id)}))},
  {label:'Delete preset',disabled:!state.presets.length,dataBar:'tool-preset-delete',submenu:state.presets.map(preset=>({label:preset.name,danger:true,onClick:()=>run(()=>controller.remove(preset.id))}))},
 ];
 return <span ref={host} className="tool-preset-control"><MenuButton icon="list" name="Tool presets" title="Tool presets" dataBar="tool-presets" live items={items}/>{naming&&<PresetNameDialog value={naming} onClose={()=>setNaming(null)} onSave={value=>{if(naming.kind==='add')controller.add(value,naming.settings);else controller.rename(naming.id!,value);}}/>}</span>;
}
function PresetNameDialog({value,onClose,onSave}:{value:Naming;onClose:()=>void;onSave:(name:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),field=useRef<HTMLInputElement>(null),composing=useRef(false),[name,setName]=useState(value.name),[error,setError]=useState(''),title=value.kind==='add'?'Save tool preset':'Rename tool preset';
 useEffect(()=>{const element=dialog.current;if(!element)return;const previous=value.doc.activeElement as HTMLElement|null;element.showModal();field.current?.focus();field.current?.select();return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[value.doc]);
 return createPortal(<dialog ref={dialog} className="modal tool-preset-dialog" data-tool-preset-dialog="" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}} onClose={onClose}><form method="dialog" onSubmit={event=>{event.preventDefault();if(composing.current)return;try{onSave(name);onClose();}catch(error){setError((error as Error).message||String(error));}}}><h3>{title}</h3><input ref={field} type="text" aria-label="Preset name" value={name} maxLength={80} required onChange={event=>setName(event.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}/>{error&&<p role="alert">{error}</p>}<div className="buttons"><button type="button" title="Cancel" onClick={onClose}>Cancel</button><button type="submit" className="default" title={value.kind==='add'?'Save tool preset':'Rename tool preset'}>{value.kind==='add'?'Save':'Rename'}</button></div></form></dialog>,value.doc.body);
}
