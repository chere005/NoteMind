/**
 * The kinds of pen: Pen, Marker, Fountain Pen, Highlighter. No React, no DOM.
 *
 * A stroke is stored as `{colorHex, width, points, pressures?}` and nothing else, so a kind is only WHAT IS CAPTURED:
 *
 *   Pen          the chosen colour and width; the device's pressure when it reports one.
 *   Marker       three times the width, no pressure: a bold, even line.
 *   Fountain Pen one and a half times the width, and a pressure for every point MADE here from the way the stroke is
 *                going past a 45 degree nib (thin along the nib's edge, thick across it), so the renderer every reader
 *                already has (`pressureScale`) draws the thick and the thin.
 *   Highlighter  a wide even band in the colour mixed toward the paper, placed UNDER the ink (inkBeneath.ts).
 */

import { pressureScale } from "@notemind/core"

export type PenKind = "pen" | "marker" | "fountain" | "highlighter"

export const PEN_KINDS: { value: PenKind; label: string }[] = [
  { value: "pen", label: "Pen" },
  { value: "marker", label: "Marker" },
  { value: "fountain", label: "Fountain Pen" },
  { value: "highlighter", label: "Highlighter" },
]

export const isPenKind = (value: unknown): value is PenKind => PEN_KINDS.some((one) => one.value === value)

/**
 * What the ink is drawn on: a plain `sheet`, a sheet or page with a `picture` under the ink (a picture sent to the
 * tablet, a PDF page), or the `camera` picture, whose ink has its own capture and is the pen's.
 */
export type InkSurface = "sheet" | "picture" | "camera"

/** Why a kind cannot be used on this surface (a tooltip), or null when it can. */
export function kindOff(kind: PenKind, surface: InkSurface): string | null {
  if (kind === "pen" || surface === "sheet") return null
  if (surface === "camera") return "Camera ink is drawn with the pen"
  // The highlighter's tint is opaque: it would hide the picture.
  return kind === "highlighter" ? "Highlighter needs a plain sheet" : null
}

/** The kind that draws on this surface: the chosen one, or the pen where that one cannot be used. */
export function kindOn(kind: unknown, surface: InkSurface): PenKind {
  return isPenKind(kind) && kindOff(kind, surface) === null ? kind : "pen"
}

/** The stroke's width for a chosen pen width (the same units in and out). */
export function kindWidth(kind: PenKind, width: number): number {
  if (kind === "marker") return width * 3
  if (kind === "fountain") return width * 1.5
  if (kind === "highlighter") return Math.max(12, width * 6)
  return width
}

// MARK: - The highlighter's tint

/** How much of the colour is in a highlight; the rest is the paper. */
export const HIGHLIGHT_SHARE = 0.38

function channels(hex: string): [number, number, number] | null {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!value) return null
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

/**
 * The colour mixed toward the paper, as `#rrggbb`: what the colour at `share` opacity looks like on that paper. A
 * colour that is not `#rrggbb` is returned as it is; paper that is not is taken as white.
 */
export function tintToward(colour: string, paper: string, share = HIGHLIGHT_SHARE): string {
  const ink = channels(colour)
  if (!ink) return colour
  const under = channels(paper) ?? [255, 255, 255]
  const part = Math.min(1, Math.max(0, Number.isFinite(share) ? share : HIGHLIGHT_SHARE))
  const mixed = ink.map((value, at) => Math.round(value * part + under[at]! * (1 - part)))
  return "#" + mixed.map((value) => value.toString(16).padStart(2, "0")).join("")
}

// MARK: - The fountain pen's nib

/** The pressures a nib writes: a hairline along its edge, its full width across it. */
export const NIB_THIN = 0.06
export const NIB_THICK = 0.92
/** A stroke begins and ends at this share of what the nib would write. */
export const NIB_START = 0.3
export const NIB_END = 0.3
/** The most one sample may change the pressure: thick and thin turn into each other, they never jump. */
export const NIB_MAX_STEP = 0.16
/** Pixels of travel over which the heading and the pressure settle. */
const HEADING_PX = 4
const SETTLE_PX = 3
/** A hand this fast (pixels a millisecond) writes this much thinner. */
const FAST_PX_MS = 2.5
const FAST_THINNER = 0.35
/** The pace is read over at least this long: samples a pen feed hands over in one burst have no time between them. */
const PACE_MS = 12

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/**
 * How far ACROSS the nib a movement goes: 0 along its edge, 1 square to it. The edge of a 45 degree nib runs from
 * lower left to upper right on the screen (`y` grows downward), so "/" is the hairline and "\" the full width.
 * No movement is 0.5.
 */
export function nibAcross(dx: number, dy: number): number {
  const length = Math.hypot(dx, dy)
  return length > 0 ? Math.abs(dx + dy) / (Math.SQRT2 * length) : 0.5
}

/** The pressure the nib writes going that way, before the hand's own pressure and pace. */
export const nibPressure = (dx: number, dy: number): number => NIB_THIN + (NIB_THICK - NIB_THIN) * nibAcross(dx, dy)

/** A ruled line by the nib is one even width: this times the stroke's width, for the way the line goes. */
export const nibLineScale = (dx: number, dy: number): number => pressureScale(nibPressure(dx, dy))

/** Pixels over which a nib's stroke swells from its start and thins to its end, for a stroke `width` pixels wide. */
export const nibTaper = (width: number): number => clamp(width * 2.5, 6, 28)

export interface Nib {
  /**
   * The pressure of the next point: `dx`, `dy` pixels from the point before, `dt` milliseconds after it (0 when not
   * known), `device` the pen's own pressure (0…1) or null when it reports none (a mouse). The first call is the
   * stroke's first point: its movement is not read.
   */
  next(dx: number, dy: number, dt: number, device: number | null): number
  /** A new stroke begins at the next point. */
  restart(): void
}

/** One stroke's nib. The same samples always give the same pressures. */
export function createNib(taper: number): Nib {
  let fresh = true, pressure = 0, travelled = 0, pace = 0, run = 0, span = 0
  let heading = { x: 0, y: 0 }
  const reach = Math.max(1, taper)
  return {
    restart() { fresh = true },
    next(dx, dy, dt, device) {
      if (fresh) {
        fresh = false
        travelled = 0
        pace = 0
        run = 0
        span = 0
        heading = { x: 0, y: 0 }
        pressure = nibPressure(0, 0) * NIB_START
        return pressure
      }
      const length = Math.hypot(dx, dy)
      if (!(length > 0) || !Number.isFinite(length)) return pressure
      // Older movement fades with distance, so a pixel of mouse stair-step does not turn the nib.
      const kept = Math.exp(-length / HEADING_PX)
      heading = { x: heading.x * kept + dx, y: heading.y * kept + dy }
      run += length
      if (dt > 0 && Number.isFinite(dt)) span += dt
      if (span >= PACE_MS) {
        pace += (run / span - pace) * 0.5
        run = 0
        span = 0
      }
      const hand = device === null || !Number.isFinite(device) ? 1 : 0.55 + 0.9 * clamp(device, 0, 1)
      const quick = 1 - FAST_THINNER * clamp(pace / FAST_PX_MS, 0, 1)
      travelled += length
      const swell = NIB_START + (1 - NIB_START) * clamp(travelled / reach, 0, 1)
      const wanted = clamp(nibPressure(heading.x, heading.y) * hand * quick * swell, 0, 1)
      const step = (wanted - pressure) * (1 - Math.exp(-length / SETTLE_PX))
      pressure = clamp(pressure + clamp(step, -NIB_MAX_STEP, NIB_MAX_STEP), 0, 1)
      return pressure
    },
  }
}

/**
 * The end of a nib's stroke: the pressures of its last `taper` pixels thinned toward the end, IN PLACE (the stroke is
 * not made yet). `points` are fractions of a sheet `sheet` pixels in size. Call it on a copy to show the stroke as it
 * would be if it ended now.
 */
export function nibTaperEnd(pressures: number[], points: { x: number; y: number }[],
  sheet: { width: number; height: number }, taper: number): number[] {
  const reach = Math.max(1, taper)
  let fromEnd = 0
  for (let at = Math.min(pressures.length, points.length) - 1; at >= 0 && fromEnd < reach; at--) {
    pressures[at] = pressures[at]! * (NIB_END + (1 - NIB_END) * (fromEnd / reach))
    if (at > 0) {
      fromEnd += Math.hypot((points[at]!.x - points[at - 1]!.x) * sheet.width,
        (points[at]!.y - points[at - 1]!.y) * sheet.height)
    }
  }
  return pressures
}
