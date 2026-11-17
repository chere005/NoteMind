import {TOOL_PRESETS_KEY,legacyToolSettings,loadToolPresets,serializeToolPresets,currentToolSettings,setCurrentTool,addToolPreset,activateToolPreset,updateToolPreset,renameToolPreset,removeToolPreset,type ToolSettings,type ToolPresetState} from './toolPresets';
interface PresetStorage { getItem(key:string):string|null;setItem(key:string,value:string):void }
interface PresetStoreOptions {
 storage:PresetStorage;uuid?:()=>string;readRemote?:()=>Promise<unknown>;writeRemote?:(value:string)=>Promise<unknown>;onError?:(error:Error)=>void;
}
export function createToolPresetStore({storage,uuid=()=>globalThis.crypto.randomUUID(),readRemote,writeRemote,onError}:PresetStoreOptions){
 let initial:unknown=null,colour:unknown=null,width:unknown=null,error:Error|null=null;
 try{initial=storage.getItem(TOOL_PRESETS_KEY);colour=storage.getItem('notemind.penColour');width=storage.getItem('notemind.penWidth');}catch(failure){error=failure as Error;}
 const legacy=legacyToolSettings(colour,width);let loaded=loadToolPresets(initial,legacy),state=loaded.state,revision=0,disposed=false,writeRun:Promise<void>|null=null,queuedValue:string|null=null,refreshRun:Promise<void>|null=null,refreshNeeded=false,deferredRemote:{value:unknown;revision:number}|null=null;
 const listeners=new Set<()=>void>(),sentValues=new Set<string>();
 const report=(failure:unknown)=>{const message=(failure as {message?:unknown})?.message;error=failure instanceof Error?failure:Error(typeof message==='string'?message:String(failure));try{if(!disposed)onError?.(error);}catch{}return error;};
 const emit=()=>{for(const listener of [...listeners])try{listener();}catch{}};
 if(loaded.problem)report(Error(loaded.problem));
 function pumpRefresh(){
  if(disposed||refreshRun||!refreshNeeded||writeRun||queuedValue!==null||!readRemote)return;refreshNeeded=false;const observed=revision;
  refreshRun=Promise.resolve().then(readRemote).then(value=>{if(value!=null)receive(value,observed);},failure=>{report(failure);}).finally(()=>{refreshRun=null;pumpRefresh();});
 }
 function reconcile(){
  const deferred=deferredRemote;deferredRemote=null;if(disposed)return;
  if(readRemote){refreshNeeded=true;pumpRefresh();}else if(deferred&&deferred.revision===revision)receive(deferred.value,deferred.revision);
 }
 function pumpWrites(){
  if(writeRun||queuedValue===null||!writeRemote)return;const value=queuedValue;queuedValue=null;sentValues.add(value);while(sentValues.size>8)sentValues.delete(sentValues.values().next().value!);let succeeded=false;
  writeRun=Promise.resolve().then(()=>writeRemote(value)).then(()=>{succeeded=true;},failure=>{report(failure);}).finally(()=>{writeRun=null;if(queuedValue!==null)pumpWrites();else if(succeeded)reconcile();else deferredRemote=null;});
 }
 async function flush(){for(;;){pumpWrites();pumpRefresh();if(writeRun)await writeRun;else if(refreshRun)await refreshRun;else if(queuedValue===null&&!refreshNeeded)return;}}
 function receive(value:unknown,expectedRevision?:number):boolean{
  if(disposed||expectedRevision!==undefined&&revision!==expectedRevision)return false;
  if(expectedRevision===undefined&&(writeRun||queuedValue!==null)){
   if(typeof value==='string'&&(sentValues.has(value)||value===queuedValue))return false;
   const next=loadToolPresets(value,legacy,state.current.tool);if(next.problem){report(Error(next.problem));if(next.canPersist)return false;}
   deferredRemote={value,revision};return false;
  }
  const next=loadToolPresets(value,legacy,state.current.tool);if(next.problem){report(Error(next.problem));if(!next.canPersist)loaded=next;return false;}
  if(loaded.problem)error=null;loaded=next;if(serializeToolPresets(next.state)===serializeToolPresets(state))return false;
  state=next.state;revision++;try{storage.setItem(TOOL_PRESETS_KEY,serializeToolPresets(state));}catch(failure){report(failure);}emit();return true;
 }
 function change(transform:(state:ToolPresetState)=>ToolPresetState){
  if(disposed)throw Error('Tool presets are closed.');const next=transform(state);if(next===state&&!error)return {state,persisted:true,error};
  state=next;revision++;error=null;const value=serializeToolPresets(state);
  let persisted=true;
  if(!loaded.canPersist){persisted=false;report(Error('These tool presets use a newer format.'));}
  else{
   try{storage.setItem(TOOL_PRESETS_KEY,value);}catch(failure){persisted=false;report(failure);}
   if(writeRemote){queuedValue=value;pumpWrites();}
  }
  emit();return {state,persisted,error};
 }
 const initialRevision=revision;
 const ready=readRemote?Promise.resolve().then(readRemote).then(value=>value==null?false:receive(value,initialRevision),failure=>{report(failure);return false;}):Promise.resolve(false);
 return {
  getSnapshot:()=>state,current:()=>currentToolSettings(state),getError:()=>error,get revision(){return revision;},get pending(){return (writeRun?1:0)+(queuedValue!==null?1:0);},ready,
  subscribe(listener:()=>void){if(disposed)return()=>{};listeners.add(listener);return()=>listeners.delete(listener);},receive,
  setCurrent:(settings:ToolSettings)=>change(state=>setCurrentTool(state,settings)),
  add:(name:string,settings?:ToolSettings)=>change(state=>addToolPreset(state,uuid(),name,settings)),
  activate:(id:string)=>change(state=>activateToolPreset(state,id)),
  update:(id:string,settings?:ToolSettings)=>change(state=>updateToolPreset(state,id,settings)),
  rename:(id:string,name:string)=>change(state=>renameToolPreset(state,id,name)),
  remove:(id:string)=>change(state=>removeToolPreset(state,id)),
  flush,dispose(){disposed=true;refreshNeeded=false;deferredRemote=null;listeners.clear();return flush();},
 };
}
