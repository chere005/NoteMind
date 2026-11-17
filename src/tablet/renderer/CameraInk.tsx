/**
 * THE PEN WRITES ON THE CAMERA'S PICTURE (Sean, 2026-10-25: "if a document scanner is on, the wacom should also be able to write on top
 * of the image.. this isn't a separate workflow and needs no buttons"). One canvas over the viewfinder, under the box and Find Page's
 * corners: the PEN draws on it (and rubs out with its eraser button or the sheet's Erase Tool, as on the sheet), the MOUSE never draws
 * or rubs out - its presses go on to the pane's box and zoom gestures under it, so the camera view works exactly as before for the mouse.
 *
 * The ink is the open camera tab's (cameraInkPages.ts: kept as fractions of the upright picture, cameraInkGeometry.ts), drawn where the picture
 * is shown and through the zoom, so it stays on the paper whatever the pane does. The canvas is outside the zoom's transform and painted
 * at the screen's own pixels (crisp at any zoom), all again when the view changes and only the new segments while the pen moves.
 *
 * The native Wacom feed (usePenFeed.ts, penFeed.ts) maps the whole tablet onto a TABLET-SHAPED area round the picture as it is shown,
 * zoom included, inside the viewfinder (cameraInkGeometry.ts `inkPenArea`, published here as `data-pen-rect`), turned by the person's
 * Tablet orientation only, exactly as the Tablet sheet is (Sean, 2026-10-26: "the tablet orientation doesn't match in the live camera view
 * and is wrong compared to the normal tablet view"): a circle on the tablet is a circle here, and a turned picture does not turn the pen.
 * Those events always reach this canvas; they must never land in the document beside it. Without a native feed, the window's own pen
 * events write where the pen is over the picture. Both paths use the same handlers below, so they agree point for point: a press off
 * the picture (the dark bars, the area's margin round it) writes nothing, and a stroke that strays off it stops at its edge, as a stroke
 * that strays past the sheet's edge stops there. The canvas over a playing video is not desynchronized (it can flicker over video).
 *
 * THE PEN TIP ALWAYS WRITES: every press of the pen on the picture is this layer's, and it does not reach the pane's box (the box's resize
 * handles, like Find Page's corner dots, take no pointer at all, so the pen writes straight across them, and only the mouse resizes by
 * them). Three things are the pane's, and this layer hands each one over (the pane starts the gesture at that point, with that pointer, as
 * for the mouse; the pen's later moves and its lift bubble to the pane's own handlers):
 *  - the pen's SELECT (a held side button, or the Select Tool toggle) pulls a box as the mouse does (`onPenSelect`), whether the press
 *    arrives as a pointerdown or - the button pressed in the air first - as the pointermove of the pen touching (penButtons.ts holdBegins);
 *  - a press of the pen's tip or Select ON a Find Page corner's dot takes that corner (`onPenCorner`: the pane says whether the press is on a
 *    dot, within 9 points of its centre, cameraHits.ts), so a pen-only person can drag the corners the toast and footer name; a press
 *    anywhere else, writing near a page corner included, writes;
 *  - while the ZOOM IS ARMED (Zoom, Zoom to a Box) every press of the pen is the zoom box's, as it was before this layer: none of it is ink.
 * While a stroke is being written (or rubbed out) the pane is told (`onDrawing`), so the row under the selection can keep out of the pen's
 * way until the pen lifts.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from "react"
import { zoomScale, type Point } from "@notemind/core"
import type { Turns } from "../shared/orientation"
import { subscribeOrientation } from "./orientation"
import { elementPoint } from "./padCoordinates"
import { holdBegins, inContact, penLifted, pressAction } from "./penButtons"
import { penNear, penSettings, sheetPressSettings, useSheetTools } from "./penSettings"
import { setTabletUndo, watchSheetPen } from "./tabletFocus"
import { paintStrokes, strokeUnder, type InkStroke, type TabletPage } from "./tabletPage"
import { currentSheetAspect } from "./tabletSheets"
import { inkPenArea, inkPictureRect, inkToScreen, inkUnit, inkWidth, onPicture, screenToInk, type InkView } from "./cameraInkGeometry"

export interface CameraInkHandle {
  /** Finish the contact before changing the paper's coordinate frame (a turn). */
  finish(): void
  undo(): boolean
  redo(): boolean
  clear(): void
  /** A take was made: the next Ctrl+Z is the note's (the pointer is over the row or the header, not "back on the picture"). */
  leave(): void
}

interface Props {
  /** The camera tab's identity: a native contact ends before it can cross into another tab. */
  targetKey: string
  /**
   * The picture's quarter turns. A turn is another frame for the paper, so a native contact ends at one (it is in `data-pen-key`); it NEVER
   * turns the pen, which moves on the screen, where the picture is already upright (only the Tablet orientation turns the tablet).
   */
  turns: Turns
  /** The open tab's ink (null: nothing to write on). */
  page: TabletPage | null
  view: InkView
  /** A picture is showing: the pen writes only then. */
  on: boolean
  colour: string
  /** The pen's width in screen points, as on the sheet. */
  width: number
  onEdited(): void
  /** The pen is down on the picture writing or rubbing out (true) and has lifted (false): the selection's row is not shown while it is. */
  onDrawing(active: boolean): void
  /**
   * The zoom is armed (Zoom, Zoom to a Box): the pen drags the zoom box as the mouse does, so no press of the pen is ink and every one goes
   * on to the pane (which accepts a pen's press then).
   */
  zooming: boolean
  /**
   * The pen's Select pressed on the picture - as a pointerdown, or as the pointermove of the pen touching with its button already held:
   * the pane starts its box drag at this point with this pointer, the state the mouse's press sets. The pen's later moves and its lift reach
   * the pane's own handlers.
   */
  onPenSelect(event: React.PointerEvent): void
  /**
   * A press of the pen that would write (or select) at this point: the pane takes the corner of Find Page that is ON the press and answers
   * true (this layer then writes nothing), or answers false for a press that is on no corner's dot.
   */
  onPenCorner(event: React.PointerEvent): boolean
}

/** How near a stroke the eraser has to be, in screen points. */
const ERASE_RADIUS = 8

type Gesture =
  | { kind: "draw"; pointerId: number; stroke: InkStroke; drawn: number; page: TabletPage }
  | { kind: "erase"; pointerId: number; marked: boolean; page: TabletPage }

export const CameraInk = forwardRef<CameraInkHandle, Props>(function CameraInk(
  { targetKey, turns, page, view, on, colour, width, onEdited, onDrawing, zooming, onPenSelect, onPenCorner }, handle,
) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const everything = useRef(true)
  const hovered = useRef(false)
  const touching = useRef(false)
  const tools = useSheetTools()
  /** The Tablet sheet's shape (the tablet's, turned by its orientation): the native pen's area here has it too. */
  const sheetAspect = useSyncExternalStore(subscribeOrientation, currentSheetAspect)
  const latest = useRef({ page, view, on, colour, width, onEdited, onDrawing, zooming, onPenSelect, onPenCorner })
  latest.current = { page, view, on, colour, width, onEdited, onDrawing, zooming, onPenSelect, onPenCorner }

  const toPixel = useCallback((point: Point): Point => inkToScreen(point, latest.current.view), [])

  const paint = useCallback(() => {
    frame.current = null
    const element = canvas.current
    const { view: v, page: p } = latest.current
    if (!element) return
    const ratio = element.ownerDocument.defaultView?.devicePixelRatio || 1
    const w = Math.max(1, Math.floor(v.size.width * ratio)), h = Math.max(1, Math.floor(v.size.height * ratio))
    if (element.width !== w || element.height !== h) { element.width = w; element.height = h; everything.current = true }
    context.current ??= element.getContext("2d", { desynchronized: false })
    const ctx = context.current
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const unit = inkUnit(v)
    const g = gesture.current
    if (everything.current) {
      everything.current = false
      ctx.clearRect(0, 0, v.size.width, v.size.height)
      const picture=inkPictureRect(v);ctx.save();ctx.beginPath();ctx.rect(picture.x,picture.y,picture.width,picture.height);ctx.clip()
      if (p && latest.current.on) paintStrokes(ctx, p.strokes, toPixel, unit)
      if (g?.kind === "draw") { paintStrokes(ctx, [g.stroke], toPixel, unit); g.drawn = g.stroke.points.length }
      ctx.restore()
      return
    }
    if (g?.kind === "draw" && g.stroke.points.length > g.drawn) {
      const picture=inkPictureRect(v);ctx.save();ctx.beginPath();ctx.rect(picture.x,picture.y,picture.width,picture.height);ctx.clip()
      paintStrokes(ctx, [g.stroke], toPixel, unit, undefined, g.drawn)
      ctx.restore()
      g.drawn = g.stroke.points.length
    }
  }, [toPixel])

  const schedule = useCallback((full = false) => {
    if (full) everything.current = true
    if (frame.current === null) frame.current = requestAnimationFrame(paint)
  }, [paint])

  const finish = useCallback(() => {
    touching.current = false
    const g = gesture.current
    if (!g) return
    if (g.kind === "draw") paint()
    gesture.current = null
    latest.current.onDrawing(false)
    if (g.kind === "draw") g.page.add(g.stroke)
    if (g.kind === "draw" || g.marked) latest.current.onEdited()
  }, [paint])

  // Everything again when the view changes (zoom, the pane's size, a turn, another tab) or the ink does (undo, a turn, another window).
  const viewKey = `${view.shown.x},${view.shown.y},${view.shown.width},${view.shown.height}|${view.zoom ? `${view.zoom.x},${view.zoom.y},${view.zoom.width},${view.zoom.height}` : ""}|${view.size.width},${view.size.height}|${view.turns||0}|${view.clip?`${view.clip.x},${view.clip.y},${view.clip.width},${view.clip.height}`:''}|${on}`
  useLayoutEffect(() => {
    if (gesture.current && (gesture.current.page !== page || !on)) finish()
    schedule(true)
  }, [viewKey, page, on, finish, schedule])
  useEffect(() => page?.onChange(() => schedule(true)), [page, schedule])
  useEffect(() => {
    const onResize = () => schedule(true)
    const view = canvas.current?.ownerDocument.defaultView ?? window
    view.addEventListener("resize", onResize)
    return () => {
      view.removeEventListener("resize", onResize)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      // Keep a contact written before the pane was put away, on its own page.
      finish()
    }
  }, [finish, schedule])

  // Undo and redo of the tab's ink: Ctrl+Z with the pointer over the picture, and the pen's double tap (penActions.ts, tabletFocus.ts).
  const act = useCallback((which: "undo" | "redo"): boolean => {
    const p = latest.current.page
    if (!p) return false
    const did = which === "undo" ? p.undo() : p.redo()
    if (did) { schedule(true); latest.current.onEdited() }
    return did
  }, [schedule])
  useEffect(() => {
    if (!on) return
    setTabletUndo((which) => (hovered.current ? act(which) : false))
    return () => setTabletUndo(null)
  }, [act, on])
  /** Where the pointer was when a take left the picture: "entering" it again there is not the pointer coming back. */
  const quietAt = useRef<Point | null>(null)
  const lastAt = useRef<Point | null>(null)
  // The pen over the picture: its double taps and ExpressKeys toggle the sheet's own tools (the Erase Tool rubs out the ink here too).
  useEffect(() => {
    if (!on) return
    const element = canvas.current
    return element ? watchSheetPen(element.closest(".camera-workspace") ?? element) : undefined
  }, [on])

  useImperativeHandle(handle, () => ({
    finish,
    undo: () => act("undo"),
    redo: () => act("redo"),
    clear: () => { const p = latest.current.page; if (p && p.strokes.length > 0) { p.clear(); schedule(true); latest.current.onEdited() } },
    leave: () => { hovered.current = false; quietAt.current = lastAt.current },
  }), [act, finish, schedule])

  const at = (event: { clientX: number; clientY: number }): Point => {
    const point = elementPoint(canvas.current!, event)
    return { x: point.x, y: point.y }
  }

  const eraseAt = (g: Extract<Gesture, { kind: "erase" }>, screen: Point) => {
    const v = latest.current.view
    // (the picture as it is on screen, zoom included: the radius is in screen points)
    const scale = v.zoom ? zoomScale(v.zoom, v.size) : 1
    const shownSize = { width: (v.turns&&v.turns%2?v.shown.height:v.shown.width) * scale, height: (v.turns&&v.turns%2?v.shown.width:v.shown.height) * scale }
    const index = strokeUnder(g.page.strokes, screenToInk(screen, v), shownSize, ERASE_RADIUS, inkUnit(v))
    if (index < 0) return
    if (!g.marked) { g.page.mark(); g.marked = true }
    g.page.removeAt(index)
    schedule(true)
  }

  const down = (event: React.PointerEvent) => {
    const { page: p, on: showing } = latest.current
    if (!p || !showing) return
    if (event.pointerType === "touch") {
      // A palm on the screen while the pen is near is not a gesture at all.
      if (penNear()) { event.preventDefault(); event.stopPropagation() }
      return
    }
    const pen = event.pointerType === "pen"
    if (pen) touching.current = inContact(event.nativeEvent)
    if (gesture.current && gesture.current.pointerId !== event.pointerId) return
    // ZOOM ARMED: the pen drags the zoom box as it did before the pane had ink - nothing here is this layer's, no press is a stroke.
    if (latest.current.zooming) return
    const action = pressAction(event.nativeEvent, sheetPressSettings())
    // THE SPLIT: the mouse never writes or rubs out here (its press goes on to the box under this layer).
    if (!pen) return
    // A press ON one of Find Page's corner dots takes that corner (the tip, or the Select that would otherwise box from there); anywhere
    // else the tip writes. The eraser end and the Erase Tool rub out wherever they are.
    if ((action === "draw" || action === "select") && latest.current.onPenCorner(event)) return
    // The pen's Select (a held button, the Select Tool) pulls the box as the mouse does: the pane starts it here, now. This may be the
    // pointermove of the pen touching with its button already held (move() below): the pane's pictureDown never sees that one.
    if (action === "select") { latest.current.onPenSelect(event); return }
    // Anything else of the pen's is this layer's, even when it does nothing (a button pressed in the air, Pan, a press off the picture):
    // the box under it is the mouse's.
    event.preventDefault()
    event.stopPropagation()
    if (action === "ignore" || action === "pan") return
    const point = at(event)
    if (action === "draw" && !onPicture(point, latest.current.view)) return
    try { canvas.current?.setPointerCapture(event.pointerId) } catch { /* the pointer is gone */ }
    if (action === "erase") {
      const g: Gesture = { kind: "erase", pointerId: event.pointerId, marked: false, page: p }
      gesture.current = g
      latest.current.onDrawing(true)
      eraseAt(g, point)
      return
    }
    const pressure = event.pressure > 0 ? event.pressure : 0.5
    gesture.current = {
      kind: "draw", pointerId: event.pointerId, drawn: 0, page: p,
      stroke: {
        colorHex: latest.current.colour,
        width: inkWidth(latest.current.width, latest.current.view),
        points: [screenToInk(point, latest.current.view)],
        ...(penSettings().pressure ? { pressures: [pressure] } : {}),
      },
    }
    latest.current.onDrawing(true)
    schedule()
  }

  const move = (event: React.PointerEvent) => {
    lastAt.current = { x: event.clientX, y: event.clientY }
    const g = gesture.current
    const was = touching.current
    if (event.pointerType === "pen") touching.current = inContact(event.nativeEvent)
    if (g && g.pointerId !== event.pointerId) return
    if (event.pointerType === "pen") {
      // A side button held in the air, then the pen touches: its hold begins here (this touch is a pointermove).
      if (!g && holdBegins(was, event.nativeEvent)) { down(event); return }
      if (g && penLifted(event.nativeEvent)) { up(event); return }
    }
    if (!g) return
    event.stopPropagation()
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
    const all = samples.length > 0 ? samples : [event.nativeEvent]
    if (g.kind === "erase") { for (const sample of all) eraseAt(g, at(sample)); return }
    for (const sample of all) {
      g.stroke.points.push(screenToInk(at(sample), latest.current.view))
      g.stroke.pressures?.push(sample.pressure > 0 ? sample.pressure : 0.5)
    }
    schedule()
  }

  const up = (event: React.PointerEvent) => {
    if (event.pointerType === "pen") touching.current = false
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    event.stopPropagation()
    try { if (canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId) } catch { /* gone */ }
    finish()
  }

  const picture = inkPictureRect(view)
  // Where the whole tablet writes: the sheet's shape (the tablet, turned by its orientation) round the picture as shown.
  const area = inkPenArea(view, sheetAspect)
  return (
    <>
      <canvas ref={canvas} className="camera-ink" data-camera="ink" aria-hidden
              data-pen-surface={on && page ? "camera" : undefined} data-pen-key={`${targetKey}@${turns}`}
              data-pen-rect={`${area.x},${area.y},${area.width},${area.height}`}
              data-pen-picture={`${picture.x},${picture.y},${picture.width},${picture.height}`}
              style={{ width: view.size.width, height: view.size.height, cursor: tools.eraser && !zooming ? "crosshair" : undefined }}
              onPointerEnter={(event) => {
                const quiet = quietAt.current
                if (quiet && Math.hypot(event.clientX - quiet.x, event.clientY - quiet.y) < 3) return
                quietAt.current = null
                hovered.current = true
              }}
              onPointerLeave={() => { hovered.current = false }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onContextMenu={(event) => { if (latest.current.on) event.preventDefault() }} />
    </>
  )
})

