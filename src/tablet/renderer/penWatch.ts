/**
 * penWatch.ts - what the pen feed watches to learn that its target (the tablet sheet, or the camera's picture area) changed, and how
 * often it answers. (Pure of React and of the page's globals, so the scoping has a test: penWatch.test.ts.)
 *
 * It used to watch EVERY change to the whole page: a childList + subtree observer on `document.body`, and the report (a
 * `getBoundingClientRect` of the surface, a JSON of the mapping) ran once per callback. Scrolling a heavy note rewrites the document's
 * lines about sixty times a second, so with the tablet sheet or the camera showing that was 76 to 85 callbacks and about 1,300 extra
 * layout reads a second for nothing — none of those lines is the surface (Sean, 2026-10-27: "scrolling is sluggish").
 *
 * Now:
 *   - the surface's own attributes (`data-pen-surface`, `data-pen-rect`, `data-pen-key`, which CameraInk publishes) are watched
 *     page-wide, by name, so only a change of THEM is heard, wherever it happens;
 *   - the pane's own element is watched for children coming and going (the sheet or the picture's canvas appearing, or being
 *     swapped), because the pane is all a surface can appear in; the document is not in it;
 *   - anything else (a surface that moved because the window or the pane did, a pane replaced whole) is the resize listener's and
 *     the half-second timer's, as before;
 *   - and however many things ask in a frame, the report is made ONCE, in the next animation frame.
 */

/** The attributes the camera publishes its pen area in (CameraInk.tsx). */
export const PEN_ATTRIBUTES = ["data-pen-surface", "data-pen-rect", "data-pen-key"]

/** The part of a MutationObserver that is used (a test hands in a stand-in). */
export interface ObserverLike {
  observe(target: Node, options: { childList?: boolean; subtree?: boolean; attributes?: boolean; attributeFilter?: string[] }): void
  disconnect(): void
}

export interface PenWatchDeps {
  /** Where the surface's attributes are watched (the whole page: `document.body`). */
  attributesRoot: Node
  /** The pane the surface lives in, watched for children coming and going (null: not found, the timer covers it). */
  paneRoot: Node | null
  /** A MutationObserver for a callback, or null where there is none. */
  observer: (callback: () => void) => ObserverLike | null
  /** requestAnimationFrame and cancelAnimationFrame. */
  frame: (callback: () => void) => number
  cancelFrame: (id: number) => void
  /** The report itself. */
  report: () => void
}

export interface PenWatch {
  /** Ask for a report: made once in the next animation frame, however many ask before it. */
  schedule(): void
  stop(): void
}

export function watchPenSurface(deps: PenWatchDeps): PenWatch {
  let pending: number | null = null
  const schedule = (): void => {
    if (pending !== null) return
    pending = deps.frame(() => { pending = null; deps.report() })
  }
  const watcher = deps.observer(schedule)
  // Its attributes, wherever they change; no children, no text, nothing else of the page.
  watcher?.observe(deps.attributesRoot, { attributes: true, subtree: true, attributeFilter: PEN_ATTRIBUTES })
  // The pane's own children, and only the pane's.
  if (deps.paneRoot) watcher?.observe(deps.paneRoot, { childList: true, subtree: true })
  return {
    schedule,
    stop() {
      watcher?.disconnect()
      if (pending !== null) { deps.cancelFrame(pending); pending = null }
    },
  }
}

