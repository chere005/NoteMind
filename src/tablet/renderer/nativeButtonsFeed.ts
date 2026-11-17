import { readButtons } from '../shared/pen'
import { useSyncExternalStore } from 'react'
import { nativeState, onNativeButtons, setNativeButtons } from './nativeButtons'
let installed=false
export function installNativeButtons(): void {
 if(installed || typeof window === 'undefined')return
 const api=(window as any).wm?.pen
 if(!api?.onButtons || !api?.buttons)return
 installed=true
 let revision=0,request=0
 api.onButtons((state: unknown)=>{revision++;setNativeButtons(readButtons(state))})
 const refresh=(): void => {
  const before=revision,mine=++request
  void api.buttons().then((state:unknown)=>{if(state&&before===revision&&mine===request)setNativeButtons(readButtons(state))},()=>{})
 }
 refresh()
 window.addEventListener('focus',refresh)
}

export function useNativeButtons() {
 return useSyncExternalStore(listener=>onNativeButtons(()=>listener()),nativeState,nativeState)
}
