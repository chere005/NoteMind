/**
 * nativeButtons.ts - A PEN DISPLAY'S SIDE BUTTONS, as the display itself reports them.
 *
 * Sean, 2026-10-28: "can you make the default wacom buttons do the erase and hold to select rather than making me select different
 * buttons in the wacom settings?". On a pen display (the Wacom One 12) the Wacom driver turns a side button into whatever Wacom
 * Center says: Right Click, Middle Click, Pan/Scroll. Only a button set to Right or Middle Click ever reached the page, as a pen
 * event with a button bit, and a button left on Pan/Scroll never did. The display also reports its pen to the app by itself (main/pen,
 * `wm-pen --buttons`: tip, the two side buttons, in range), whatever the driver does with them; this module holds that state, and
 * penButtons.ts reads the DOM pen pointer WITH it.
 *
 * While the display's pen is the pen in play (`nativeLive`):
 *   - the pen's side buttons are the display's, not the pointer events': a Right / Middle Click the driver sends for a button is
 *     dropped from what the pointer says (penButtons.ts `withNative`) and the display's own state is read instead;
 *   - the nearer-tip physical button is the app's first button: hold erases and double-tap undoes. It uses the middle-click
 *     slot. The farther button is the second: hold selects and double-tap redoes, in the right-click slot.
 *   - what the driver sends for the buttons is not heard (penActions.ts `installNativeGuard`): a right-click menu, a middle click, the
 *     scroll wheel of Pan/Scroll, while a button is down and for SIDE_TAIL_MS after it came up.
 *
 * With no pen display (nothing present, another platform, a Windows pen) none of this exists and the pointer is read as it always was.
 * Pure: no DOM, no Electron, so the tests ask it directly; the clock is `performance.now()` unless a caller passes one.
 */

import { NO_BUTTONS, sameButtons, type PenButtonsState } from "../shared/pen"

/** What the driver sends for a side button (a click, a menu, a scroll) is ignored this long after the button comes up. */
export const SIDE_TAIL_MS = 300
/** The display's pen counts as the pen in play this long after it leaves range (its last pointer events are still on their way). */
export const RANGE_TAIL_MS = 300

/** The pointer bits: tip, second button (right click), first button (middle click). */
export const MASK = { tip: 1, second: 2, first: 4 } as const

let state: PenButtonsState = { ...NO_BUTTONS }
let sideUpAt = -Infinity
let rangeEndAt = -Infinity
const listeners = new Set<(now: PenButtonsState, was: PenButtonsState) => void>()

export const nativeState = (): PenButtonsState => state

/** The display told us its pen: the state is now this. Listeners hear a change only. */
export function setNativeButtons(next: PenButtonsState, now = performance.now()): void {
  if (sameButtons(next, state)) return
  const was = state
  state = { ...next }
  if ((was.lower || was.upper) && !(next.lower || next.upper)) sideUpAt = now
  if (was.range && !next.range) rangeEndAt = now
  for (const listener of [...listeners]) { try { listener(state, was) } catch { /* a listener never breaks the feed */ } }
}

export function onNativeButtons(listener: (now: PenButtonsState, was: PenButtonsState) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The display's pen is the pen in play: reported in range, or within RANGE_TAIL_MS of leaving it. */
export const nativeLive = (now = performance.now()): boolean => state.present && (state.range || now - rangeEndAt < RANGE_TAIL_MS)

/** A side button of the display's pen is down, or was within SIDE_TAIL_MS: what the Wacom driver sends for it is not heard. */
export const nativeSideBusy = (now = performance.now()): boolean => state.lower || state.upper || now - sideUpAt < SIDE_TAIL_MS

/** The report's lower physical switch is the first button; upper is the second. */
export const nativeSideMask = (s: Pick<PenButtonsState, "lower" | "upper"> = state): number =>
  (s.lower ? MASK.first : 0) | (s.upper ? MASK.second : 0)

/** The state as it was before the first report (tests). */
export function resetNativeButtons(): void {
  state = { ...NO_BUTTONS }
  sideUpAt = -Infinity
  rangeEndAt = -Infinity
}
