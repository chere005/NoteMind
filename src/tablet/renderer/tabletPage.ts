/**
 * The tablet as a SOURCE for the video pane: a sheet of paper written on with
 * the pen, in place of a page under a document camera. No React, no DOM, so
 * the geometry can be tested with strokes drawn by hand.
 *
 * Why strokes and not pixels. A camera has only pixels, so the Writing button
 * lifts ink off the paper (threshold, components) and what lands is a
 * picture. The tablet KNOWS the ink — every point and its pressure — so
 * Writing brings in the real stroke items, placed exactly where the box was,
 * at the scale a page would have had; nothing is re-traced and a pen stroke
 * stays a pen stroke (editable, erasable, recoloured). The raster path
 * (`paintStrokes` onto a canvas) exists for the two readers that want pixels:
 * the image capture. Everything between
 * the box and the placement is the camera's own arithmetic in the core
 * (`regionOf`, `resolveShape`, `shapeSize`, `placement`).
 */

import { rotateSheetPoint } from "../shared/orientation"
import { newID, noTransform, pressureScale, type CanvasItem, type Point, type Rect, type Size } from "@notemind/core"
import { includeInk, sheetViewport, UNIT_SHEET, validExtent } from './sheetViewport'
import { recordStrokeAppend } from '../../stroke-signature.js'
import { strokeBox } from '../../stroke-bounds.js'
import { DrawingHistory } from '../../drawing-history.js'

/**
 * The sheet is resolution-independent. Points are fractions of the sheet and
 * widths are in REFERENCE UNITS: the sheet is `SHEET_REF` units wide whatever
 * its size on screen (a 500 px pane, a 1920 px pane), so a stroke
 * drawn on one looks the same on the other and lands in the note the same.
 */
export const SHEET_REF = 1000

/** One stroke on the sheet: points are FRACTIONS of the sheet (0…1, top-left origin). */
export interface InkStroke {
  colorHex: string
  /** The pen's width in sheet reference units (`SHEET_REF` across) at half pressure. */
  width: number
  points: Point[]
  /** 0…1, one per point; absent for the mouse. */
  pressures?: number[]
}

/** Distance from a point to a segment. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * The topmost stroke within `radius` sheet points of `point` (a fraction of
 * the sheet), or -1. The eraser rubs out WHOLE strokes, as `Canvas.eraseAt`.
 */
export function strokeUnder(strokes: InkStroke[], point: Point, size: Size, radius: number,
  /** Pixels per reference unit, to turn a stroke's width into pixels. */
  unit = 1): number {
  const at = { x: point.x * size.width, y: point.y * size.height }
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index]!
    const reach = radius + stroke.width * unit / 2
    const box = strokeBox(stroke)
    if (at.x < box.x * size.width - reach || at.x > box.right * size.width + reach || at.y < box.y * size.height - reach || at.y > box.bottom * size.height + reach) continue
    const pixel = (p: Point) => ({ x: p.x * size.width, y: p.y * size.height })
    if (stroke.points.length === 1 && Math.hypot(at.x - stroke.points[0]!.x * size.width, at.y - stroke.points[0]!.y * size.height) <= reach) return index
    for (let i = 1; i < stroke.points.length; i++) {
      if (distanceToSegment(at, pixel(stroke.points[i - 1]!), pixel(stroke.points[i]!)) <= reach) return index
    }
  }
  return -1
}

const inside = (point: Point, region: Rect): boolean =>
  point.x >= region.x && point.x <= region.x + region.width
  && point.y >= region.y && point.y <= region.y + region.height

/**
 * The parts of the strokes inside `region` (fractions of the sheet) and the
 * parts outside it. A stroke that crosses the edge is cut where its points
 * leave: the box brings in the section of the writing that is in it.
 */
export function splitByRegion(strokes: InkStroke[], region: Rect): { inside: InkStroke[]; outside: InkStroke[] } {
  const kept: InkStroke[] = [], left: InkStroke[] = []
  for (const stroke of strokes) {
    let run: number[] = []
    let runIn = false
    const flush = () => {
      if (run.length === 0) return
      const part: InkStroke = {
        colorHex: stroke.colorHex, width: stroke.width,
        points: run.map((i) => stroke.points[i]!),
        ...(stroke.pressures ? { pressures: run.map((i) => stroke.pressures![i]!) } : {}),
      }
      ;(runIn ? kept : left).push(part)
      run = []
    }
    stroke.points.forEach((point, i) => {
      const here = inside(point, region)
      if (run.length > 0 && here !== runIn) {
        flush()
      }
      runIn = here
      run.push(i)
    })
    flush()
  }
  return { inside: kept, outside: left }
}

/** The ink's own box in fractions of the sheet, or null for no ink. */
export function inkExtent(strokes: InkStroke[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x)
      y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y)
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * Strokes drawn on a canvas. `toPixel` maps a point (fraction of the sheet) to
 * canvas pixels; `scale` is canvas pixels per sheet point, for the widths.
 * `colour` overrides every stroke's colour (the reader wants black on white);
 * `tint` changes how each stroke's own colour LOOKS (ink on dark paper).
 */
export function paintStrokes(context: CanvasRenderingContext2D, strokes: InkStroke[],
  toPixel: (point: Point) => Point, scale: number, colour?: string, from = 0,
  tint?: (colorHex: string) => string): void {
  context.lineCap = "round"
  context.lineJoin = "round"
  for (const stroke of strokes) {
    const start = Math.max(0, from - 1)
    const points: Point[] = []
    for (let i = start; i < stroke.points.length; i++) points.push(toPixel(stroke.points[i]!))
    if (points.length === 0) continue
    context.strokeStyle = colour ?? tint?.(stroke.colorHex) ?? stroke.colorHex
    const pressures = stroke.pressures
    if (points.length === 1) {
      context.lineWidth = Math.max(0.5, stroke.width * scale)
      context.beginPath()
      context.moveTo(points[0]!.x, points[0]!.y)
      context.lineTo(points[0]!.x + 0.01, points[0]!.y)
      context.stroke()
      continue
    }
    if (pressures && pressures.length === stroke.points.length) {
      // Each segment at the mean of its ends' pressure, as the notes page paints a pen stroke.
      for (let i = 1; i < points.length; i++) {
        context.lineWidth = Math.max(0.25,
          stroke.width * scale * pressureScale((pressures[start + i - 1]! + pressures[start + i]!) / 2))
        context.beginPath()
        context.moveTo(points[i - 1]!.x, points[i - 1]!.y)
        context.lineTo(points[i]!.x, points[i]!.y)
        context.stroke()
      }
      continue
    }
    context.lineWidth = Math.max(0.5, stroke.width * scale)
    context.beginPath()
    context.moveTo(points[0]!.x, points[0]!.y)
    for (let i = 1; i < points.length; i++) context.lineTo(points[i]!.x, points[i]!.y)
    context.stroke()
  }
}

/** Dense recovery/exports yield between bounded pieces; pen contact still paints synchronously. */
export async function paintStrokesYielding(context:CanvasRenderingContext2D,strokes:InkStroke[],toPixel:(point:Point)=>Point,scale:number,colour?:string,from=0,tint?:(hex:string)=>string,options:{cancelled?:()=>boolean;yieldControl?:()=>Promise<any>}={}){
  const yieldControl=options.yieldControl||(()=>new Promise<void>(resolve=>setTimeout(resolve,0)))
  let work=0
  for(const stroke of strokes){
    if(options.cancelled?.())return false
    if(stroke.points.length<=8192&&from===0){paintStrokes(context,[stroke],toPixel,scale,colour,0,tint);work+=stroke.points.length+1;if(work>=8192){work=0;await yieldControl()}continue}
    for(let start=Math.max(0,from-1);start<stroke.points.length-1;start+=8191){
      if(options.cancelled?.())return false
      const end=Math.min(stroke.points.length,start+8192),part={...stroke,points:stroke.points.slice(start,end),...(stroke.pressures?{pressures:stroke.pressures.slice(start,end)}:{})}
      paintStrokes(context,[part],toPixel,scale,colour,0,tint);work+=end-start;if(work>=8192){work=0;await yieldControl()}
    }
  }
  return !options.cancelled?.()
}

/**
 * Strokes (fractions of the sheet) as note items, landed on the pane.
 *
 * `frame` is the box on the page, in page pixels, that `where` (from the
 * core's `placement`) put on the pane; a point is carried from the sheet to
 * the page (`pageSize`) and from there to the pane at the same scale the
 * frame was placed at, so the ink sits where it was on the sheet and a
 * pen's width shrinks with it.
 */
export function landStrokes(strokes: InkStroke[], options: {
  surface: Size
  pageSize: Size
  frame: Rect
  where: { center: Point; width: number }
  pane: Size
}): CanvasItem[] {
  const { surface, pageSize, frame, where, pane } = options
  const toPane = where.width * pane.width / Math.max(1, frame.width)
  const widthScale = pageSize.width / Math.max(1, surface.width) * toPane
  const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2
  return strokes.map((stroke): CanvasItem => ({
    kind: "stroke",
    stroke: {
      id: newID(),
      colorHex: stroke.colorHex,
      width: Math.max(1, stroke.width * widthScale),
      points: stroke.points.map((point) => ({
        x: where.center.x + (point.x * pageSize.width - cx) * toPane / pane.width,
        y: where.center.y + (point.y * pageSize.height - cy) * toPane / pane.height,
      })),
      ...(stroke.pressures ? { pressures: [...stroke.pressures] } : {}),
      transform: noTransform(),
      group: null,
    },
  }))
}

/**
 * The sheet's memory: strokes and an undo stack of whole stroke lists (the
 * lists are never mutated, so a snapshot is a pointer). Kept at module level
 * by the pane so that putting the video away and bringing it back does not
 * wipe the page.
 */
/**
 * One change to the sheet, so that two views of it can keep the same strokes AND the same undo history by
 * replaying the same operations in the same order.
 */
export interface SheetState { strokes: InkStroke[]; past: InkStroke[][]; future: InkStroke[][]; extent?: Rect }
export interface GeometryChangeOptions { signal?: AbortSignal; valid?: () => boolean; yieldControl?: () => Promise<void> }

export type SheetOp =
  | { op: "mark" }
  | { op: "add"; stroke: InkStroke }
  | { op: "replace"; strokes: InkStroke[] }
  | { op: "removeAt"; index: number }
  | { op: "undo" }
  | { op: "redo" }

export class TabletPage {
  /**
   * Width over height of the sheet. The sheet has the SCREEN's shape turned by
   * the tablet's orientation (a driver in Pen mode maps the whole tablet to the
   * whole screen, so that is the shape of the tablet as seen through the pen),
   * and every view of it
   * fits that shape inside itself. Strokes are fractions of the sheet, so
   * changing the shape never destroys ink: it only changes the page shape the
   * next capture is made on (rotate the ink with `rotateInk` if it should turn).
   */
  aspect: number
  strokes: InkStroke[] = []
  /** Canonical paper retained by actual ink; resizing a view never changes it or any stroke. */
  extent: Rect = { ...UNIT_SHEET }
  /** The most recently displayed full paper, for capture. Not part of the undo history. */
  viewport: Rect = { ...UNIT_SHEET }
  /** The media file of a picture shown under the ink (right-click a picture ▸ Edit with Tablet, tabletBackdrop.ts), or null. Not ink. */
  backdrop: string | null = null
  /** The file the NOTE shows for this picture now (after a Save to Original replaced it); null: the backdrop itself. In memory only. */
  target: string | null = null
  private history = new DrawingHistory()
  private geometryLeases = 0
  private disposeRequested = false
  private opListeners = new Set<(op: SheetOp) => void>()
  private changeListeners = new Set<() => void>()
  private applying = false

  constructor(aspect = 16 / 9) {
    this.aspect = Number.isFinite(aspect) && aspect >= 0.1 && aspect <= 10 ? aspect : 16 / 9
    Object.defineProperty(this, 'history', { enumerable: false })
    Object.defineProperty(this, 'strokes', {
      enumerable: true,
      get: () => this.history.current,
      set: (strokes: InkStroke[]) => this.history.setCurrent(strokes),
    })
  }

  restoreExtent(extent?: Rect): void {
    this.extent = includeInk(validExtent(extent) ? { ...extent } : { ...UNIT_SHEET }, this.strokes)
    this.viewport = { ...this.extent }
  }

  fitViewport(size: Size): Rect {
    this.viewport = sheetViewport(this.aspect, this.extent, size)
    return this.viewport
  }

  get canUndo(): boolean { return this.history.canUndo }
  get canRedo(): boolean { return this.history.canRedo }

  /** Hear every change as an operation (not the ones this page is told to apply). */
  onOp(listener: (op: SheetOp) => void): () => void {
    this.opListeners.add(listener)
    return () => { this.opListeners.delete(listener) }
  }
  /** Hear that anything changed: strokes, history or shape. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }
  private emit(op: SheetOp | null): void {
    if (op && !this.applying) this.opListeners.forEach((listener) => listener(op))
    this.changeListeners.forEach((listener) => listener())
  }

  setAspect(aspect: number): void {
    const next = Number.isFinite(aspect) && aspect >= 0.1 && aspect <= 10 ? aspect : 16 / 9
    if (Math.abs(next - this.aspect) < 1e-9) return
    this.aspect = next
    this.emit(null)
  }

  /** Turn every stroke a quarter turn clockwise in place (the "Rotate ink" button). */
  rotateInk(by: 1 | 2 | 3): void {
    const turn = (p: Point): Point => rotateSheetPoint(p, by)
    this.replace(this.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map(turn) })))
  }

  /** A change is about to be made: this is what Undo returns to. */
  mark(): void {
    this.history.mark()
    this.emit({ op: "mark" })
  }

  private silently(fn: () => void): void {
    const was = this.applying
    this.applying = true
    try { fn() } finally { this.applying = was }
  }

  add(stroke: InkStroke): void {
    this.silently(() => this.mark())
    this.extent = includeInk(this.extent, [stroke])
    const previous = this.strokes
    const next = [...previous, stroke]
    recordStrokeAppend(previous, next, stroke)
    this.strokes = next
    this.emit({ op: "add", stroke })
  }
  /** Replace the strokes as ONE undo (a clear, a capture's removal). */
  replace(next: InkStroke[]): void {
    this.silently(() => this.mark())
    this.extent = includeInk(this.extent, next)
    this.strokes = next
    this.emit({ op: "replace", strokes: next })
  }
  /** Prepare a large replacement in yielding tasks, then announce one atomic edit. */
  async replaceAsync(next: InkStroke[], options: GeometryChangeOptions = {}): Promise<boolean> {
    return this.history.change(next, () => this.replace(next), options)
  }
  /** Hydration is not an edit and must not create an Undo frame. */
  async loadGeometryAsync(next: InkStroke[], options: GeometryChangeOptions = {}): Promise<boolean> {
    return this.history.change(next, () => { this.strokes = next; this.emit(null) }, options)
  }
  clear(): void { if (this.strokes.length > 0) this.replace([]) }
  /** Remove one stroke WITHOUT marking: an erase gesture marks once, at its first hit. */
  removeAt(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.strokes.length) return
    const next = this.strokes.filter((_, i) => i !== index)
    this.history.prepareRemoval(next, index)
    this.strokes = next
    this.emit({ op: "removeAt", index })
  }

  undo(): boolean {
    const back = this.history.step()
    if (!back) return false
    this.emit({ op: "undo" })
    return true
  }

  redo(): boolean {
    const forward = this.history.step(true)
    if (!forward) return false
    this.emit({ op: "redo" })
    return true
  }
  async undoAsync(options: GeometryChangeOptions = {}): Promise<boolean> {
    const next = this.history.peek()
    return next ? this.history.change(next, () => this.undo(), options) : false
  }
  async redoAsync(options: GeometryChangeOptions = {}): Promise<boolean> {
    const next = this.history.peek(true)
    return next ? this.history.change(next, () => this.redo(), options) : false
  }
  /** Immutable history target, captured before an asynchronous action yields. */
  peekUndo(redo = false): InkStroke[] | null { return this.history.peek(redo) }

  /** Do what another view of the sheet did. Not announced again. */
  apply(op: SheetOp): void {
    this.silently(() => {
      switch (op.op) {
        case "mark": this.mark(); break
        case "add": this.add(op.stroke); break
        case "replace": this.replace(op.strokes); break
        case "removeAt": this.removeAt(op.index); break
        case "undo": this.undo(); break
        case "redo": this.redo(); break
      }
    })
  }

  /** The whole state INCLUDING history, to bring another view into step (it is cloned in one piece, so shared strokes stay shared). */
  exportState(): SheetState { return { ...this.history.export(), extent: this.extent } }
  importState(state: SheetState): void {
    this.history.import(state)
    this.restoreExtent(state.extent)
    this.emit(null)
  }

  /** Release undo-only memory while retaining this page's current ink. */
  clearHistory(): void { this.history.clear(); this.emit(null) }

  get geometryRetained(): boolean { return this.geometryLeases > 0 }
  retainGeometry(): () => void {
    this.geometryLeases++
    let released = false
    return () => {
      if (released) return
      released = true
      this.geometryLeases--
      if (!this.geometryLeases && this.disposeRequested) void this.disposeAsync()
    }
  }

  /** Drop a clean inactive model after its catalog has been marked unloaded. */
  unloadGeometry(): boolean {
    if (this.geometryRetained) return false
    this.history.dispose()
    this.backdrop = null
    this.target = null
    this.emit(null)
    return true
  }
  async unloadGeometryAsync(options: GeometryChangeOptions = {}): Promise<boolean> {
    if (this.geometryRetained || options.signal?.aborted || options.valid?.() === false) return false
    const released = this.history.disposeAsync()
    this.backdrop = null
    this.target = null
    this.emit(null)
    await released
    return true
  }

  /** An unloaded page must never retain geometry through its undo history. */
  dispose(): void {
    if (this.geometryRetained) { this.disposeRequested = true; return }
    this.disposeRequested = false
    this.history.dispose()
    this.opListeners.clear()
    this.changeListeners.clear()
    this.backdrop = null
    this.target = null
  }
  async disposeAsync(): Promise<boolean> {
    if (this.geometryRetained) { this.disposeRequested = true; return false }
    this.disposeRequested = false
    const released = this.history.disposeAsync()
    this.opListeners.clear()
    this.changeListeners.clear()
    this.backdrop = null
    this.target = null
    await released
    return true
  }
}


// MARK: - The sheet's geometry (no React, no DOM, so it can be tested with numbers)
//
// The sheet is a rectangle on the pane, the screen's shape (turned by the tablet's orientation), fitted inside
// the pane and never stretched. The pen feed maps the whole tablet onto it.

/** The largest rectangle of shape `aspect` (width over height) that fits in `container`, centred. */
export function fitRect(container: Size, aspect: number): Rect {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) {
    return { x: 0, y: 0, width: Math.max(0, container.width), height: Math.max(0, container.height) }
  }
  let width = container.width, height = width / aspect
  if (height > container.height) { height = container.height; width = height * aspect }
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height }
}

/** The sheet's shape from a screen's size, or `fallback` when the size is unusable. */
export function aspectOf(width: number, height: number, fallback = 16 / 9): number {
  return width > 0 && height > 0 && width / height > 0.2 && width / height < 5 ? width / height : fallback
}

/** The shape the sheet takes on this machine: the screen's (or a number kept for testing). */
export function screenAspect(): number {
  try {
    const kept = Number(localStorage.getItem("notemind.sheetAspect"))
    if (kept > 0.2 && kept < 5) return kept
  } catch { /* no storage */ }
  return typeof window === "undefined" ? 16 / 9 : aspectOf(window.screen.width, window.screen.height)
}


// MARK: - The dashed box: a section of the sheet to bring in
//
// All in FRACTIONS of the sheet (0...1) except where a size in pixels is passed. The mouse drags the box (the pen
// writes); a drag inside the box moves it, a drag from a corner handle resizes it; a click outside clears it.

export type BoxHandle = "nw" | "ne" | "sw" | "se"
export type BoxHit = BoxHandle | "inside" | null

/** A box from two corners, in any order. */
export const boxFromPoints = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
})

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Where the corner handles are. */
export function boxCorner(box: Rect, handle: BoxHandle): Point {
  return {
    x: handle === "nw" || handle === "sw" ? box.x : box.x + box.width,
    y: handle === "nw" || handle === "ne" ? box.y : box.y + box.height,
  }
}
const OPPOSITE: Record<BoxHandle, BoxHandle> = { nw: "se", se: "nw", ne: "sw", sw: "ne" }

/** What a press at `point` hits: a corner handle (within `grab` px of it), the inside of the box, or nothing. */
export function hitBox(box: Rect, point: Point, size: Size, grab = 10): BoxHit {
  let best: BoxHandle | null = null, nearest = Infinity
  for (const handle of ["nw", "ne", "sw", "se"] as BoxHandle[]) {
    const corner = boxCorner(box, handle)
    const distance = Math.hypot((point.x - corner.x) * size.width, (point.y - corner.y) * size.height)
    if (distance <= grab && distance < nearest) { best = handle; nearest = distance }
  }
  if (best) return best
  const inside = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
  return inside ? "inside" : null
}

/** The box moved by (dx, dy) fractions, kept on the sheet. */
export function moveBox(box: Rect, dx: number, dy: number, bounds: Rect = UNIT_SHEET): Rect {
  return {
    x: Math.min(bounds.x + bounds.width - box.width, Math.max(bounds.x, box.x + dx)),
    y: Math.min(bounds.y + bounds.height - box.height, Math.max(bounds.y, box.y + dy)),
    width: box.width, height: box.height,
  }
}

/**
 * `origin` with the corner `handle` dragged to `to`: the opposite corner stays, the box turns the other way
 * if it is dragged across it, stays on the sheet, and is never smaller than `min` px either way.
 */
export function resizeBox(origin: Rect, handle: BoxHandle, to: Point, size: Size, min = 8, bounds: Rect = UNIT_SHEET): Rect {
  const anchor = boxCorner(origin, OPPOSITE[handle])
  const minW = min / Math.max(1, size.width), minH = min / Math.max(1, size.height)
  const axis = (a: number, t: number, least: number, low: number, high: number): [number, number] => {
    const target = Math.min(high, Math.max(low, t))
    const direction = target >= a ? 1 : -1
    const length = Math.max(least, Math.abs(target - a))
    let from = direction === 1 ? a : a - length
    from = Math.min(high - length, Math.max(low, from))
    return [from, length]
  }
  const [x, width] = axis(anchor.x, to.x, minW, bounds.x, bounds.x + bounds.width)
  const [y, height] = axis(anchor.y, to.y, minH, bounds.y, bounds.y + bounds.height)
  return { x, y, width, height }
}

/**
 * The part of the sheet a box takes, in fractions of the sheet: the box clipped to it, or all of it for no box;
 * null when the box is off the sheet or under 2 px either way (`shown` is the sheet's size on screen).
 */
export function regionOfSheetBox(box: Rect | null, shown: Size): Rect | null {
  if (!box) return { x: 0, y: 0, width: 1, height: 1 }
  const x0 = clamp01(box.x), y0 = clamp01(box.y)
  const x1 = clamp01(box.x + box.width), y1 = clamp01(box.y + box.height)
  if ((x1 - x0) * shown.width < 2 || (y1 - y0) * shown.height < 2) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
