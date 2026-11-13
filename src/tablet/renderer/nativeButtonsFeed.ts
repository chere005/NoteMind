import { readButtons } from '../shared/pen'
import { setNativeButtons } from './nativeButtons'
let installed=false
export function installNativeButtons(): void {
 if(installed || typeof window === 'undefined')return
 const api=(window as any).wm?.pen
 if(!api?.onButtons || !api?.buttons)return
 installed=true
 api.onButtons((state: unknown)=>setNativeButtons(readButtons(state)))
 const refresh=(): void => { void api.buttons().then((state:unknown)=>{if(state)setNativeButtons(readButtons(state))},()=>{}) }
 refresh()
 window.addEventListener('focus',refresh)
}
