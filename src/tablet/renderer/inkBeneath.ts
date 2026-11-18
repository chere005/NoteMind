/**
 * A stroke placed UNDER the ink already on a sheet (the highlighter: writing stays crisp on top of its band).
 *
 * It is one ordinary edit of the sheet: the sheet's action queue (`createInkActionController`, ink-mutations.js) waits
 * for the changes before it, `TabletPage.replaceAsync` makes the new list as ONE undo, and everything that follows
 * (Undo, Redo, the eraser, a selection, the autosave) sees a stroke like any other, first in the list. Committed
 * strokes and the list they were in are never changed: the new list is a new array.
 */

import type { GeometryChangeOptions, InkStroke, TabletPage } from "./tabletPage"

interface Pace { signal?: AbortSignal; yieldControl?: () => Promise<void> }

/** The sheet's action queue, as much of it as is used here. */
export interface InkActions {
  enqueue(prepare: (captured: InkStroke[], source: InkStroke[], options: Pace) => unknown,
    options?: { capture?: boolean }): Promise<boolean>
}

function cancelled(): Error {
  const error = Error("Drawing change cancelled.")
  error.name = "AbortError"
  return error
}

/** `strokes` with `stroke` under them: a new frozen list. A long list is copied in pieces. */
export async function beneath(strokes: InkStroke[], stroke: InkStroke, pace: Pace = {}): Promise<InkStroke[]> {
  const next: InkStroke[] = new Array(strokes.length + 1)
  next[0] = stroke
  for (let at = 0; at < strokes.length; at++) {
    next[at + 1] = strokes[at]!
    if ((at + 1) % 4096 !== 0 || !pace.yieldControl) continue
    await pace.yieldControl()
    if (pace.signal?.aborted) throw cancelled()
  }
  return Object.freeze(next) as InkStroke[]
}

/**
 * Put `stroke` under the sheet's ink. `prepare` finishes the stroke first (a ruled line is straightened). Resolves
 * true when it is on the sheet; rejects when the sheet changed under it or the change was cancelled.
 */
export function placeBeneath(actions: InkActions, page: TabletPage, stroke: InkStroke,
  prepare?: (stroke: InkStroke, options: Pace) => InkStroke | Promise<InkStroke>): Promise<boolean> {
  return actions.enqueue(async (_captured, source, options) => {
    const made = prepare ? await prepare(stroke, options) : stroke
    const target = await beneath(source, made, options)
    return { target, commit: (change: GeometryChangeOptions) => page.replaceAsync(target, change) }
  }, { capture: false })
}
