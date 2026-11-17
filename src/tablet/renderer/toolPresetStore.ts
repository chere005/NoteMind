import {TOOL_PRESETS_KEY,legacyToolSettings,loadToolPresets,serializeToolPresets,currentToolSettings,setCurrentTool,addToolPreset,activateToolPreset,updateToolPreset,renameToolPreset,removeToolPreset,type ToolSettings,type ToolPresetState} from './toolPresets';
interface PresetStorage { getItem(key:string):string|null;setItem(key:string,value:string):void }
interface PresetStoreOptions {
 storage:PresetStorage;uuid?:()=>string;readRemote?:()=>Promise<unknown>;writeRemote?:(value:string)=>Promise<unknown>;onError?:(error:Error)=>void;
}
export function createToolPresetStore({storage,uuid=()=>globalThis.crypto.randomUUID(),readRemote,writeRemote,onError}:PresetStoreOptions){
 let initial:unknown=null,colour:unknown=null,width:unknown=null,error:Error|null=null;
 try{initial=storage.getItem(TOOL_PRESETS_KEY);colour=storage.getItem('notemind.penColour');width=storage.getItem('notemind.penWidth');}catch(failure){error=failure as Error;}
 const legacy=legacyToolSettings(colour,width);let loaded=loadToolPresets(initial,legacy),state=loaded.state,revision=0,disposed=false,writeRun:Promise<void>|null=null,queuedValue:string|null=null;
 const listeners=new Set<()=>void>();
 const report=(failure:unknown)=>{const message=(failure as {message?:unknown})?.message;error=failure instanceof Error?failure:Error(typeof message==='string'?message:String(failure));try{if(!disposed)onError?.(error);}catch{}return error;};
 const emit=()=>{for(const listener of [...listeners])try{listener();}catch{}};
 if(loaded.problem)report(Error(loaded.problem));
 function pumpWrites(){
  if(writeRun||queuedValue===null||!writeRemote)return;const value=queuedValue;queuedValue=null;
  writeRun=Promise.resolve().then(()=>writeRemote(value)).then(()=>{},failure=>{report(failure);}).finally(()=>{writeRun=null;pumpWrites();});
 }
 async function flush(){while(writeRun||queuedValue!==null){pumpWrites();if(writeRun)await writeRun;}}
 function receive(value:unknown,expectedRevision?:number):boolean{
  if(disposed||expectedRevision!==undefined&&revision!==expectedRevision)return false;
  if(expectedRevision===undefined&&(writeRun||queuedValue!==null))return false;
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
  flush,dispose(){disposed=true;listeners.clear();return flush();},
 };
}
