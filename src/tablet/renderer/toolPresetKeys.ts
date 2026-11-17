interface KeyTarget { parentElement?:KeyTarget|null;isContentEditable?:boolean;tagName?:string;getAttribute?:(name:string)=>string|null }
export interface ToolPresetKey {
 key:string;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;shiftKey?:boolean;isComposing?:boolean;keyCode?:number;repeat?:boolean;defaultPrevented?:boolean;target?:unknown;composedPath?:()=>unknown[];
}
export interface ToolPresetKeyOwner { visible:boolean;canvasFocused:boolean;composing?:boolean;modalOpen?:boolean }
export function presetKeyInField(event:ToolPresetKey):boolean{
 const path=event.composedPath?.()||[];if(event.target&&!path.length){let node=event.target as KeyTarget|null;while(node){path.push(node);node=node.parentElement;}}
 let editableBoundary=false;
 for(const candidate of path){const element=candidate as KeyTarget;if(!element)continue;
  if(['INPUT','TEXTAREA','SELECT','BUTTON','OPTION'].includes(element.tagName?.toUpperCase()||''))return true;
  const role=element.getAttribute?.('role');if(role&&['textbox','combobox','searchbox','menu','menuitem','listbox','dialog'].includes(role))return true;
  if(!editableBoundary){const attribute=element.getAttribute?.('contenteditable');if(attribute==='false')editableBoundary=true;else if(element.isContentEditable||attribute===''||attribute==='true'||attribute==='plaintext-only')return true;}
 }
 return false;
}
export function toolPresetSlotKey(event:ToolPresetKey,owner:ToolPresetKeyOwner):number|null{
 if(!owner.visible||!owner.canvasFocused||owner.modalOpen||owner.composing||event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||presetKeyInField(event))return null;
 return /^[1-9]$/.test(event.key)?Number(event.key):null;
}
