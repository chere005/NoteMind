import {createContext,useContext,type ReactNode} from 'react'
import {createPortal} from 'react-dom'

export type PaneChromeSlot='tabs'|'pen'|'header'|'find'|'footer'|'overlay'
export const PaneChromeContext=createContext<Partial<Record<PaneChromeSlot,HTMLElement>>|null>(null)

// Both sets of controls call the same controller; the page and its effects mount only once.
export function PaneChrome({slot,active=true,children}:{slot:PaneChromeSlot,active?:boolean,children:ReactNode|((mirror:boolean,onPad:boolean)=>ReactNode)}){
 const targets=useContext(PaneChromeContext),target=targets?.[slot]
 const render=(mirror:boolean)=>typeof children==='function'?children(mirror,!!targets):children
 return <>{render(false)}{active&&target?createPortal(render(true),target):null}</>
}
