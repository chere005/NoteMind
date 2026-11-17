import {useEffect,useSyncExternalStore} from 'react';
import {createToolPresetController,type ToolPresetController} from './toolPresetController';
import {sheetTools,subscribeSheetTools,setSheetEraser,setSheetSelect,setPenTool} from './penSettings';
let controller:ToolPresetController|null=null;
export function drawingToolPresets():ToolPresetController{
 if(controller)return controller;const api=(window as any).notemind;
 controller=createToolPresetController({storage:localStorage,
  readRemote:()=>api.preferenceGet('toolPresets'),writeRemote:value=>api.preferenceSet('toolPresets',value),
  subscribeRemote:listener=>api.onPreference(({key,value})=>{if(key==='toolPresets')listener(value)}),
  tools:{get:sheetTools,subscribe:subscribeSheetTools,apply:tool=>{if(tool==='pen'||tool==='eraser')setPenTool(tool);setSheetEraser(tool==='eraser');setSheetSelect(tool==='select');}},
 });
 const current=controller,flush=(event:Event)=>{(event as CustomEvent).detail?.promises?.push(current.flush());};window.addEventListener('camera-flush',flush);
 window.addEventListener('unload',()=>{window.removeEventListener('camera-flush',flush);void current.dispose();if(controller===current)controller=null;},{once:true});
 return current;
}
export function useToolPresets(onError:(message:string)=>void){
 const controller=drawingToolPresets(),state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
 useEffect(()=>{const error=controller.getError();if(error)onError(error.message);return controller.onError(error=>onError(error.message));},[controller,onError]);
 return {controller,state,colour:state.current.colour,width:state.current.width,setColour:controller.setColour,setWidth:controller.setWidth};
}
