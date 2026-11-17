import {createToolPresetStore} from './toolPresetStore';
import type {PresetTool} from './toolPresets';
export interface SheetToolOwner { get():{eraser:boolean;selectTool:boolean};subscribe(listener:()=>void):()=>void;apply(tool:PresetTool):void }
interface Options {
 storage:{getItem(key:string):string|null;setItem(key:string,value:string):void};tools:SheetToolOwner;uuid?:()=>string;
 readRemote?:()=>Promise<unknown>;writeRemote?:(value:string)=>Promise<unknown>;subscribeRemote?:(listener:(value:unknown)=>void)=>()=>void;onError?:(error:Error)=>void;
}
export function createToolPresetController(options:Options){
 const errors=new Set<(error:Error)=>void>(),report=(error:Error)=>{try{options.onError?.(error);}catch{}for(const listener of [...errors])try{listener(error);}catch{}};
 const store=createToolPresetStore({...options,onError:report});let applying=false;
 const mode=():PresetTool=>{const now=options.tools.get();return now.eraser?'eraser':now.selectTool?'select':'pen';};
 const syncMode=()=>{const tool=mode();if(!applying&&store.current().tool!==tool)store.setCurrent({...store.current(),tool});};syncMode();
 const offTools=options.tools.subscribe(syncMode),offRemote=options.subscribeRemote?.(value=>store.receive(value));
 return {...store,
  get pending(){return store.pending;},get revision(){return store.revision;},
  activate(id:string){const result=store.activate(id);applying=true;try{options.tools.apply(store.current().tool);}catch(error){store.setCurrent({...store.current(),tool:mode()});report(error as Error);throw error;}finally{applying=false;}return result;},
  setColour(value:string|((current:string)=>string)){const now=store.current();return store.setCurrent({...now,colour:typeof value==='function'?value(now.colour):value});},
  setWidth(value:number|((current:number)=>number)){const now=store.current();return store.setCurrent({...now,width:typeof value==='function'?value(now.width):value});},
  onError(listener:(error:Error)=>void){errors.add(listener);return()=>{errors.delete(listener);};},
  dispose(){offTools();offRemote?.();errors.clear();return store.dispose();},
 };
}
export type ToolPresetController=ReturnType<typeof createToolPresetController>;
