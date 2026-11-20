/**
 * The pen's DOUBLE-TAP actions and the ExpressKey commands, run from one place.
 *
 * The parts of the app that own the thing an action changes register a
 * handler (`registerPenHandlers`): the app owns colour, width and the pen
 * mode, the undo hook owns undo (the note's ONE timeline, the same as
 * Ctrl+Z / Ctrl+Y), the drawing canvas owns the selection. The toggles that
 * live in `penSettings` need no handler. A button and a keystroke both end in
 * `runPenAction`, so they cannot disagree. Undo and redo with the pen over the
 * tablet sheet take back the sheet's own strokes first (tabletFocus.ts).
 *
 * `installPenActions` is the runtime for the buttons. It listens on the
 * window in the capture phase, before any surface:
 *
 *  - a press that is not a gesture (a side button pressed in the air) is
 *    swallowed there, so no surface (notes page, ink region, tablet sheet) ever
 *    starts anything from it, and neither does the editor under it;
 *  - the same events drive `tapStep`, which fires a button's double-tap
 *    action once, on the second release. A single tap does nothing.
 *  - THE ECHO: on Windows Ink a side button pressed in the air may never reach
 *    the page as a pen event at all, only as the Wacom driver's right (lower)
 *    or middle (upper) MOUSE click at the pen. A mouse right / middle press
 *    while the pen is near, not touching, and not reporting the button itself
 *    is read as that button (and swallowed: it is not a click).
 *
 * HOLD actions (select, add, erase, pan) are not here: they are gestures, and
 * each surface runs them while the pen touches (penButtons.resolvePress).
 */

import { echoed, holdBegins, inContact, noTap, resolvePress, tapStep, PEN_COMMANDS, type Phase, type PenAction, type PenCommandAction, type PressLike, type TapState } from "./penButtons"
import { penNear, penSettings, pressEraseKey, setPenDraws, setSelectTool, setSheetEraser, setSheetSelect, sheetTools } from "./penSettings"
import { penOnSheet, tabletUndo } from "./tabletFocus"
import { penGate } from "./penGate"
import { nativeLive, nativeSideBusy, nativeSideMask, nativeState, onNativeButtons } from "./nativeButtons"
import { isPadMirrorEvent, MIRROR_MOUSE_POINTER_ID } from "./padMirrorInput"
const SYNTH_POINTER_ID = 4242

type Id = PenAction | PenCommandAction
const handlers = new Map<Id, () => void>()

/** Register what the owner of some actions does; the returned function takes them back. */
export function registerPenHandlers(map: Partial<Record<Id, () => void>>): () => void {
  const mine: [Id, () => void][] = []
  for (const [id, handler] of Object.entries(map) as [Id, () => void][]) {
    handlers.set(id, handler)
    mine.push([id, handler])
  }
  return () => { for (const [id, handler] of mine) if (handlers.get(id) === handler) handlers.delete(id) }
}

let lastPoint = { x: 0, y: 0 }
let lastView: Window | null = null
const actionWindows = new Set<Window>()
let allowMenu = false
/** True while a pen "right-click" action is dispatching its contextmenu event. */
export const penMenuAllowed = (): boolean => allowMenu

/** When a pen side button was last down (pen events or the driver's echo). */
let sideAt = -Infinity
/**
 * PER BUTTON (buttons bit 2 = lower, 4 = upper): when a PEN event last reported that side button itself (an echo just
 * after it is the same press), and whether a real (trusted) pen POINTERDOWN has reported it in the air (that button's
 * echo is then off for good). Per bit, because Windows Ink's pen data has one barrel flag: the lower button can come
 * as a pen event while the upper one only ever comes as the driver's middle click, and must keep its double tap.
 */
const penSideAt: Record<2 | 4, number> = { 2: -Infinity, 4: -Infinity }
const airSeen: Record<2 | 4, boolean> = { 2: false, 4: false }
/** The side buttons the driver's echo holds down now: the pen's hover samples meanwhile do not release them. */
let echoBits = 0
/** A side button of the pen is down now or was within `within` ms: no context menu may open. */
export const penButtonInUse = (within = 1000): boolean => performance.now() - sideAt < within

function rightClick(): void {
  const view = lastView ?? window
  const target = view.document.elementFromPoint(lastPoint.x, lastPoint.y) ?? view.document.body
  allowMenu = true
  try {
    target.dispatchEvent(new (view as any).MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, composed: true, button: 2, buttons: 0,
      clientX: lastPoint.x, clientY: lastPoint.y, view,
    }))
  } finally { allowMenu = false }
}

/** The tablet bar's buttons, found by what they say (CameraPane.tsx owns them). */
function pressTabletButton(match: string): void {
  const views=[lastView,...actionWindows].filter((view,index,all): view is Window => !!view && all.indexOf(view)===index)
  const buttons = views.flatMap(view=>[...view.document.querySelectorAll<HTMLButtonElement>(".camera-bar button, [data-tablet]")])
  const found = buttons.find((button) => button.dataset.tablet === match.toLowerCase()
    || button.textContent?.trim() === match)
  if (found && !found.disabled) found.click()
}

/**
 * Erase / Select on or off FOR THE SURFACE THE PEN IS OVER (or was last over, tabletFocus.ts): the tablet sheet has
 * its own pair, the document's is the toolbar's ⌫ / ⬚. A double tap, an ExpressKey and the menu all come here.
 */
function toggleTool(which: "erase" | "select"): void {
    const sheet = sheetTools()
    if (which === "erase") setSheetEraser(!sheet.eraser)
    else setSheetSelect(!sheet.selectTool)
}

/** `byPen`: a double tap of a side button (the sheet's undo then only when the pen is over the sheet, tabletFocus.ts). */
export function runPenAction(action: Id, byPen = false): boolean {
  // The sheet under the pen has its own strokes to take back (with nothing there, the note's turn).
  if ((action === "undo" || action === "redo") && tabletUndo(action, byPen)) return true
  const owner = handlers.get(action)
  if (owner) { owner(); return true }
  const now = penSettings()
  switch (action) {
    case "toggleErase": toggleTool("erase"); return true
    case "toggleSelect": toggleTool("select"); return true
    case "togglePenDraws": setPenDraws(!now.penDraws); return true
    case "contextMenu": rightClick(); return true
    case "sendWriting": pressTabletButton("Writing"); return true
    case "sendPage": pressTabletButton("Page"); return true
    case "clearSheet": pressTabletButton("clear"); return true
    case "none": return true
    default: return false
  }
}

/** A menu item or key by its command id ("penNextColour", ...). */
export function runPenCommand(id: string): boolean {
  const action = PEN_COMMANDS[id]
  return action ? runPenAction(action) : false
}

let tap: TapState = noTap
export function cancelPenTap(): void { tap = noTap }
const installed = new WeakMap<Window, () => void>()

function step(phase: Phase, event: PressLike): void {
  const result = tapStep(tap, phase, event, penSettings().buttons, performance.now())
  tap = result.state
  if (result.fire) runPenAction(result.fire, true)
}

let following = false
type ActionPadState = {enabled:boolean;available:boolean;owned:boolean;open:boolean}
let actionPad:ActionPadState|null=null,padPending=false
function nativeActionsEligible():boolean {
  if(!actionWindows.size)return false
  if(padPending)return false
  if(actionPad?.enabled&&actionPad.available)return actionPad.owned&&actionPad.open
  return [...actionWindows].some(view=>!view.closed&&view.document.hasFocus())
}
function followNative(): void {
  if (following) return
  following = true
  const api=(window as any).notemind?.pad
  if(api?.state&&api?.onState){
    padPending=true;let revision=0
    const receive=(state:ActionPadState|null):void=>{actionPad=state;padPending=false;if(!nativeActionsEligible()){tap=noTap;echoBits=0}}
    api.onState((state:ActionPadState)=>{revision++;receive(state)})
    const before=revision
    void api.state().then((state:ActionPadState)=>{if(revision===before)receive(state)},()=>{if(revision===before)receive(null)})
  }
  onNativeButtons((now, was) => {
    const side = nativeSideMask(now)
    if (side !== 0 || nativeSideMask(was) !== 0) sideAt = performance.now()
    if(!nativeActionsEligible()){tap=noTap;return}
	if (!now.present) { cancelPenTap(); return }
	if (!now.range) {
	  // A brief hover gap between completed taps can come from lifting the pen as the buttons are clicked.
	  // Leaving range with the button held is not a release. The normal double-tap deadline still applies.
	  if (tap.held) cancelPenTap()
	  return
	}
    step("move", { pointerType: "pen", button: -1, buttons: side | (now.tip ? 1 : 0), pressure: now.tip ? 0.5 : 0 })
  })
}

/** The events the Wacom driver sends for a side button, and nothing else about the pen: heard no more while a button is down and just after. */
const DRIVER_MOUSE = ["mousedown", "mouseup", "click", "auxclick", "dblclick", "contextmenu"] as const
const DRIVER_POINTER = ["pointerdown", "pointerup", "pointermove", "pointercancel"] as const

/**
 * What the Wacom driver makes of a side button of a PEN DISPLAY - Right Click (a pointer press, a mouse press, a context menu),
 * Middle Click (a press, an auxclick that closes a tab), Pan/Scroll (a wheel turning with the pen) - is not what the button means
 * (nativeButtons.ts). While the display's pen is in play its right / middle presses are dropped, and a click, a menu and the wheel
 * are dropped while a button is down and for SIDE_TAIL_MS after: the page sees the pen's buttons only as the display reports them.
 * Capture phase on `win`, first: before every surface, the chrome and the editor under them. A menu the pen itself asks for
 * (the "Right-click" double tap, `penMenuAllowed`) is its own.
 */
function installNativeGuard(win: Window): () => void {
  const drop = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation() }
  /** Native contact belongs to one physical pointer until its real lift/cancel; side-button changes are not new gestures. */
  const nativeContacts = new Set<number>()
  /** Mouse-form driver echoes are recognisable at the last pen point in this window while that pen remains nearby or native-live. */
  const atLocalPen = (event: Event): boolean => {
    if (lastView !== win || !penNear(1200)) return false
    const { clientX, clientY } = event as MouseEvent
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false
    return Math.hypot(clientX - lastPoint.x, clientY - lastPoint.y) <= 24
  }
  const pointer = (event: Event): void => {
    const e = event as PointerEvent
    if (e.pointerType === "mouse" && (e.pointerId === MIRROR_MOUSE_POINTER_ID || isPadMirrorEvent(e))) return
    const pen = e.pointerType === "pen" && e.pointerId !== SYNTH_POINTER_ID
    const contacting = pen && inContact(e)
    if (pen && nativeLive() && e.type === "pointermove") {
      if (!contacting) nativeContacts.delete(e.pointerId)
      else if (!nativeContacts.has(e.pointerId) && holdBegins(false, e)) nativeContacts.add(e.pointerId)
      return
    }
    if (pen && e.type === "pointercancel") {
      nativeContacts.delete(e.pointerId)
      return
    }
    if (pen && e.type === "pointerup" && !nativeLive()) nativeContacts.delete(e.pointerId)
    if (e.button === 0) {
      if (pen && e.type === "pointerdown" && nativeLive()) {
        if (nativeContacts.has(e.pointerId)) { drop(event); return }
        if (contacting) nativeContacts.add(e.pointerId)
      }
      if (pen && e.type === "pointerup") nativeContacts.delete(e.pointerId)
      // Factory driver Left Click echoes can start a mouse selection on a sheet. Drop that click only when it lands
      // at this window's recent pen point and the display says its tip is up.
      if (e.pointerType === "mouse" && nativeSideBusy() && !nativeState().tip && atLocalPen(event)) drop(event)
      return
    }
    if (e.button !== 1 && e.button !== 2) return
    // (the tablet feed's synthetic pen is another tablet's, with its own buttons: not the driver's click)
    if (e.pointerId === SYNTH_POINTER_ID) return
    // A pen-typed Right / Middle event while the native feed is live can be the start of real contact: the native tip
    // report is authoritative even when this event has no DOM tip bit or pressure. Keep it for the drawing surface,
    // but prevent its compatibility mouse events. A side press with no native contact is only the driver's echo.
    if (e.pointerType === "pen" && nativeLive()) {
      if (e.type === "pointerdown") {
        if (nativeContacts.has(e.pointerId) || !contacting) { drop(event); return }
        nativeContacts.add(e.pointerId)
      } else if (e.type === "pointerup") {
        if (!nativeContacts.has(e.pointerId) || nativeState().tip) { drop(event); return }
        nativeContacts.delete(e.pointerId)
      }
      event.preventDefault()
    }
    // Mouse-form events can be the Wacom driver's echo, but a side-button report is broadcast to every app window.
    // Only suppress the echo at the recent pen point in the window receiving that pen; preserve real mouse input elsewhere.
    if (e.pointerType === "mouse" && nativeSideBusy() && !nativeState().tip && atLocalPen(event)) drop(event)
  }
  const mouse = (event: Event): void => {
    if (isPadMirrorEvent(event)) return
    const e = event as MouseEvent
    const penTyped = (e as MouseEvent & { pointerType?: string }).pointerType === "pen"
    if (nativeLive() && penTyped && (e.button === 1 || e.button === 2)) { drop(event); return }
    if (e.type === "contextmenu") {
      // (a menu comes with the PRESS on a Mac, perhaps before the display's report of it: while its pen is in play, the pen's own menu is dropped too)
      if (allowMenu) return
      if ((nativeSideBusy() && atLocalPen(event)) || (nativeLive() && (e as PointerEvent).pointerType === "pen")) drop(event)
      return
    }
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    if (nativeSideBusy() && atLocalPen(event) && (e.button !== 0 || !nativeState().tip)) drop(event)
  }
  const wheel = (event: Event): void => { if (nativeSideBusy() && atLocalPen(event)) drop(event) }
  const listeners: [string, (event: Event) => void][] = [
    ...DRIVER_POINTER.map((type): [string, (event: Event) => void] => [type, pointer]),
    ...DRIVER_MOUSE.map((type): [string, (event: Event) => void] => [type, mouse]),
    ["wheel", wheel],
  ]
  for (const [type, listener] of listeners) win.addEventListener(type, listener, { capture: true, passive: false })
  return () => { for (const [type, listener] of listeners) win.removeEventListener(type, listener, { capture: true }) }
}


export function installPenActions(win: Window = window): () => void {
  if (typeof window === "undefined") return () => {}
  const existing = installed.get(win); if (existing) return existing
  followNative()
  actionWindows.add(win)
  const resetIfInactive=():void=>{if(!nativeActionsEligible()){tap=noTap;echoBits=0}}
  win.addEventListener('blur',resetIfInactive)
  const unguard = installNativeGuard(win)
  const hear = (phase: Phase) => (event: PointerEvent) => {
    if (event.pointerType === "mouse") { echo(phase, event); return }
    if (event.pointerType !== "pen") return
    lastPoint = { x: event.clientX, y: event.clientY }
    lastView = win
    if (nativeLive() && event.pointerId !== SYNTH_POINTER_ID) return
    const side = event.buttons & 6
    if (side !== 0) {
      sideAt = performance.now()
      for (const bit of [2, 4] as const) {
        if ((side & bit) === 0) continue
        penSideAt[bit] = sideAt
        // The system itself reports this side button pressed in the air: its driver click is never needed (or counted).
        if (phase === "down" && event.isTrusted && !inContact(event)) airSeen[bit] = true
      }
    }
    // The pen touching (or the gesture cancelled) ends any press the echo was holding.
    if (phase === "cancel" || inContact(event)) echoBits = 0
    if (phase === "down") {
      const press = resolvePress(event, penSettings())
      // (the Wacom sheet, or the camera's picture the pen writes on: CameraInk.tsx)
      const sheet = event.target && typeof (event.target as Element).closest === "function" && (event.target as Element).closest(".tablet, .camera-ink") !== null
      // Not the surfaces' business: a side button in the air, or a pan over a sheet that has nowhere to scroll.
      if (press.kind === "ignore" || (press.kind === "pan" && sheet)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    // While the echo holds a button, the pen's own hover samples carry it too (penButtons.echoed).
    step(phase, echoed(event, echoBits))
  }
  /** The driver's mouse click for a side button pressed in the air (see the header). */
  const echo = (phase: Phase, event: PointerEvent) => {
    if (event.pointerId === MIRROR_MOUSE_POINTER_ID || isPadMirrorEvent(event)) return
    if (phase === "cancel") { echoBits = 0; return }
    if (phase !== "down" && phase !== "up") return
    const bit = event.button === 2 ? 2 : event.button === 1 ? 4 : 0
    // While the native feed owns the pen (the sheet), its samples carry the buttons themselves: an echo would count twice.
    if (bit === 0 || nativeLive() || airSeen[bit] || !penNear(1000) || penGate().captureOn()) return
    // A real mouse can select elsewhere while the pen is nearby. Driver echoes begin at this window's pen point.
    if (phase === "down" && (lastView !== win || Math.hypot(event.clientX-lastPoint.x,event.clientY-lastPoint.y)>24)) return
    const now = performance.now()
    // The pen reported this press itself (not an echo), or a release whose press was not taken as one.
    if ((phase === "down" && now - penSideAt[bit] < 300) || (phase === "up" && (echoBits & bit) === 0)) return
    event.preventDefault()
    event.stopPropagation()
    sideAt = now
    echoBits = phase === "down" ? echoBits | bit : echoBits & ~bit
    step(phase === "down" ? "down" : echoBits !== 0 ? "move" : "up",
      { pointerType: "pen", button: event.button, buttons: echoBits, pressure: 0 })
  }
  const listeners: [string, (event: PointerEvent) => void][] = [["pointerdown",hear("down")],["pointermove",hear("move")],["pointerup",hear("up")],["pointercancel",hear("cancel")]]
  for (const [type, listener] of listeners) win.addEventListener(type, listener as EventListener, true)
  const stop=(): void => {for(const [type,listener] of listeners)win.removeEventListener(type,listener as EventListener,true);win.removeEventListener('blur',resetIfInactive);unguard();installed.delete(win);actionWindows.delete(win);if(lastView===win)lastView=null;resetIfInactive()}
  installed.set(win,stop);return stop
}


