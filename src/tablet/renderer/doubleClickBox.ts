/**
 * WHAT A DOUBLE CLICK ON THE SHEET SELECTS (Sean, 2026-10-25: "if there's an image in the drawing pane, double click should go to the
 * size of the image as the selection not the whole screen.. then another double click would go full screen").
 *
 * With a picture under the ink (a scan, an Edit with Tablet picture, the live camera) the first double click boxes the PICTURE, the
 * rectangle it fills in the sheet; the next one boxes the whole sheet; the next, the picture again. With no picture, or one that fills
 * the sheet anyway, it boxes the whole sheet, as it always did. Pure: rectangles in fractions of the sheet in, one out.
 */

import type { Rect } from "@notemind/core"

export const WHOLE_SHEET: Rect = { x: 0, y: 0, width: 1, height: 1 }

/** Boxes this close (a fraction of the sheet, per side) are the same box: a picture's rectangle is rounded by the layout. */
const SAME = 0.005

export const sameBox = (one: Rect, other: Rect): boolean =>
  Math.abs(one.x - other.x) < SAME && Math.abs(one.y - other.y) < SAME
  && Math.abs(one.width - other.width) < SAME && Math.abs(one.height - other.height) < SAME

/**
 * The box a double click makes. `was`: the box when the double click began (null: none); `picture`: where the picture is on the sheet
 * (null: there is none, or it has not loaded).
 */
export function doubleClickBox(was: Rect | null, picture: Rect | null, whole: Rect = WHOLE_SHEET): Rect {
  if (!picture || sameBox(picture, whole)) return whole
  return was && sameBox(was, picture) ? whole : picture
}
