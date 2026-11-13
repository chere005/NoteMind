/**
 * usePenFeed.ts - the active Tablet sheet or camera picture's side of the pen feed.
 *
 * While a writable surface shows, main is told the feed is wanted (`pen:open`) and where its safe mapping rectangle is (`pen:sheet`):
 * the same rectangle the feed writes on (penTarget.ts: the sheet, or the camera's tablet-shaped area round its picture, inside its
 * canvas), with the person's Tablet orientation and nothing else. Main decides which native backend feeds it and whether the window is
 * in front. `pen:close` goes when the surface goes. The person's capture/mapping settings are unchanged.
 *
 * Esc NEVER lets go of capture here: on the Tablet sheet it only clears a box or closes a menu (a second Esc used to drop the whole-tablet
 * mapping silently). A self-opened gate (a bug of ours must not take the pen away from the whole window) still releases until the window is
 * focused again.
 */

import { useCallback, useEffect, useRef } from "react"
import type { FeedStatus, SheetReport } from "../shared/pen"
import { currentTurns, subscribeOrientation } from "./orientation"
import { acceptStatus, installPenFeed, markOpened, markSheet, usePenFeedStore } from "./penFeed"
import { mappingReport, nativePenTarget } from "./penTarget"
import { watchPenSurface } from "./penWatch"

export interface PenFeedHandle {
  /** The platform has a native feed at all (false off Windows: the UI shows nothing). */
  available: boolean
  /** Capture is on right now: the gate is swallowing the OS pen and the feed is drawing the sheet. */
  capturing: boolean
  status: FeedStatus | null
  /** Why the gate opened itself, or null. */
  selfOpen: string | null
}

export function usePenFeed(sheetShowing: boolean): PenFeedHandle {
  const store = usePenFeedStore()
  const statusRef = useRef<FeedStatus | null>(null)
  statusRef.current = store.status

  useEffect(() => { installPenFeed() }, [])

  /** Tell main the feed is wanted (or wanted again, after a release). */
  const open = useCallback(async (): Promise<void> => {
    const api = window.wm?.pen
    if (!api) return
    try {
      const status = await api.open()
      acceptStatus(status)
      markOpened(true)
    } catch { /* the main side is gone: the gate stays open */ }
  }, [])

  // A tablet sheet or camera picture is showing: the feed is wanted. Putting the pane away lets go.
  useEffect(() => {
    const api = window.wm?.pen
    markSheet(sheetShowing)
    if (!api || !sheetShowing) return
    void open()
    return () => {
      markOpened(false)
      markSheet(false)
      void api.close("sheet gone").catch(() => undefined)
    }
  }, [sheetShowing, open])

  // Where the sheet is, for the system mapping (main turns it into physical pixels). Reported when it changes, nothing else.
  useEffect(() => {
    const api = window.wm?.pen
    if (!api || !sheetShowing) return
    let last = ""
    const report = (): void => {
      // (The person's Tablet orientation only, on the camera as on the sheet: a turned picture is not a turned tablet.)
      const payload: SheetReport | null = mappingReport(nativePenTarget(), currentTurns())
      const key = JSON.stringify(payload)
      if (key === last) return
      last = key
      try { api.sheet(payload) } catch { /* main is gone */ }
    }
    report()
    // (A half-second timer is the net under everything below: a pane replaced whole, a surface that moved with its layout.)
    const timer = window.setInterval(report, 400)
    // What is watched, and what is not, is penWatch.ts: the surface's own attributes and the pane's own children (not the document,
    // whose lines are rewritten sixty times a second while it scrolls), and one report per animation frame however many ask.
    const watch = watchPenSurface({
      attributesRoot: document.body,
      paneRoot: document.querySelector('[data-camera="body"]'),
      observer: (callback) => (typeof MutationObserver === "undefined" ? null : new MutationObserver(callback)),
      frame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
      report,
    })
    window.addEventListener("resize", watch.schedule)
    const unsubscribe = subscribeOrientation(watch.schedule)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("resize", watch.schedule)
      unsubscribe()
      watch.stop()
      try { api.sheet(null) } catch { /* main is gone */ }
    }
  }, [sheetShowing])

  // Coming back to the window ends a release.
  useEffect(() => {
    if (!sheetShowing) return
    const focus = (): void => {
      const status = statusRef.current
      if (status && status.released !== null && status.settings.enabled) void open()
    }
    window.addEventListener("focus", focus)
    return () => { window.removeEventListener("focus", focus) }
  }, [sheetShowing, open])

  return { available: store.status?.available ?? false, capturing: store.capturing, status: store.status, selfOpen: store.selfOpen }
}

