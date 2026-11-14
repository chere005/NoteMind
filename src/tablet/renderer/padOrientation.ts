import type { Turns } from "../shared/orientation"

/** ISO A5, as width over height for an upright page. */
export const A5_ASPECT = 148 / 210

export interface PadOrientationLayout {
  turns: Turns
  width: number
  height: number
  transform: string
}

const quarter = (value: number): Turns =>
  ((Math.round(Number.isFinite(value) ? value : 0) % 4 + 4) % 4) as Turns

/** Logical page/chrome space fitted exactly into the physical display; CSS origin is top left. */
export function padOrientationLayout(width: number, height: number, pageTurns: number, displayRotation: number, follow: boolean): PadOrientationLayout {
  const actualWidth = Number.isFinite(width) ? Math.max(0, width) : 0
  const actualHeight = Number.isFinite(height) ? Math.max(0, height) : 0
  // The operating system may already have turned the display into the selected orientation.
  const turns = follow ? quarter(pageTurns - displayRotation / 90) : 0
  const transform = turns === 1 ? `translate(${actualWidth}px, 0px) rotate(90deg)`
    : turns === 2 ? `translate(${actualWidth}px, ${actualHeight}px) rotate(180deg)`
    : turns === 3 ? `translate(0px, ${actualHeight}px) rotate(270deg)` : "none"
  return {
    turns,
    width: turns % 2 ? actualHeight : actualWidth,
    height: turns % 2 ? actualWidth : actualHeight,
    transform,
  }
}
