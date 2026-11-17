/**
 * The tablet as a source for the video pane: a sheet of paper in place of the camera's picture.
 *
 * Pen and mouse follow the Pen, Eraser and Select tools. Native pen samples arrive as PointerEvents on the same
 * path. Held side buttons override the tool: lower erases complete strokes, upper selects; double taps undo/redo.
 * In Select mode, drag outside the box to select, inside to move selected ink, or at a corner to resize it.
 * The mouse's right button temporarily selects, moves or resizes ink without changing the active tool.
 * The sheet's tools belong to penSettings `sheetTools`, independently of the document's drawing controls.
 *
 * Built to feel like a pad. Pointer events arrive far faster than frames, so every coalesced sample is kept (the
 * stroke's real shape) and the ink canvas is only touched once a frame, and then only for the segments that are
 * NEW. The canvas is `desynchronized` and sized in device pixels, so hairlines are crisp on a high-DPI screen.
 *
 * THE PAPER (tabletPaper.ts) is a second canvas UNDER the ink. It is never ink data: the strokes are fractions of
 * the sheet and know nothing of it. Palm rejection is the notes page's rule (`penNear`).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import { isBoxDrag, type Point, type Rect, type Size } from "@notemind/core"
import { holdBegins, inContact, penLifted, pressAction } from "./penButtons"
import { penNear, penSettings, sheetPressSettings, useSheetTools } from "./penSettings"
import { setTabletUndo, watchSheetPen } from "./tabletFocus"
import {
  boxFromPoints, fitRect, hitBox, moveBox, paintStrokes, resizeBox, SHEET_REF, strokeUnder,
  type BoxHandle, type BoxHit, type InkStroke, type TabletPage,
} from "./tabletPage"
import { backdropImage, backdropRect, paintBackdrop } from "./tabletBackdrop"
import { doubleClickBox } from "./doubleClickBox"
import { colourOfPaper, inkOn, paintPaper, usePaper } from "./tabletPaper"
import { BoxActions, type BoxButtons } from "./BoxActions"
import { elementPoint, elementSize } from "./padCoordinates"
import graphics from "../../graphics-pane.js"
import "./tablet.css"

export interface SurfaceHandle {
  undo(): void
  redo(): void
  clear(): void
  /** Repaint everything (after the page was changed from outside). */
  repaint(): void
  /** The sheet's size on screen, in CSS pixels. */
  size(): Size
  /** A Bring in from the header: what it did is in the NOTE, so the next Ctrl+Z is the note's (as the box row's `leaveFor`). */
  leave(): void
}

interface Props {
  page: TabletPage
  colour: string
  width: number
  /** The dashed box, in FRACTIONS of the sheet. */
  box: Rect | null
  /** The box changed (fractions of the sheet), or was taken away (null). */
  onBox(rect: Rect | null): void
  /** The page changed (a stroke, an erase, an undo): the buttons may need to update. */
  onEdited(): void
  /** A sheet bound to an ink region (regionSheets.ts): the region, in FRACTIONS of the sheet. The rest is shaded and a stroke stops at its edge. */
  frame?: Rect | null
  /** The row of buttons under the box (BoxActions.tsx): Erase, Bring in Writing, Bring in as Drawing Region, Copy Region. */
  buttons?: BoxButtons | null
}

/** How near a stroke the eraser has to be, in points. */
const ERASE_RADIUS = 8
/** A box smaller than this, either way, is a click. */
const MIN_BOX_PX = 8
/** Two clicks this close in time and place are a double click. */
const DOUBLE_MS = 450
const HANDLES: BoxHandle[] = ["nw", "ne", "sw", "se"]

type Gesture = { pointerId: number } & (
  // A stroke and an erase belong to the sheet they began on (a key can open another tab while the pen is down).
  // `out`: on a sheet bound to a drawing region, the pen left the region: the stroke was made up to its edge, and a new one
  // begins where it comes back in (nothing is drawn outside the region, nothing is pinned to its border).
  | { kind: "draw"; stroke: InkStroke; drawn: number; pen: boolean; page: TabletPage; out?: boolean }
  | { kind: "erase"; marked: boolean; page: TabletPage }
  | {
    kind: "box"; mode: "new" | "move" | "resize"
    startPx: Point; start: Point; origin: Rect | null; handle: BoxHandle | null; dragged: boolean; page: TabletPage; strokes: InkStroke[]
    next?: Rect; preview?: { width: number; height: number; paper: string; fixed: HTMLCanvasElement; ink: HTMLCanvasElement }
  }
)

const CURSORS: Record<Exclude<BoxHit, null>, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", inside: "move",
}

export const TabletSurface = forwardRef<SurfaceHandle, Props>(function TabletSurface(
  { page, colour, width, box, onBox, onEdited, frame: regionBox = null, buttons = null }, handle) {
  const host = useRef<HTMLDivElement | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState({ x: 0, y: 0, width: 0, height: 0 })
  /** A backdrop picture finished loading: the paper canvas is painted again. */
  const [backdropTick, setBackdropTick] = useState(0)
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1))
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const backdrop = useRef<HTMLCanvasElement | null>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const size = useRef<Size>({ width: 0, height: 0 })
  const gesture = useRef<Gesture | null>(null)
  const committingStroke = useRef(false)
  /** The box is being dragged, moved or resized: its row of buttons waits until it is let go. */
  const [boxing, setBoxing] = useState(false)
  /** The last click that began and ended in one place, and the box there was when it was made (a double click's first click clears it). */
  const lastClick = useRef<{ time: number; x: number; y: number; box: Rect | null } | null>(null)
  const frame = useRef<number | null>(null)
  const everything = useRef(true)
  // The sheet's OWN Erase / Select (the pen's Erase Tool toggle, the header's Select), never the document toolbar's (penSettings.ts).
  const tools = useSheetTools()
  const paper = usePaper()
  const latest = useRef({ colour, width, onBox, onEdited, page, box, paper, regionBox })
  latest.current = { colour, width, onBox, onEdited, page, box, paper, regionBox }

  const toPixel = useCallback((point: Point): Point =>
    ({ x: point.x * size.current.width, y: point.y * size.current.height }), [])

  /** Pixels per reference unit: a stroke's width is kept in units of the sheet, not of the screen. */
  const unit = () => size.current.width / SHEET_REF
  /** How a stroke's colour looks on this paper. */
  const tint = (hex: string): string => inkOn(latest.current.paper, hex)

  const paint = useCallback(() => {
    frame.current = null
    const element = canvas.current
    if (!element || size.current.width === 0) return
    const ratio = element.ownerDocument.defaultView?.devicePixelRatio || 1
    const w = Math.floor(size.current.width * ratio), h = Math.floor(size.current.height * ratio)
    if (element.width !== w || element.height !== h) {
      element.width = w
      element.height = h
      everything.current = true
    }
    context.current ??= element.getContext("2d", { desynchronized: true })
    const ctx = context.current
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const g = gesture.current
    if (g?.kind === "box" && g.dragged && g.origin && g.next) {
      const paperKey = JSON.stringify(latest.current.paper)
      if (!g.preview || g.preview.width !== w || g.preview.height !== h || g.preview.paper !== paperKey) {
        const fixed = element.ownerDocument.createElement("canvas"), ink = element.ownerDocument.createElement("canvas")
        fixed.width = ink.width = w; fixed.height = ink.height = h
        const fixedContext = fixed.getContext("2d")!, inkContext = ink.getContext("2d")!
        fixedContext.scale(ratio, ratio); inkContext.scale(ratio, ratio)
        const chosen: InkStroke[] = [], remaining: InkStroke[] = []
        for (const stroke of g.strokes) (graphics.selected(stroke, g.origin) ? chosen : remaining).push(stroke)
        paintStrokes(fixedContext, remaining, toPixel, unit(), undefined, 0, tint)
        paintStrokes(inkContext, chosen, toPixel, unit(), undefined, 0, tint)
        g.preview = { width: w, height: h, paper: paperKey, fixed, ink }
      }
      ctx.clearRect(0, 0, size.current.width, size.current.height)
      ctx.drawImage(g.preview.fixed, 0, 0, size.current.width, size.current.height)
      const sx = g.next.width / g.origin.width, sy = g.next.height / g.origin.height
      ctx.save();ctx.translate((g.next.x - g.origin.x * sx) * size.current.width, (g.next.y - g.origin.y * sy) * size.current.height);ctx.scale(sx, sy)
      ctx.drawImage(g.preview.ink, 0, 0, size.current.width, size.current.height);ctx.restore()
      return
    }
    if (everything.current) {
      everything.current = false
      ctx.clearRect(0, 0, element.width, element.height)
      paintStrokes(ctx, latest.current.page.strokes, toPixel, unit(), undefined, 0, tint)
      // A stroke under the pen is repainted whole after a resize or an erase.
      if (g?.kind === "draw") {
        paintStrokes(ctx, [g.stroke], toPixel, unit(), undefined, 0, tint)
        g.drawn = g.stroke.points.length
      }
      return
    }
    if (g?.kind === "draw" && g.stroke.points.length > g.drawn) {
      // Only the segments that are new since the last frame.
      paintStrokes(ctx, [g.stroke], toPixel, unit(), undefined, g.drawn, tint)
      g.drawn = g.stroke.points.length
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tint` reads the latest paper through the ref
  }, [toPixel])

  const schedule = useCallback((full = false) => {
    if (full) everything.current = true
    if (frame.current === null) frame.current = requestAnimationFrame(paint)
  }, [paint])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const view = element.ownerDocument.defaultView ?? window
    const measure = () => {
      const rect = elementSize(element)
      // The sheet has the screen's shape; the pane it sits in need not, so it is
      // fitted inside it (letterboxed) and never stretched.
      const box = fitRect({ width: rect.width, height: rect.height }, latest.current.page.aspect)
      size.current = { width: box.width, height: box.height }
      setFit((was) => (was.x === box.x && was.y === box.y && was.width === box.width && was.height === box.height ? was : box))
      setDpr(view.devicePixelRatio || 1)
      schedule(true)
    }
    measure()
    // The sheet's shape follows the tablet's orientation.
    const unlisten = latest.current.page.onChange(() => {
      if (committingStroke.current) return
      const r = elementSize(element)
      const next = fitRect({ width: r.width, height: r.height }, latest.current.page.aspect)
      if (Math.abs(next.width - size.current.width) > 0.5 || Math.abs(next.height - size.current.height) > 0.5) measure()
      else schedule(true)
    })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The display's scale can change under the sheet (150% on one monitor, 100% on the next, a
    // zoom): the canvases are in device pixels, so they are measured again.
    view.addEventListener("resize", measure)
    let ratio: MediaQueryList | null = null
    const watchRatio = () => {
      ratio?.removeEventListener("change", onRatio)
      ratio = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`)
      ratio.addEventListener("change", onRatio)
    }
    const onRatio = () => { measure(); watchRatio() }
    watchRatio()
    return () => {
      unlisten()
      observer.disconnect()
      view.removeEventListener("resize", measure)
      ratio?.removeEventListener("change", onRatio)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    // Another sheet (a tab): listen to it and paint it whole. Its size is the same (every sheet has the tablet's shape).
  }, [schedule, page])

  // The paper, on its own canvas under the ink: painted when the paper, the sheet's size or the display's scale changes (never per stroke).
  useLayoutEffect(() => {
    const element = backdrop.current
    if (!element || fit.width <= 0 || fit.height <= 0) return
    const w = Math.max(1, Math.round(fit.width * dpr)), h = Math.max(1, Math.round(fit.height * dpr))
    if (element.width !== w || element.height !== h) { element.width = w; element.height = h }
    const ctx = element.getContext("2d")
    if (!ctx) return
    const units: Size = { width: SHEET_REF, height: SHEET_REF * fit.height / fit.width }
    paintPaper(ctx, paper, units, { x: 0, y: 0, ...units }, { width: w, height: h }, dpr)
    // A picture sent here by Edit with Tablet is under the ink, on the paper (tabletBackdrop.ts).
    const under = page.backdrop ? backdropImage(page.backdrop, () => setBackdropTick((n) => n + 1)) : null
    if (under) paintBackdrop(ctx, under, units, { x: 0, y: 0, ...units }, { width: w, height: h })
  }, [paper, page, backdropTick, fit.width, fit.height, dpr])
  // The ink's look follows the paper (dark paper lifts the default ink).
  useEffect(() => { schedule(true) }, [paper.colour, schedule])

  // Undo and redo, for the keys and for the buttons.
  const hovered = useRef(false)
  const act = useCallback((which: "undo" | "redo"): boolean => {
    const p = latest.current.page
    const did = which === "undo" ? p.undo() : p.redo()
    if (did) { schedule(true); latest.current.onEdited() }
    return did
  }, [schedule])

  // The pen over the sheet's side of the pane (or last there): its double taps and ExpressKeys toggle the sheet's tools.
  useEffect(() => {
    const element = host.current
    return element ? watchSheetPen(element.closest(".camera") ?? element) : undefined
  }, [])

  /**
   * A Bring in from the box's row: what it did is in the NOTE, so the next Ctrl+Z is the note's (the row goes with the
   * box, and the sheet under the mouse is not "the pen over the sheet" until the pointer moves onto it again).
   */
  const leave = (): void => {
    hovered.current = false
    // The row goes from under a still pointer, and the browser then says it entered the sheet: that does not count.
    quietAt.current = lastAt.current
    if (wrap.current && wrap.current.contains(wrap.current.ownerDocument.activeElement)) wrap.current.blur()
  }
  const leaveFor = async (action: () => void | Promise<void>): Promise<void> => {
    leave()
    await action()
  }
  /** The last place a pointer was seen over the host (the sheet or the row), in client px. */
  const lastAt = useRef<Point | null>(null)
  /** Where the pointer was when a Bring in left the sheet: "entering" the sheet there is not the pointer moving onto it. */
  const quietAt = useRef<Point | null>(null)
  const enter = (event: { clientX: number; clientY: number }) => {
    const quiet = quietAt.current
    if (quiet && Math.hypot(event.clientX - quiet.x, event.clientY - quiet.y) < 3) return
    quietAt.current = null
    hovered.current = true
  }

  useEffect(() => {
    setTabletUndo((which, byPen) => {
      const focused = !byPen && wrap.current !== null && wrap.current.contains(wrap.current.ownerDocument.activeElement)
      return (hovered.current || focused) ? act(which) : false
    })
    return () => setTabletUndo(null)
  }, [act])

  // Esc takes the box away (not from a text field, which keeps its Esc). It goes first and stops there, so it
  // does not also let go of the pen feed.
  const hasBox = box !== null
  useEffect(() => {
    if (!hasBox) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const active = wrap.current?.ownerDocument.activeElement as HTMLElement | null
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return
      event.preventDefault()
      event.stopPropagation()
      latest.current.onBox(null)
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [hasBox])

  useImperativeHandle(handle, () => ({
    undo: () => { act("undo") },
    redo: () => { act("redo") },
    clear: () => { latest.current.page.clear(); schedule(true); latest.current.onEdited() },
    repaint: () => schedule(true),
    size: () => size.current,
    leave,
  }), [act, schedule])

  /** `unit`: on the sheet (on a bound sheet, at the region's edge); `raw`: where it really is; `inside`: in the region (always, on a plain sheet). */
  const at = (event: { clientX: number; clientY: number }): { px: Point; unit: Point; raw: Point; inside: boolean } => {
    const rect = elementPoint(wrap.current!, event)
    const x = rect.x, y = rect.y
    // A stroke that strays past the edge (the pen is captured) stops at the sheet's edge.
    const clamp = (value: number, from = 0, to = 1) => Math.min(to, Math.max(from, value))
    // On a sheet bound to a region, at the region's edge.
    const f = latest.current.regionBox ?? { x: 0, y: 0, width: 1, height: 1 }
    const raw = { x: x / Math.max(1, rect.width), y: y / Math.max(1, rect.height) }
    const e = 1e-6
    return {
      px: { x, y },
      unit: { x: clamp(raw.x, f.x, f.x + f.width), y: clamp(raw.y, f.y, f.y + f.height) },
      raw,
      inside: !latest.current.regionBox
        || (raw.x >= f.x - e && raw.x <= f.x + f.width + e && raw.y >= f.y - e && raw.y <= f.y + f.height + e),
    }
  }

  const eraseAt = (g: Extract<Gesture, { kind: "erase" }>, point: Point) => {
    const p = g.page
    const index = strokeUnder(p.strokes, point, size.current, ERASE_RADIUS, size.current.width / SHEET_REF)
    if (index < 0) return
    if (!g.marked) { p.mark(); g.marked = true }
    p.removeAt(index)
    schedule(true)
  }

  /** The pen touched the sheet at its last event: a hold begins only where a touch begins (penButtons.holdBegins). */
  const touching = useRef(false)

  const down = (event: PointerEvent) => {
    if (event.pointerType === "touch" && penNear()) { event.preventDefault(); return }
    const pen = event.pointerType === "pen"
    if (pen) touching.current = inContact(event)
    if (gesture.current && gesture.current.pointerId !== event.pointerId) return
    if (!pen && event.button !== 0 && !(event.pointerType === "mouse" && event.button === 2)) return
    event.preventDefault()
    let action = pressAction(event, sheetPressSettings())
    // Nothing to do here: a side button pressed in the air (its double tap is the runtime's, penActions.ts), or Pan.
    if (action === "ignore" || action === "pan") return
    wrap.current?.focus({ preventScroll: true })
    // Keep the gesture when the pointer strays past the edge (a synthetic event has no pointer to capture: the feed keeps the target itself).
    try { wrap.current?.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
    // Pen and mouse both follow the active drawing tool.
    const { px, unit: point, raw, inside } = at(event)
    // A bound sheet: the shaded margin round the region takes no stroke.
    if (action === "draw" && !inside) return
    if (action === "erase") {
      const g: Gesture = { kind: "erase", pointerId: event.pointerId, marked: false, page: latest.current.page }
      gesture.current = g
      eraseAt(g, latest.current.regionBox ? raw : point)
    } else if (action === "select") {
      const current = latest.current.box
      const hit = current ? hitBox(current, point, size.current) : null
      const base = { kind: "box" as const, pointerId: event.pointerId, startPx: px, start: point, dragged: false, page: latest.current.page, strokes: latest.current.page.strokes }
      if (current && hit === "inside") gesture.current = { ...base, mode: "move", origin: current, handle: null }
      else if (current && hit && hit !== "inside") gesture.current = { ...base, mode: "resize", origin: current, handle: hit }
      else gesture.current = { ...base, mode: "new", origin: null, handle: null }
    } else {
      const pressure = event.pressure > 0 ? event.pressure : 0.5
      gesture.current = {
        kind: "draw", pointerId: event.pointerId, drawn: 0, pen, page: latest.current.page,
        stroke: {
          colorHex: latest.current.colour,
          width: latest.current.width * SHEET_REF / Math.max(1, size.current.width),
          points: [point],
          ...(pen && penSettings().pressure ? { pressures: [pressure] } : {}),
        },
      }
      schedule()
    }
  }

  const move = (event: PointerEvent) => {
    const g = gesture.current
    const was = touching.current
    if (event.pointerType === "pen") touching.current = inContact(event)
    // The pen may keep hovering while the mouse works through the sidebar mirror.
    // Only the pointer that began a gesture may move or finish it.
    if (g && g.pointerId !== event.pointerId) return
    if (event.pointerType === "pen") {
      // A side button held in the air, then the pen touches: its hold begins here (this touch is a pointermove).
      if (!g && holdBegins(was, event)) { down(event); return }
      // A pen gesture lasts while the pen touches: lifting it with a side button still held ends it.
      if (g && penLifted(event)) { up(event); return }
    }
    if (!g) {
      // The mouse over the box says what a drag would do.
      if (event.pointerType !== "pen" && wrap.current) {
        const current = latest.current.box
        const hit = current ? hitBox(current, at(event).unit, size.current) : null
        wrap.current.style.cursor = tools.eraser ? "crosshair" : hit ? CURSORS[hit] : "crosshair"
      }
      return
    }
    // A pen reports far more samples than frames: the coalesced ones are the real stroke.
    const samples = event.getCoalescedEvents?.() ?? []
    const all = samples.length > 0 ? samples : [event]
    if (g.kind === "draw") {
      for (const sample of all) {
        const here = at(sample)
        if (!here.inside && g.out) continue
        if (here.inside && g.out) {
          // Back in the region: a new stroke begins here.
          const { points: _points, pressures, ...rest } = g.stroke
          g.stroke = { ...rest, points: [], ...(pressures ? { pressures: [] } : {}) }
          g.drawn = 0
          g.out = false
        }
        g.stroke.points.push(here.unit)
        g.stroke.pressures?.push(sample.pressure > 0 ? sample.pressure : 0.5)
        if (!here.inside) {
          // Out of the region: the stroke ends at its edge, and is made now.
          g.out = true
          paint()
          committingStroke.current = true
          try { g.page.add(g.stroke) } finally { committingStroke.current = false }
          schedule(true)
          latest.current.onEdited()
        }
      }
      schedule()
    } else if (g.kind === "erase") {
      for (const sample of all) { const here = at(sample); eraseAt(g, latest.current.regionBox ? here.raw : here.unit) }
    } else {
      const here = at(event)
      if (!g.dragged && !isBoxDrag(here.px.x - g.startPx.x, here.px.y - g.startPx.y)) return
      if (!g.dragged) setBoxing(true)
      g.dragged = true
      if (g.mode === "move" || g.mode === "resize") {
        const next = g.mode === "move" ? moveBox(g.origin!, here.unit.x - g.start.x, here.unit.y - g.start.y) : resizeBox(g.origin!, g.handle!, here.unit, size.current, MIN_BOX_PX)
        g.next = next
        latest.current.onBox(next)
        schedule(true)
      }
      else latest.current.onBox(boxFromPoints(g.start, here.unit))
    }
  }

  const up = (event: PointerEvent) => {
    if (event.pointerType === "pen" && (event.type === "pointerup" || event.type === "pointercancel")) touching.current = false
    const g = gesture.current
    if (g && g.pointerId !== event.pointerId) return
    // The last samples are painted now, not left to a frame that will find no stroke.
    if (g?.kind === "draw") paint()
    gesture.current = null
    for (const owner of [wrap.current, host.current]) {
      try { if (owner?.hasPointerCapture(event.pointerId)) owner.releasePointerCapture(event.pointerId) } catch { /* gone */ }
    }
    if (!g) return
    if (g.kind === "draw") {
      // Already made where it left a bound sheet's region.
      if (g.out) return
      committingStroke.current = true
      try { g.page.add(g.stroke) } finally { committingStroke.current = false }
      // Begun on a sheet that is no longer open: it went to that sheet, and this one is painted as it is.
      if (g.page !== latest.current.page) schedule(true)
      latest.current.onEdited()
    } else if (g.kind === "erase") {
      if (g.marked) latest.current.onEdited()
    } else if (g.dragged) {
      if (g.mode === "move" || g.mode === "resize") {
        if (event.type === "pointercancel") latest.current.onBox(g.origin)
        else if (g.next) { g.page.replace(graphics.transform(g.strokes, g.origin!, g.next)); latest.current.onEdited() }
        schedule(true)
      }
      setBoxing(false)
      lastClick.current = null
      if (g.mode === "new") {
        const made = boxFromPoints(g.start, at(event).unit)
        // Under 8 px either way is a click, not a box.
        latest.current.onBox(made.width * size.current.width > MIN_BOX_PX && made.height * size.current.height > MIN_BOX_PX ? made : null)
      }
    } else if (g.mode === "new") {
      // The Mac's rule: one click outside the box takes it away, two take the picture under the ink (else the whole sheet).
      if (!clicked(event)) latest.current.onBox(null)
    } else if (g.mode === "move") {
      // A click inside the box that did not move it: two of them are a double click too (the next size of box).
      clicked(event)
    }
  }

  /**
   * A click that ended where it began. The second of two close together is a DOUBLE click: it makes the box (the picture under the ink
   * first, then the whole sheet, then the picture: doubleClickBox.ts) and answers true. Otherwise it is remembered, with the box there was.
   */
  const clicked = (event: PointerEvent): boolean => {
    const point = at(event).px
    const before = lastClick.current
    if (before && event.timeStamp - before.time < DOUBLE_MS && Math.hypot(point.x - before.x, point.y - before.y) < 8) {
      lastClick.current = null
      latest.current.onBox(doubleClickBox(before.box, pictureRect()))
      return true
    }
    lastClick.current = { time: event.timeStamp, x: point.x, y: point.y, box: latest.current.box }
    return false
  }

  /** Where the picture under the ink is on the sheet, in fractions of it. Null with none (or not loaded yet). */
  const pictureRect = (): Rect | null => {
    const sheet = size.current
    if (!(sheet.width > 0 && sheet.height > 0)) return null
    const aspect = sheet.width / sheet.height
    const current = latest.current.page
    if (!current.backdrop) return null
    const image = backdropImage(current.backdrop, () => undefined)
    return image && image.naturalWidth > 0 && image.naturalHeight > 0 ? backdropRect(aspect, image.naturalWidth / image.naturalHeight) : null
  }

  const erasing = tools.eraser
  return (
    <div className="tablet-host" ref={host} data-tablet="host"
         onPointerMove={(event) => { lastAt.current = { x: event.clientX, y: event.clientY } }}
         onPointerDown={(event) => { if (event.target === host.current) latest.current.onBox(null) }}>
      <div className="tablet" ref={wrap} tabIndex={0} data-tablet="surface" data-paper={paper.kind} data-paper-colour={paper.colour}
           style={{ cursor: erasing ? "crosshair" : "crosshair", left: fit.x, top: fit.y, width: fit.width, height: fit.height,
             backgroundColor: colourOfPaper(paper.colour).paper }}
           onPointerEnter={(event) => enter(event)}
           onPointerLeave={() => { hovered.current = false }}
           onPointerDown={(event: React.PointerEvent) => { quietAt.current = null; hovered.current = true; down(event.nativeEvent) }}
           onPointerMove={(event: React.PointerEvent) => { if (!hovered.current) enter(event); move(event.nativeEvent) }}
           onPointerUp={(event: React.PointerEvent) => up(event.nativeEvent)}
           onPointerCancel={(event: React.PointerEvent) => up(event.nativeEvent)}
           onContextMenu={(event) => event.preventDefault()}>
        {/* The ink is first in the tree (what reads "the sheet's canvas" reads the ink); the paper sits under it by z-order. */}
        <canvas ref={canvas} className="ink" data-layer="ink" style={{ width: "100%", height: "100%" }} />
        <canvas ref={backdrop} className="paper" data-layer="paper" style={{ width: "100%", height: "100%" }} />
        {regionBox && (
          <div className="box-clip">
            <div className="region-frame" data-tablet="region-frame" style={{
              left: `${regionBox.x * 100}%`, top: `${regionBox.y * 100}%`, width: `${regionBox.width * 100}%`, height: `${regionBox.height * 100}%`,
            }} />
          </div>
        )}
        {box && (
          <div className="box-clip">
            <div className="box" data-tablet="box" style={{
              left: `${box.x * 100}%`, top: `${box.y * 100}%`,
              width: `${box.width * 100}%`, height: `${box.height * 100}%`,
            }}>
              {HANDLES.map((name) => <span key={name} className="handle" data-handle={name} />)}
            </div>
          </div>
        )}
      </div>
      {box && buttons && !boxing && fit.width > 0 && (
        // Beside the sheet's element, not in it: a click here is the button's, never a box gesture (BoxActions.tsx).
        <BoxActions box={box} sheet={fit} bringOff={buttons.bringOff}
                    erase={async () => {
                      await buttons.erase()
                      // Ctrl+Z next takes the erase back: the sheet has the keys again.
                      wrap.current?.focus({ preventScroll: true })
                    }}
                    bring={() => leaveFor(buttons.bring)}
                    picture={() => leaveFor(buttons.picture)}
                    // Nothing leaves the sheet: the copy is on the clipboard, not in the note.
                    copy={() => buttons.copy()} />
      )}
    </div>
  )
})

