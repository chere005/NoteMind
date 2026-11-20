/**
 * Passive display button state. Driver pointer events use these physical switches while the Wacom pen is in range.
 * `nativeButtonsFeed.ts` also handles contact coordinates for Drawing when the display supplies them.
 */

import { NO_BUTTONS, sameButtons, type PenButtonsState } from "../shared/pen"

/** What the driver sends for a side button (a click, a menu, a scroll) is ignored this long after the button comes up. */
export const SIDE_TAIL_MS = 300
/** The display's pen counts as the pen in play this long after it leaves range (its last pointer events are still on their way). */
export const RANGE_TAIL_MS = 300

/** The pointer bits: tip, lower button (right click), upper button (middle click). */
export const MASK = { tip: 1, lower: 2, upper: 4 } as const

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

/** Physical switch names stay the same through the DOM-compatible button mask. */
export const nativeSideMask = (s: Pick<PenButtonsState, "lower" | "upper"> = state): number =>
  (s.lower ? MASK.lower : 0) | (s.upper ? MASK.upper : 0)

/** The state as it was before the first report (tests). */
export function resetNativeButtons(): void {
  state = { ...NO_BUTTONS }
  sideUpAt = -Infinity
  rangeEndAt = -Infinity
}
