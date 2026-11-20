import { readButtons } from '../shared/pen'
import { useSyncExternalStore } from 'react'
import { nativeState, onNativeButtons, setNativeButtons } from './nativeButtons'
import { SYNTH_POINTER_ID } from './penButtons'
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

type SelectionPoint = { clientX: number; clientY: number; pad: boolean; start: boolean }

/** A driver-independent selection drag belongs to the drawing surface under its first tip contact. */
export function watchDisplaySelection(surface: HTMLElement, enabled: () => boolean): () => void {
	const view = surface.ownerDocument.defaultView
	const pen = (window as any).wm?.pen
	if (!view || !pen?.onSelectionPoint) return () => {}
	let last: SelectionPoint | null = null
	let modifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
	const emit = (type: string, point: SelectionPoint, contact: boolean) => {
		surface.dispatchEvent(new (view as Window & typeof globalThis).PointerEvent(type, {
			clientX: point.clientX, clientY: point.clientY, pointerId: SYNTH_POINTER_ID,
			pointerType: 'pen', isPrimary: true, button: type === 'pointermove' ? -1 : type === 'pointerdown' ? 1 : 0,
			buttons: contact ? 5 : 0, pressure: contact ? .5 : 0, bubbles: true, cancelable: true, ...modifiers,
		}))
	}
	const end = (cancelled: boolean) => {
		const point = last
		last = null
		if (point) emit(cancelled ? 'pointercancel' : 'pointerup', point, false)
	}
	const offButtons = onNativeButtons(state => {
		if (!state.tip) end(!state.present || !state.range)
	})
	const offPoint = pen.onSelectionPoint((point: SelectionPoint) => {
		if (!surface.isConnected || point.pad !== (view !== window) || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return
		const state = nativeState()
		if (!state.selectionPosition || !state.tip) return
		if (point.start) {
			end(true)
			const target = surface.ownerDocument.elementFromPoint(point.clientX, point.clientY)
			if (!enabled() || !surface.contains(target) || target?.closest('button')) return
		} else if (!last) return
		last = point
		emit(point.start ? 'pointerdown' : 'pointermove', point, true)
	})
	const key = ({altKey, ctrlKey, metaKey, shiftKey}: KeyboardEvent) => { modifiers = {altKey, ctrlKey, metaKey, shiftKey} }
	const blur = () => {
		modifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
		if (view === window) end(true)
	}
	const wheel = (event: WheelEvent) => {
		if (!last) return
		event.preventDefault()
		event.stopImmediatePropagation()
	}
	view.addEventListener('blur', blur)
	view.addEventListener('keydown', key, true)
	view.addEventListener('keyup', key, true)
	surface.addEventListener('wheel', wheel, { capture: true, passive: false })
	return () => {
		offPoint()
		offButtons()
		view.removeEventListener('blur', blur)
		view.removeEventListener('keydown', key, true)
		view.removeEventListener('keyup', key, true)
		surface.removeEventListener('wheel', wheel, true)
		end(true)
	}
}
