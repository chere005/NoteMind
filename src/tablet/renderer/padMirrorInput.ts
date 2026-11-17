/** The owner window's mouse, sent only by its visible pixel mirror to the same-origin Wacom portal. */
type View = Window & typeof globalThis

export const MIRROR_MOUSE_POINTER_ID = 4243
const mirrorEvents = new WeakSet<Event>()
/** Source-window mirror input and its forwarded compatibility events are the user's mouse, never pen driver echoes. */
export const isPadMirrorEvent = (event: Event): boolean =>
  mirrorEvents.has(event) || !!(event.target as Element | null)?.closest?.(".pad-mirror")
const dispatchMirrorEvent = (target: EventTarget, event: Event): boolean => {
  mirrorEvents.add(event)
  return target.dispatchEvent(event)
}
const CLICK_SLOP = 6
const CLICKABLE = "button, [role='button'], [role='tab'], summary, a[href], input, textarea, select, [contenteditable='true'], [contenteditable='']"

export interface PadMirrorPointer {
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel"
  /** Position as a fraction of the fitted display image. */
  x: number
  y: number
  button: number
  buttons: number
  pressure: number
  detail: number
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export interface PadMirrorKey {
  type: "keydown" | "keyup"
  key: string
  code: string
  repeat: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  isComposing?: boolean
  keyCode?: number
}

type Emit = <T>(send: () => T) => T
type Bridge = { pointer(event: PadMirrorPointer): boolean; key(event: PadMirrorKey): boolean; cancel(): void }
let current: Bridge | null = null

function bridgeFor(view: View, emit: Emit): Bridge {
  const doc = view.document
  type Point = { x: number; y: number }
  type Contact = { target: Element; clickable: Element | null; start: Point; last: Point; button: number; detail: number; packet: PadMirrorPointer }
  let contact: Contact | null = null
  let hovered: Element | null = null
  let lastClick: { target: Element; at: number; detail: number } | null = null

  const pointOf = (event: PadMirrorPointer): Point => ({ x: event.x * view.innerWidth, y: event.y * view.innerHeight })
  const hit = (point: Point): Element | null => doc.elementFromPoint(point.x, point.y)
  const clickable = (target: Element | null): Element | null => {
    const button = target?.closest(CLICKABLE) ?? null
    return button && !button.matches(":disabled, [aria-disabled='true']") ? button : null
  }
  const base = (event: PadMirrorPointer, point: Point, relatedTarget: EventTarget | null = null) => ({
    bubbles: true, cancelable: true, composed: true, view,
    pointerId: MIRROR_MOUSE_POINTER_ID, pointerType: "mouse", isPrimary: true,
    clientX: point.x, clientY: point.y, screenX: view.screenX + point.x, screenY: view.screenY + point.y,
    button: event.button, buttons: event.buttons, pressure: event.buttons ? Math.max(0.1, event.pressure) : 0,
    width: 1, height: 1, detail: event.detail,
    ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
    relatedTarget,
  })
  const pointer = (target: Element, type: string, event: PadMirrorPointer, point: Point, related?: EventTarget | null): void => {
    const init = base(event, point, related)
    emit(() => dispatchMirrorEvent(target, new view.PointerEvent(type, init)))
  }
  const mouse = (target: Element, type: string, event: PadMirrorPointer, point: Point, related?: EventTarget | null): void => {
    dispatchMirrorEvent(target, new view.MouseEvent(type, base(event, point, related)))
  }
  const hover = (target: Element | null, event: PadMirrorPointer, point: Point): void => {
    if (hovered === target) {
      if (target) { pointer(target, "pointermove", event, point); mouse(target, "mousemove", event, point) }
      return
    }
    const prior = hovered
    hovered = target
    if (prior) {
      pointer(prior, "pointerout", event, point, target)
      emit(() => dispatchMirrorEvent(prior, new view.PointerEvent("pointerleave", { ...base(event, point, target), bubbles: false })))
      mouse(prior, "mouseout", event, point, target)
      dispatchMirrorEvent(prior, new view.MouseEvent("mouseleave", { ...base(event, point, target), bubbles: false }))
    }
    if (!target) return
    if (target) {
      pointer(target, "pointerover", event, point, prior)
      emit(() => dispatchMirrorEvent(target, new view.PointerEvent("pointerenter", { ...base(event, point, prior), bubbles: false })))
      mouse(target, "mouseover", event, point, prior)
      dispatchMirrorEvent(target, new view.MouseEvent("mouseenter", { ...base(event, point, prior), bubbles: false }))
      pointer(target, "pointermove", event, point)
      mouse(target, "mousemove", event, point)
    }
  }
  const cancelContact = (): void => {
    const held = contact
    if (!held) return
    const cancelled: PadMirrorPointer = { ...held.packet, type: "pointercancel", buttons: 0, pressure: 0 }
    pointer(held.target, "pointercancel", cancelled, held.last)
    mouse(held.target, "mouseleave", cancelled, held.last)
    contact = null
    lastClick = null
  }
  const dispatchPointer = (event: PadMirrorPointer): boolean => {
    if (view.closed || doc.visibilityState === "hidden") { cancelContact(); return false }
    const point = pointOf(event)
    const target = contact?.target ?? hit(point)
    if (!target) {
      if (event.type === "pointermove") { hover(null, event, point); return true }
      return false
    }
    if (event.type === "pointerdown") {
      if (contact || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return false
      contact = { target, clickable: clickable(target), start: point, last: point, button: event.button, detail: event.detail, packet: event }
      hovered = target
      const focusTarget = clickable(target)
      if (focusTarget instanceof view.HTMLElement && focusTarget.matches("button, input, textarea, select, a[href], [tabindex], [contenteditable='true'], [contenteditable='']")) {
        try { focusTarget.focus({ preventScroll: true }) } catch { /* a page control may be going away */ }
      }
      pointer(target, "pointerdown", event, point)
      mouse(target, "mousedown", event, point)
      return true
    }
    if (event.type === "pointermove") {
      if (contact) {
        contact.last = point
        contact.packet = event
        pointer(contact.target, "pointermove", event, point)
        mouse(contact.target, "mousemove", event, point)
      } else hover(target, event, point)
      return true
    }
    if (event.type === "pointerup" || event.type === "pointercancel") {
      const held = contact
      if (!held) { hover(target, event, point); return true }
      held.last = point
      pointer(held.target, event.type, event, point)
      mouse(held.target, event.type === "pointerup" ? "mouseup" : "mouseleave", event, point)
      contact = null
      const upTarget = hit(point)
      if (event.type === "pointerup" && held.button === 2 && Math.hypot(point.x - held.start.x, point.y - held.start.y) < CLICK_SLOP) {
        if (upTarget) dispatchMirrorEvent(upTarget, new view.MouseEvent("contextmenu", { ...base(event, point), button: 2 }))
      } else if (event.type === "pointerup" && held.button === 0 && held.clickable && clickable(upTarget) === held.clickable
        && Math.hypot(point.x - held.start.x, point.y - held.start.y) < CLICK_SLOP) {
        const now = view.performance.now()
        const detail = lastClick?.target === held.clickable && now - lastClick.at <= 500 ? lastClick.detail + 1 : 1
        lastClick = { target: held.clickable, at: now, detail }
        dispatchMirrorEvent(held.clickable, new view.MouseEvent("click", { ...base(event, point), detail }))
        if (detail === 2) dispatchMirrorEvent(held.clickable, new view.MouseEvent("dblclick", { ...base(event, point), detail }))
      } else if (event.type === "pointercancel") lastClick = null
      hover(upTarget, event, point)
      return true
    }
    return false
  }

  const dispatchKey = (event: PadMirrorKey): boolean => {
    if (view.closed || doc.visibilityState === "hidden") return false
    const target = doc.activeElement
    if (!(target instanceof view.HTMLElement) || target === doc.body || target === doc.documentElement) return false
    const overviewArrow=event.altKey&&!event.shiftKey&&["ArrowDown","ArrowUp","ArrowLeft","ArrowRight"].includes(event.key)&&target.matches(".page-overview-page")&&!!target.closest(".page-overview")&&!target.closest("[hidden], [inert]")
    const preset=/^[1-9]$/.test(event.key)
    if(event.isComposing||event.keyCode===229||preset&&(event.type!=="keydown"||event.repeat||event.shiftKey||!target.matches('[data-tablet="surface"]')))return false
    if(event.ctrlKey||event.metaKey||event.altKey&&!overviewArrow||!preset&&!["Escape","ArrowDown","ArrowUp","ArrowLeft","ArrowRight","Home","End","Enter"," "].includes(event.key))return false

    const keyEvent = new view.KeyboardEvent(event.type, {
      key: event.key, code: event.code, repeat: event.repeat,
      ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
      bubbles: true, cancelable: true, composed: true, view,
    })
    dispatchMirrorEvent(target, keyEvent)
    if (event.type === "keydown" && !keyEvent.defaultPrevented && (event.key === "Enter" || event.key === " ")
      && target.matches("button, [role='button'], [role='menuitem']")) {
      dispatchMirrorEvent(target, new view.MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view, detail: 0 }))
    }
    return preset?keyEvent.defaultPrevented:true
  }
  return { pointer: dispatchPointer, key: dispatchKey, cancel: cancelContact }
}

/** PadHost installs the owner-scoped target with the pad's gate for the lifetime of that portal. */
export function registerPadMirrorInput(view: View, emit: Emit): () => void {
  const bridge = bridgeFor(view, emit)
  current?.cancel()
  current = bridge
  return () => { bridge.cancel(); if (current === bridge) current = null }
}

/** Called only by PadMirror's actual owner-window mouse handlers. */
export function forwardPadMirrorPointer(event: PadMirrorPointer): boolean { return current?.pointer(event) ?? false }
export function forwardPadMirrorKey(event: PadMirrorKey): boolean { return current?.key(event) ?? false }
