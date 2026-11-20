/**
 * The tablet pen's settings and what the app has seen of it.
 *
 * A Wacom (or any Windows Ink) pen arrives as `pointerType: "pen"` pointer
 * events. The choices belong to the person, kept in localStorage
 * (`notemind.pen`):
 *
 *  - `penDraws`: the pen's tip draws on the page whatever the mode is, so
 *    the mouse can keep selecting and typing while the pen writes. (Off, the
 *    pen follows the ✎ button like the mouse does.)
 *  - `pressure`: pressure changes the width of the stroke.
 *  - `buttons`: each of the pen's buttons (lower side button, upper side
 *    button, eraser end, tip held with Alt) has a HOLD action and the side
 *    buttons a DOUBLE-TAP action too — see penButtons.ts. Stored as `slots`;
 *    `buttons` (the hold actions alone) and `sideButton` (the oldest two-way
 *    choice) are written as well, for an older NoteMind reading the same key.
 *    An older map is migrated by `migrateButtons`.
 *
 * The pen or eraser choice is remembered. Drawing keeps the active Eraser and Select tools in `sheetTools`.
 * A held pen button uses its configured action for the duration of the contact.
 *
 * And one thing is learned, not chosen: whether the pen has been SEEN, and
 * whether it reports pressure at all. A driver without Windows Ink sends
 * every sample at 0.5 (or 0 while hovering); saying so is the difference
 * between "Wacom support is missing" and "turn on Windows Ink".
 */

import { useSyncExternalStore } from "react"
import {
  BUTTON_LAYOUT, DEFAULT_BUTTONS, hasDoubleTap, holdMap, migrateButtons,
  type HoldAction, type PenButtonMap, type Slot, type TapAction,
} from "./penButtons"
import { isPenKind, type PenKind } from "./penKinds"

export type PenSeen = "none" | "pen" | "pressure"

export type SideButton = "selects" | "erases"

export type PenTool = "pen" | "eraser"

export interface PenSettings {
  penDraws: boolean
  pressure: boolean
  /** Derived from `buttons.lower.hold`: erases, or anything else ("selects"). */
  sideButton: SideButton
  buttons: PenButtonMap
  /** The last pen or eraser chosen in the Drawing toolbar. */
  tool: PenTool
  /** Which pen the pen is on a drawing sheet: Pen, Marker, Fountain Pen or Highlighter (penKinds.ts). Remembered. */
  kind: PenKind
  /** The Erase tool is on: a press rubs out strokes, whatever the pointer. */
  eraser: boolean
  /** The Select tool is on: a press picks up / moves objects or pulls a marquee. */
  selectTool: boolean
  seen: PenSeen
}

const KEY = "notemind.pen"

const sideOf = (buttons: PenButtonMap): SideButton => (buttons.lower.hold === "erase" ? "erases" : "selects")

function load(): Pick<PenSettings, "penDraws" | "pressure" | "sideButton" | "buttons" | "tool" | "kind"> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PenSettings> & { slots?: unknown }
    const buttons = migrateButtons(raw)
    return {
      penDraws: raw.penDraws ?? true, pressure: raw.pressure ?? true, buttons, sideButton: sideOf(buttons),
      tool: raw.tool === "eraser" ? "eraser" : "pen", kind: isPenKind(raw.kind) ? raw.kind : "pen",
    }
  } catch {
    return { penDraws: true, pressure: true, buttons: { ...DEFAULT_BUTTONS }, sideButton: sideOf(DEFAULT_BUTTONS), tool: "pen", kind: "pen" }
  }
}

let state: PenSettings = { ...load(), eraser: false, selectTool: false, seen: "none" }
let preferenceRevision = 0
const listeners = new Set<() => void>()

function set(next: Partial<PenSettings>): void {
  const persisted = (["penDraws", "pressure", "tool", "kind", "buttons"] as const)
    .some(key => next[key] !== undefined && next[key] !== state[key])
  if (persisted) preferenceRevision++
  state = { ...state, ...next }
  if (persisted) try {
    localStorage.setItem(KEY, JSON.stringify({
      penDraws: state.penDraws, pressure: state.pressure, tool: state.tool, kind: state.kind,
      buttonLayout: BUTTON_LAYOUT, slots: state.buttons,
      // For an older NoteMind on the same profile.
      buttons: holdMap(state.buttons), sideButton: state.sideButton,
    }))
    window.notemind.preferenceSet('pen',localStorage.getItem(KEY)).catch(()=>{})
  } catch { /* private window: the setting lasts the session */ }
  listeners.forEach((listener) => listener())
}

export const penSettings = (): PenSettings => state
export const setPenDraws = (penDraws: boolean) => set({ penDraws })
export const setPressure = (pressure: boolean) => set({ pressure })
/** One job of one button: `hold` (while the pen touches) or `double` (two taps in the air; side buttons only). */
export function setButton(slot: Slot, job: "hold", action: HoldAction): void
export function setButton(slot: Slot, job: "double", action: TapAction): void
export function setButton(slot: Slot, job: "hold" | "double", action: HoldAction | TapAction): void {
  if (job === "double" && !hasDoubleTap(slot)) return
  const buttons = { ...state.buttons, [slot]: { ...state.buttons[slot], [job]: action } }
  set({ buttons, sideButton: sideOf(buttons) })
}
/** The selected pen or eraser is stored alongside the pen kind. */
export const setPenTool = (tool: PenTool) => set({ tool })
export const setPenKind = (kind: PenKind) => set({ kind })

// MARK: - The tablet sheet's own tools

/** The sheet's Erase and Select: one pair for every sheet tab, never remembered. */
export interface SheetTools { eraser: boolean; selectTool: boolean }

let sheet: SheetTools = { eraser: false, selectTool: false }
const sheetListeners = new Set<() => void>()
function setSheet(next: Partial<SheetTools>): void {
  const merged = { ...sheet, ...next }
  if (merged.eraser === sheet.eraser && merged.selectTool === sheet.selectTool) return
  sheet = merged
  sheetListeners.forEach((listener) => listener())
}
export const sheetTools = (): SheetTools => sheet
export function subscribeSheetTools(listener:()=>void):()=>void { sheetListeners.add(listener);return()=>{sheetListeners.delete(listener)} }
export const setSheetEraser = (eraser: boolean) => setSheet(eraser ? { eraser, selectTool: false } : { eraser })
export const setSheetSelect = (selectTool: boolean) => setSheet(selectTool ? { selectTool, eraser: false } : { selectTool })
/** What a press ON THE SHEET is resolved with: the pen's buttons and choices, the sheet's own tools. */
export const sheetPressSettings = (): PenSettings => ({ ...state, eraser: sheet.eraser, selectTool: sheet.selectTool })
export function useSheetTools(): SheetTools {
  return useSyncExternalStore(
    subscribeSheetTools,
    sheetTools,
  )
}

/** When a pen was last seen (any event, hovering too): a touch just after it is a palm. */
let penAt = -Infinity
export const penNear = (within = 1200): boolean => performance.now() - penAt < within

/** Called for every pointer event: the one place a pen is noticed. */
export function noticePen(event: PointerEvent): void {
  if (event.pointerType !== "pen") return
  penAt = performance.now()
  // Anything but the two values a driver without pressure sends.
  const varies = event.pressure > 0 && event.pressure !== 0.5
  if (state.seen === "pressure") return
  if (varies) set({ seen: "pressure" })
  else if (state.seen === "none") set({ seen: "pen" })
}

export function watchPenIn(win: Window): () => void {
  win.addEventListener("pointerdown",noticePen,true);win.addEventListener("pointermove",noticePen,true)
  return () => {win.removeEventListener("pointerdown",noticePen,true);win.removeEventListener("pointermove",noticePen,true)}
}
let installed = false
export function watchPen(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  window.addEventListener("pointerdown", noticePen, true)
  window.addEventListener("pointermove", noticePen, true)
}

export function usePenSettings(): PenSettings {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    penSettings,
  )
}

const receivePen=value=>{if(typeof value!=='string'||localStorage.getItem(KEY)===value)return;preferenceRevision++;localStorage.setItem(KEY,value);state={...state,...load()};listeners.forEach(listener=>listener())};
// A delayed startup read must not replace a button choice made while that read was in flight.
const startupRevision=preferenceRevision;
window.notemind.preferenceGet('pen').then(value=>{if(preferenceRevision===startupRevision)receivePen(value)}).catch(()=>{});
window.notemind.onPreference(({key,value})=>{if(key==='pen')receivePen(value)});
