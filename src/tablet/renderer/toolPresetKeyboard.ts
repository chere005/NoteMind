import {presetAtSlot} from './toolPresets';
import {toolPresetSlotKey} from './toolPresetKeys';
import type {ToolPresetController} from './toolPresetController';
type KeyOwner=Window&typeof globalThis;
interface Registration { sources:Set<()=>boolean>;keydown:(event:KeyboardEvent)=>void;start:()=>void;end:()=>void }
const registrations=new WeakMap<Window,Map<ToolPresetController,Registration>>();
export function installToolPresetKeyboard(view:KeyOwner,controller:ToolPresetController,visible:()=>boolean):()=>void{
 let byController=registrations.get(view);if(!byController){byController=new Map();registrations.set(view,byController);}
 let record=byController.get(controller);
 if(!record){
  let composing=false;const sources=new Set<()=>boolean>(),doc=view.document;
  const keydown=(event:KeyboardEvent)=>{
   const focused=doc.activeElement as HTMLElement|null,slot=toolPresetSlotKey(event,{visible:[...sources].some(shown=>shown())&&doc.visibilityState!=='hidden',canvasFocused:!!focused?.closest?.('[data-tablet="surface"]'),composing,modalOpen:!!doc.querySelector('dialog[open],.float-menu,.pen-sheet')});
   if(slot===null)return;const preset=presetAtSlot(controller.getSnapshot(),slot);if(!preset)return;
   try{controller.activate(preset.id);}catch{return;}event.preventDefault();event.stopPropagation();
  };
  record={sources,keydown,start:()=>{composing=true;},end:()=>{composing=false;}};byController.set(controller,record);view.addEventListener('keydown',record.keydown,true);view.addEventListener('compositionstart',record.start,true);view.addEventListener('compositionend',record.end,true);
 }
 const source=()=>visible();record.sources.add(source);let active=true;
 return()=>{if(!active)return;active=false;record!.sources.delete(source);if(record!.sources.size)return;view.removeEventListener('keydown',record!.keydown,true);view.removeEventListener('compositionstart',record!.start,true);view.removeEventListener('compositionend',record!.end,true);byController!.delete(controller);if(!byController!.size)registrations.delete(view);};
}
