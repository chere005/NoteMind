

import { PRESET_COLOURS } from "@notemind/core"
import { PEN_WIDTHS } from "./penButtons"

export { PEN_WIDTHS }


export const PEN_SWATCHES: { hex: string; name: string }[] = [
  { hex: PRESET_COLOURS[5]!, name: "Black" },
  { hex: PRESET_COLOURS[0]!, name: "Red" },
  { hex: PRESET_COLOURS[3]!, name: "Blue" },
  { hex: PRESET_COLOURS[2]!, name: "Green" },
  { hex: PRESET_COLOURS[1]!, name: "Amber" },
  { hex: PRESET_COLOURS[4]!, name: "Purple" },
]


export const sameInk = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()


export const swatchOf = (hex: string): { hex: string; name: string } | null =>
  PEN_SWATCHES.find((one) => sameInk(one.hex, hex)) ?? null


export const dotSize = (width: number): number => Math.max(2, Math.min(width, 12))


export function nearestWidth(width: number): number {
  return PEN_WIDTHS.reduce((best, one) => (Math.abs(one - width) < Math.abs(best - width) ? one : best), PEN_WIDTHS[0]!)
}
