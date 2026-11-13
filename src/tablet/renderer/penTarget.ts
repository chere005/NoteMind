/**
 * THE NATIVE PEN'S TARGET: the one rectangle the whole tablet writes on (penFeed.ts) and, while the pen is over it, the system cursor's
 * mapping (usePenFeed.ts), so the two never disagree. The Tablet sheet's is the sheet; the camera's is the tablet-shaped area round its
 * picture as it is shown (cameraInkGeometry.ts `inkPenArea`, published by CameraInk.tsx). Either way the tablet is the same shape on the
 * screen, and the person's Tablet orientation is the ONLY thing that turns it: the camera picture's own turn never does (the pen moves on
 * the screen, where the picture is already upright).
 */

import type { SheetReport } from "../shared/pen"
import type { Turns } from "../shared/orientation"

export interface PenRect { left: number; top: number; width: number; height: number }

export interface NativePenTarget {
  kind: "tablet" | "camera"
  element: Element
  /**
   * The paper a contact is on: a camera canvas survives a tab switch and a turn of its picture, and a contact must survive neither (CameraInk
   * publishes the tab and its turn, `data-pen-key`). The tablet sheet's is "tablet".
   */
  key: string
  /** Where the whole tablet writes, in client pixels: the sheet, or the camera's tablet-shaped area (inside its canvas). */
  rect: PenRect
  /** System mapping may never put the cursor outside the visible surface. Native data still works when this is null. */
  mapping: PenRect | null
}

type QueryRoot = Pick<Document, "querySelector">
const valid = (rect: PenRect): boolean => [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
  && rect.width > 0 && rect.height > 0

/** The camera publishes its pen area (canvas pixels, `data-pen-rect`); the tablet sheet is its own element's rectangle. */
export function nativePenTarget(root: QueryRoot = document): NativePenTarget | null {
  const camera = root.querySelector<HTMLElement>('[data-pen-surface="camera"]')
  if (camera) {
    const canvas = camera.getBoundingClientRect()
    const raw = camera.getAttribute("data-pen-rect")
    const parts = raw?.split(",").map(Number)
    if (!raw || !parts || parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null
    const [x, y, width, height] = parts as [number, number, number, number]
    const rect = { left: canvas.left + x, top: canvas.top + y, width, height }
    if (!valid(rect) || !(canvas.width > 0 && canvas.height > 0)) return null
    const inside = x >= -0.001 && y >= -0.001 && x + width <= canvas.width + 0.001 && y + height <= canvas.height + 0.001
    return { kind: "camera", element: camera, key: camera.getAttribute("data-pen-key") ?? "", rect, mapping: inside ? rect : null }
  }
  const tablet = root.querySelector<HTMLElement>('[data-tablet="surface"]')
  if (!tablet) return null
  const bounds = tablet.getBoundingClientRect()
  const rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
  return valid(rect) ? { kind: "tablet", element: tablet, key: "tablet", rect, mapping: rect } : null
}

/**
 * What main is told for the system mapping (main/pen/mapping.ts): the target's mapping rectangle, whole CSS pixels, and the person's Tablet
 * orientation (main maps only an unturned one: the driver cannot turn the cursor). The same for the sheet and the camera; a turned camera
 * picture is not a turned tablet. Null: nothing may be mapped.
 */
export function mappingReport(target: NativePenTarget | null, turns: Turns): SheetReport | null {
  const r = target?.mapping
  if (!r) return null
  return { rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, turns }
}
