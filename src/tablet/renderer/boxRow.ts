import type { Point, Rect, Size } from "@notemind/core"
import type { InkStroke } from "./tabletPage"

/** Room between the box's edge and the row, and between the row and the sheet's edge, in px. */
export const ROW_GAP = 6

/** Where the row goes, in px of the sheet (top-left of the row); `side` says whether it is under, over or inside the box. */
export interface RowPlace { left: number; top: number; side: "below" | "above" | "inside" }

/**
 * The row's place: centred under the box; ABOVE it when there is no room under it; when there is room on neither side
 * on the sheet (a box as tall as the sheet: a double-click boxes it all), just under the sheet or just over it, in the
 * pane's margin round the sheet (`room`, px), never on the box; and only when the pane has no margin either, inside
 * the box along its bottom edge. Kept on the sheet across.
 * `box` is in FRACTIONS of the sheet, `sheet` the sheet's size on screen, `row` the row's own size (px).
 */
export function placeRow(box: Rect, sheet: Size, row: Size, gap = ROW_GAP,
  room: { above: number; below: number } = { above: 0, below: 0 }): RowPlace {
  const x = box.x * sheet.width, y = box.y * sheet.height
  const w = box.width * sheet.width, h = box.height * sheet.height
  const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))
  const left = clamp(x + w / 2 - row.width / 2, gap, Math.max(gap, sheet.width - gap - row.width))
  const below = y + h + gap
  if (below + row.height <= sheet.height - gap / 2) return { left, top: below, side: "below" }
  const above = y - gap - row.height
  if (above >= gap / 2) return { left, top: above, side: "above" }
  // Off the sheet, in the pane's margin under it (or over it): the box reaches the sheet's edge there.
  if (y + h >= sheet.height - gap && room.below >= gap + row.height) return { left, top: sheet.height + gap, side: "below" }
  if (y <= gap && room.above >= gap + row.height) return { left, top: -gap - row.height, side: "above" }
  // Neither: inside the box, on its bottom edge (and never off the sheet).
  const inside = clamp(y + h - gap - row.height, gap, Math.max(gap, sheet.height - gap - row.height))
  return { left, top: inside, side: "inside" }
}

const within = (point: { x: number; y: number }, region: Rect): boolean =>
  point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height

/** Whether the straight line from `a` to `b` touches `region`: the part of it between the box's two vertical edges and the part between its two horizontal ones must meet. */
function segmentTouches(a: { x: number; y: number }, b: { x: number; y: number }, region: Rect): boolean {
  let low = 0
  let high = 1
  // (Narrows [low, high], the stretch of the line still inside every band met so far; false when a band is missed or the stretch is gone.)
  const band = (from: number, to: number, min: number, max: number): boolean => {
    const delta = to - from
    if (delta === 0) return from >= min && from <= max
    const first = (min - from) / delta
    const second = (max - from) / delta
    low = Math.max(low, Math.min(first, second))
    high = Math.min(high, Math.max(first, second))
    return low <= high
  }
  return band(a.x, b.x, region.x, region.x + region.width) && band(a.y, b.y, region.y, region.y + region.height)
}

/**
 * The sheet's strokes with the ones WHOLLY inside `region` (fractions of the sheet) rubbed out (Sean, 2026-10-27). This
 * is NOT the Writing capture's rule (`splitByRegion` cuts a stroke at the box's edge): a stroke that crosses the edge is
 * kept WHOLE, and so is every stroke the box does not touch, each AS IT IS (the same object, so a sheet bound to a
 * drawing region keeps its link to the region's item). `removed` counts only the strokes taken off (0: nothing to erase, so
 * a box that only crosses strokes erases nothing). `crossed` counts the strokes kept that the box touches: one with a
 * sampled point in the box, or one whose line runs through it between two points (a fast pen samples a point every few
 * dozen px, and a small box can lie between two of them: the line drawn crosses it all the same).
 */
export function eraseRegion(strokes: InkStroke[], region: Rect): { strokes: InkStroke[]; removed: number; crossed: number } {
  const out: InkStroke[] = []
  let removed = 0
  let crossed = 0
  for (const stroke of strokes) {
    const inside = stroke.points.filter((point) => within(point, region)).length
    if (inside > 0 && inside === stroke.points.length) { removed++; continue }
    if (inside > 0 || stroke.points.some((point, index) => index > 0 && segmentTouches(stroke.points[index - 1]!, point, region))) crossed++
    out.push(stroke)
  }
  return { strokes: removed === 0 ? strokes : out, removed, crossed }
}

/** What Erase says when the box crosses writing but holds no stroke whole (`eraseRegion`'s `crossed`). */
export const ERASE_WHOLE_ONLY = "no stroke lies wholly inside that box: Erase takes only whole strokes"

/**
 * A press that began on the row (client px) is the SHEET's now (a stroke for the pen, a box for the mouse, from its first
 * point): it began over the sheet itself (the row lies on it; a row in the pane's margin keeps its presses) and has moved
 * `slop` px or more from there. Short of that it is still a click on the button (penFeed.ts CLICK_SLOP_PX, the pen feed's
 * own rule for the same row).
 */
export function rowPressToSheet(sheet: { left: number; top: number; width: number; height: number }, start: Point, point: Point,
  slop: number): boolean {
  const over = start.x >= sheet.left && start.x < sheet.left + sheet.width && start.y >= sheet.top && start.y < sheet.top + sheet.height
  return over && Math.hypot(point.x - start.x, point.y - start.y) >= slop
}

