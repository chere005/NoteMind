export const TOOL_PRESETS_KEY = 'notemind.toolPresets';
export const MAX_TOOL_PRESETS = 12;
export const MAX_PRESET_BYTES = 32768;
export type PresetTool = 'pen' | 'eraser' | 'select';
export interface ToolSettings { readonly tool: PresetTool; readonly colour: string; readonly width: number }
export interface ToolPreset { readonly id: string; readonly name: string; readonly settings: ToolSettings }
export interface ToolPresetState { readonly version: 1; readonly presets: readonly ToolPreset[]; readonly activeId: string | null; readonly current: ToolSettings }
export interface LoadedToolPresets { readonly state: ToolPresetState; readonly problem: string | null; readonly canPersist: boolean }
const tools = new Set<PresetTool>(['pen','eraser','select']);
const colourOK = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const idOK = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
export function toolSettings(value: unknown): ToolSettings {
 const input = value as ToolSettings;
 if (!input || !tools.has(input.tool) || !colourOK(input.colour) || !Number.isFinite(input.width) || input.width < 1 || input.width > 16) throw Error('Invalid tool settings.');
 return Object.freeze({tool:input.tool,colour:input.colour,width:input.width});
}
export function legacyToolSettings(colour: unknown, width: unknown): ToolSettings {
 return toolSettings({tool:'pen',colour:colourOK(colour)?colour:'#1C1C1E',width:Math.max(1,Math.min(16,Number(width)||3))});
}
export const sameToolSettings = (a: ToolSettings,b: ToolSettings): boolean => a.tool===b.tool && a.width===b.width && a.colour.toLowerCase()===b.colour.toLowerCase();
function nameOf(name: unknown): string {
 if(typeof name!=='string'||!name.trim())throw Error('Give the preset a name.');
 const value=name.trim();if(value.length>80)throw Error('Use a preset name of up to 80 characters.');return value;
}
function preset(id: string,name: unknown,settings: unknown): ToolPreset {
 if(!idOK(id))throw Error('Invalid tool preset identity.');return Object.freeze({id,name:nameOf(name),settings:toolSettings(settings)});
}
const stateOf=(presets:readonly ToolPreset[],current:ToolSettings,activeId:string|null):ToolPresetState=>Object.freeze({version:1,presets:Object.freeze([...presets]),current,activeId});
export function initialToolPresets(settings: ToolSettings): ToolPresetState {
 const current=toolSettings({...settings,tool:'pen'}),first=preset('default-pen','Pen',current);return stateOf([first],first.settings,first.id);
}
export function loadToolPresets(raw: unknown,legacy: ToolSettings,currentTool: PresetTool='pen'): LoadedToolPresets {
 const fallback=initialToolPresets(legacy);if(raw==null||raw==='')return {state:fallback,problem:null,canPersist:true};
 let parsed: any;
 try{if(typeof raw==='string'){if(raw.length>MAX_PRESET_BYTES)throw Error();parsed=JSON.parse(raw);}else parsed=raw;}
 catch{return {state:fallback,problem:'Saved tool presets could not be read.',canPersist:true};}
 if(parsed&&Number.isInteger(parsed.version)&&parsed.version>1)return {state:fallback,problem:'These tool presets use a newer format.',canPersist:false};
 if(!parsed||parsed.version!==1||!Array.isArray(parsed.presets))return {state:fallback,problem:'Saved tool presets have an invalid format.',canPersist:true};
 const presets:ToolPreset[]=[],ids=new Set<string>();let damaged=parsed.presets.length>MAX_TOOL_PRESETS;
 for(const item of parsed.presets.slice(0,MAX_TOOL_PRESETS))try{const next=preset(item.id,item.name,item.settings);if(ids.has(next.id))throw Error();ids.add(next.id);presets.push(next);}catch{damaged=true;}
 if(parsed.presets.length&&presets.length===0)return {state:fallback,problem:'Saved tool presets could not be read.',canPersist:true};
 let current:ToolSettings;try{current=toolSettings({...parsed.current,tool:currentTool});}catch{current=toolSettings({...legacy,tool:currentTool});damaged=true;}
 const chosen=presets.find(p=>p.id===parsed.activeId&&sameToolSettings(p.settings,current));
 return {state:stateOf(presets,current,chosen?.id||null),problem:damaged?'Some saved tool presets could not be read.':null,canPersist:true};
}
export function serializeToolPresets(state: ToolPresetState): string {
 return JSON.stringify({version:1,presets:state.presets,activeId:state.activeId,current:{colour:state.current.colour,width:state.current.width}});
}
export function currentToolSettings(state: ToolPresetState): ToolSettings { return state.current; }
export function presetAtSlot(state:ToolPresetState,slot:number): ToolPreset|null { return Number.isInteger(slot)&&slot>=1&&slot<=9?state.presets[slot-1]||null:null; }
export function setCurrentTool(state:ToolPresetState,settings:ToolSettings):ToolPresetState {
 const next=toolSettings(settings);if(sameToolSettings(next,state.current))return state;
 return stateOf(state.presets,next,state.presets.find(p=>sameToolSettings(p.settings,next))?.id||null);
}
export function addToolPreset(state:ToolPresetState,id:string,name:string,settings:ToolSettings=state.current):ToolPresetState {
 if(state.presets.length>=MAX_TOOL_PRESETS)throw Error('Keep up to '+MAX_TOOL_PRESETS+' tool presets.');if(state.presets.some(p=>p.id===id))throw Error('That tool preset already exists.');
 const next=preset(id,name,settings);return stateOf([...state.presets,next],state.current,sameToolSettings(next.settings,state.current)?next.id:state.activeId);
}
export function activateToolPreset(state:ToolPresetState,id:string):ToolPresetState {
 const chosen=state.presets.find(p=>p.id===id);if(!chosen)throw Error('That tool preset is no longer available.');if(state.activeId===id&&state.current===chosen.settings)return state;return stateOf(state.presets,chosen.settings,id);
}
export function updateToolPreset(state:ToolPresetState,id:string,settings:ToolSettings=state.current):ToolPresetState {
 const old=state.presets.find(p=>p.id===id);if(!old)throw Error('That tool preset is no longer available.');const next=preset(id,old.name,settings);
 return stateOf(state.presets.map(p=>p===old?next:p),state.current,sameToolSettings(next.settings,state.current)?id:state.activeId===id?null:state.activeId);
}
export function renameToolPreset(state:ToolPresetState,id:string,name:string):ToolPresetState {
 const old=state.presets.find(p=>p.id===id);if(!old)throw Error('That tool preset is no longer available.');const next=preset(id,name,old.settings);if(next.name===old.name)return state;
 return stateOf(state.presets.map(p=>p===old?next:p),state.current,state.activeId);
}
export function removeToolPreset(state:ToolPresetState,id:string):ToolPresetState {
 const kept=state.presets.filter(p=>p.id!==id);return kept.length===state.presets.length?state:stateOf(kept,state.current,state.activeId===id?null:state.activeId);
}
