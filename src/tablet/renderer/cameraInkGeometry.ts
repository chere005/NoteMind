/**
 * THE PEN'S INK ON THE CAMERA'S PICTURE (Sean, 2026-10-25: "if a document scanner is on, the wacom should also be able to write on top
 * of the image.. this isn't a separate workflow and needs no buttons"). Pure geometry: numbers in, numbers out (test/cameraInkGeometry.test.ts).
 *
 * The ink of a camera tab is kept as FRACTIONS OF THE UPRIGHT PICTURE (top-left origin), the space the box and Find Page's corners are
 * kept in (scanSet.ts), so it stays on the paper when the pane is resized, the viewfinder changes shape or the picture is zoomed. On
 * screen a point goes where the picture is shown (`shown`: the picture fitted in the viewfinder, core `displayedFrame`) and then
 * through the zoom (core `zoomedPoint`), exactly as the box and the corners do. A width is in units of 1/1000 of the picture's LONGER
 * side, so a quarter turn (which swaps the sides) does not thicken or thin it.
 */

import { unzoomedPoint, zoomedPoint, zoomScale, type Point, type Rect, type Size } from "@notemind/core"
import { rotateSheetPoint, type Turns } from "../shared/orientation"
import type { InkStroke } from "./tabletPage"

/** Where the picture is on screen: its rect in the unzoomed viewfinder, the zoom (fractions of the viewfinder), the viewfinder's size. */
export interface InkView { shown: Rect; zoom: Rect | null; size: Size; turns?: Turns; clip?: Rect }

/** Reference units across the picture's longer side. */
export const INK_REF = 1000

/** A point of the picture (fractions of the upright picture), where it is in the viewfinder on screen. */
export function inkToScreen(point: Point, view: InkView): Point {
  if(view.turns)point=rotateSheetPoint(point,view.turns)
  const flat = { x: view.shown.x + point.x * view.shown.width, y: view.shown.y + point.y * view.shown.height }
  return view.zoom ? zoomedPoint(flat, view.zoom, view.size) : flat
}

/** The entire upright picture through the zoom (viewfinder points), including any part of it a zoom puts outside the viewfinder. */
export function inkPictureRect(view: InkView): Rect {
  const rect=view.clip||view.shown
  const first=view.zoom?zoomedPoint({x:rect.x,y:rect.y},view.zoom,view.size):{x:rect.x,y:rect.y}
  const last=view.zoom?zoomedPoint({x:rect.x+rect.width,y:rect.y+rect.height},view.zoom,view.size):{x:rect.x+rect.width,y:rect.y+rect.height}
  return { x: first.x, y: first.y, width: last.x - first.x, height: last.y - first.y }
}

/**
 * WHERE THE WHOLE TABLET WRITES ON THE CAMERA (the native feed, penFeed.ts), in viewfinder points: a rectangle of the TABLET'S OWN SHAPE,
 * `aspect` (width / height: the Tablet sheet's, tabletSheets.ts `currentSheetAspect`, the tablet turned by the person's Tablet orientation),
 * as on the sheet, so a circle drawn on the tablet is a circle on the screen and a Portrait orientation gives a tall area. Sean, 2026-10-26:
 * "the tablet orientation doesn't match in the live camera view and is wrong compared to the normal tablet view" (3.25.0 stretched the whole
 * tablet over the whole picture, whatever its shape).
 *
 * It is the smallest such rectangle round the picture AS IT IS SEEN (the picture on screen, through the zoom, inside the viewfinder),
 * centred on it and moved no further than keeps it inside the viewfinder (never over the header: the system mapping uses it). When the
 * viewfinder cannot hold that, it is the largest such rectangle the viewfinder holds, centred on the picture as near as it can be. The
 * margin it leaves round the picture is the pen's as the dark bars are: a press there writes nothing, a stroke that strays there stops at
 * the picture's edge (CameraInk.tsx, for every pen). Nothing of the picture's own turn is in it: the pen moves on the screen, where the
 * picture is already upright.
 */
export function inkPenArea(view: InkView, aspect: number): Rect {
  const W = Math.max(0, view.size.width), H = Math.max(0, view.size.height)
  const picture = inkPictureRect(view)
  const left = Math.max(0, picture.x), top = Math.max(0, picture.y)
  const right = Math.min(W, picture.x + picture.width), bottom = Math.min(H, picture.y + picture.height)
  // (No picture to be seen: the viewfinder itself.)
  const seen = right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : { x: 0, y: 0, width: W, height: H }
  const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : seen.width / Math.max(1e-6, seen.height)
  let width = seen.width, height = width / shape
  if (height < seen.height) { height = seen.height; width = height * shape }
  if (width > W + 1e-6 || height > H + 1e-6) {
    width = Math.min(W, H * shape)
    height = width / shape
  }
  const x = Math.max(0, Math.min(seen.x + seen.width / 2 - width / 2, W - width))
  const y = Math.max(0, Math.min(seen.y + seen.height / 2 - height / 2, H - height))
  return { x, y, width, height }
}

/** A point on screen (viewfinder points), where it is on the picture, clamped to the picture's edge (a stroke stops there, as at the sheet's). */
export function screenToInk(point: Point, view: InkView): Point {
  let flat = view.zoom ? unzoomedPoint(point, view.zoom, view.size) : point
  if(view.clip)flat={x:Math.max(view.clip.x,Math.min(view.clip.x+view.clip.width,flat.x)),y:Math.max(view.clip.y,Math.min(view.clip.y+view.clip.height,flat.y))}
  const w = Math.max(1e-6, view.shown.width), h = Math.max(1e-6, view.shown.height)
  const normalized={x:(flat.x-view.shown.x)/w,y:(flat.y-view.shown.y)/h}
  const result=view.clip?normalized:{x:clamp01(normalized.x),y:clamp01(normalized.y)}
  return view.turns?rotateSheetPoint(result,((4-view.turns)%4) as Turns):result
}

/** Whether a point on screen is on the picture at all (a pen that starts on the dark bars around it writes nothing). */
export function onPicture(point: Point, view: InkView): boolean {
  const flat = view.zoom ? unzoomedPoint(point, view.zoom, view.size) : point
  const { x, y, width, height } = view.clip||view.shown
  return width > 0 && height > 0 && flat.x >= x && flat.x <= x + width && flat.y >= y && flat.y <= y + height
}

/** Screen points per reference unit of width: the picture's longer side as shown, through the zoom. */
export function inkUnit(view: InkView): number {
  const longer = Math.max(view.shown.width, view.shown.height)
  const scale = view.zoom ? zoomScale(view.zoom, view.size) : 1
  return (longer * scale) / INK_REF
}

/** A stroke width for a pen of `px` screen points, in reference units (fixed when the stroke begins, as on the sheet). */
export const inkWidth = (px: number, view: InkView): number => px / Math.max(1e-6, inkUnit(view))

/**
 * The ink turned WITH the picture when the picture is turned (`by` degrees clockwise, a multiple of 90), so it stays on the same spot
 * of the paper. The same strokes (by reference) for no turn. A real turn ALWAYS gives a NEW array, even for no strokes at all: the
 * ink layer (cameraInkPages.ts) takes a different array as a change made from outside and starts the tab's undo history again, so an
 * empty list handed back as it came would leave Undo/Redo holding ink (one undone, or spent by a take) as it lay BEFORE the turn,
 * and a redo would put it back unturned, off the paper.
 */
export function turnInk(strokes: InkStroke[], by: number): InkStroke[] {
  const quarter = ((Math.round(by / 90) % 4) + 4) % 4 as Turns
  if (quarter === 0) return strokes
  return strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => rotateSheetPoint(point, quarter)) }))
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

