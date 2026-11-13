export const ZOOMS = [0.6, 0.8, 1, 1.25, 1.6, 2, 3] as const
export const ZOOM_MIN = ZOOMS[0]
export const ZOOM_MAX = ZOOMS[ZOOMS.length - 1]!

export const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(zoom) ? zoom : 1))

/** The next step bigger (`1`) or smaller (`-1`) than `zoom`, which need not be a step (Ctrl+wheel leaves it between two); the end of the range stays put. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOMS.find((one) => one > zoom + 1e-6) ?? ZOOM_MAX
  for (let at = ZOOMS.length - 1; at >= 0; at--) if (ZOOMS[at]! < zoom - 1e-6) return ZOOMS[at]!
  return ZOOM_MIN
}

/**
 * The zoom after a wheel event with Ctrl held. A mouse notch (a `deltaY` of 100 pixels) is about one step (x0.82 or x1.22); a trackpad's pinch arrives as
 * many small deltas and so zooms smoothly. Wheel up (a negative delta) zooms in. Kept to the range of the buttons, to three places.
 */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  // (deltaMode 1 counts lines, 2 pages)
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  if (!Number.isFinite(pixels) || pixels === 0) return clampZoom(zoom)
  return clampZoom(Math.round(zoom * Math.exp(-pixels * 0.002) * 1000) / 1000)
}


export type FitMode = "width" | "page";
