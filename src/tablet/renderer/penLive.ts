/**
 * What the pen is reporting RIGHT NOW, and what it has ever reported: the
 * tip, the lower and upper side buttons, the eraser end and the pressure.
 * It feeds three readers — the "Test buttons" panel in the Pen popover, the
 * Pen chip (which names the action a held button has), and the pen cursor
 * (which draws the marquee ring / eraser cross / hand for it).
 *
 * Subscribers hear about a change in WHICH BUTTONS are down; pressure alone
 * is only broadcast to a reader that asked for it (`watchPressure`), once a
 * frame, so a drawing stroke does not re-render anything.
 */

import { useEffect, useSyncExternalStore } from "react"
import { nativeLive, nativeSideMask, onNativeButtons } from "./nativeButtons"
import { buttonsOf, pressButtons, slotOf, type HoldAction, type Slot } from "./penButtons"
import { penSettings } from "./penSettings"

export interface PenLive {
  tip: boolean
  lower: boolean
  upper: boolean
  eraser: boolean
  alt: boolean
  pressure: number
  /** Which buttons the system has EVER reported since the window opened. */
  seen: { tip: boolean; lower: boolean; upper: boolean; eraser: boolean }
  /** The pointer is a pen, and the last event came from it. */
  pen: boolean
  /**
   * The tip touched with NO side button held: this is a stroke being drawn, and a button pressed or let go before the
   * pen lifts does nothing (Sean, 2026-10-06: "when i'm currently drawing, pressing a button doesn't do anything,
   * currently it's changing the pointer"). A hold is decided at contact.
   */
  drawing: boolean
}

let live: PenLive = {
  tip: false, lower: false, upper: false, eraser: false, alt: false, pressure: 0,
  seen: { tip: false, lower: false, upper: false, eraser: false }, pen: false, drawing: false,
}
/** What the buttons readers see: a new object only when a button changed. */
let shown = live
/** What the pressure readers see: replaced once a frame while the pen moves. */
let shownPressure = live
const listeners = new Set<() => void>()
const pressureListeners = new Set<() => void>()
let pressureWatchers = 0
let frame: number | null = null

const notify = () => { shown = live; shownPressure = live; listeners.forEach((listener) => listener()) }

function sample(event: PointerEvent): void {
  if (event.pointerType !== "pen") return
  // (a pen display's own buttons laid over the pointer's: penButtons.ts withNative)
  const buttons = pressButtons(event)
  const tip = (buttons & 1) !== 0
  const lower = (buttons & 2) !== 0
  const upper = (buttons & 4) !== 0
  const eraser = (buttons & 32) !== 0 || event.button === 5 && event.type === "pointerdown"
  const alt = event.altKey
  const changed = tip !== live.tip || lower !== live.lower || upper !== live.upper
    || eraser !== live.eraser || alt !== live.alt || !live.pen
  const seen = {
    tip: live.seen.tip || tip, lower: live.seen.lower || lower,
    upper: live.seen.upper || upper, eraser: live.seen.eraser || eraser,
  }
  const grew = seen.tip !== live.seen.tip || seen.lower !== live.seen.lower
    || seen.upper !== live.seen.upper || seen.eraser !== live.seen.eraser
  const drawing = tip && (live.tip ? live.drawing : !lower && !upper && !eraser)
  live = { tip, lower, upper, eraser, alt, pressure: tip || eraser ? event.pressure : 0, seen, pen: true, drawing }
  if (changed || grew || drawing !== shown.drawing) notify()
  else if (pressureWatchers > 0 && frame === null) {
    // (the pressure meter is the pen sheet's, in the notes window's top bar: its frames are that window's)
    frame = requestAnimationFrame(() => { frame = null; shownPressure = live; pressureListeners.forEach((listener) => listener()) })   // realm: notes
  }
}

/**
 * A pen display's side button pressed or let go while the pen holds still sends no pointer event: the display's own report moves
 * the buttons here (the cursor and the Pen chip name what the button held would do at once, not at the next move).
 */
let followed = false
function followNative(): void {
  if (followed) return
  followed = true
  onNativeButtons(() => {
    if (!live.pen || !nativeLive()) return
    const mask = nativeSideMask()
    const lower = (mask & 2) !== 0
    const upper = (mask & 4) !== 0
    if (lower === live.lower && upper === live.upper) return
    live = {
      ...live, lower, upper, seen: { ...live.seen, lower: live.seen.lower || lower, upper: live.seen.upper || upper },
    }
    notify()
  })
}

const watched = new WeakMap<object, () => void>()
/** What the pen is doing is read on `win` (this page's own window unless it is given the pad's); once per window. Returns the way to stop. */
export function watchLive(win: Window = window): () => void {
  if (typeof window === "undefined") return () => {}
  const had = watched.get(win)
  if (had) return had
  followNative()
  const hear = (event: Event) => sample(event as PointerEvent)
  const types = ["pointerdown", "pointermove", "pointerup", "pointercancel"]
  for (const type of types) win.addEventListener(type, hear, true)
  const left = (event: Event) => {
    if ((event as PointerEvent).pointerType !== "pen" || !live.pen) return
    live = { ...live, tip: false, lower: false, upper: false, eraser: false, pressure: 0, drawing: false }
    notify()
  }
  win.document.addEventListener("pointerleave", left, true)
  const stop = (): void => {
    for (const type of types) win.removeEventListener(type, hear, true)
    win.document.removeEventListener("pointerleave", left, true)
    watched.delete(win)
  }
  watched.set(win, stop)
  return stop
}

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The action of the button that is held now, if one is: what the pen is "in". */
export function heldSlot(state: PenLive = live): Slot | null {
  if (!state.pen || (state.tip && state.drawing)) return null
  return slotOf({
    pointerType: "pen", button: -1, altKey: state.alt,
    buttons: (state.tip ? 1 : 0) | (state.lower ? 2 : 0) | (state.upper ? 4 : 0) | (state.eraser ? 32 : 0),
  })
}

/** The HOLD action of that button: what the pen will do when it touches. */
export function heldAction(state: PenLive = live): HoldAction | null {
  const slot = heldSlot(state)
  return slot ? buttonsOf(penSettings())[slot].hold : null
}

export function usePenLive(options: { pressure?: boolean } = {}): PenLive {
  useEffect(() => {
    if (!options.pressure) return
    pressureWatchers++
    return () => { pressureWatchers-- }
  }, [options.pressure])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      if (options.pressure) pressureListeners.add(listener)
      return () => { listeners.delete(listener); pressureListeners.delete(listener) }
    },
    () => (options.pressure ? shownPressure : shown),
  )
}

