

import { localMean, localMeanRadius } from "./ink"
import { paperLevel } from "./deskew"
const DARK_PAPER = 100

export interface CleanPaperOptions {
  
  threshold?: number
  
  radius?: number
  
  darkPaper?: boolean
  
  paperLevel?: number
}


export const PAPER_INK_THRESHOLD = 18


export const PAPER_DARK_SHAPE_DROP = 90


const lumaOf = (r: number, g: number, b: number): number => Math.round(0.299 * r + 0.587 * g + 0.114 * b)


function greyOf(rgba: Uint8ClampedArray, count: number): { grey: Uint8Array; clear: number } {
  const grey = new Uint8Array(count)
  let clear = 0
  for (let index = 0; index < count; index++) {
    if (rgba[index * 4 + 3] === 0) clear += 1
    else grey[index] = lumaOf(rgba[index * 4]!, rgba[index * 4 + 1]!, rgba[index * 4 + 2]!)
  }
  return { grey, clear }
}


function levelOf(grey: Uint8Array, rgba: Uint8ClampedArray, count: number, clear: number): number {
  if (clear === 0) return paperLevel(grey)
  const seen = new Uint8Array(count - clear)
  let at = 0
  for (let index = 0; index < count; index++) if (rgba[index * 4 + 3] !== 0) seen[at++] = grey[index]!
  const level = paperLevel(seen)
  for (let index = 0; index < count; index++) if (rgba[index * 4 + 3] === 0) grey[index] = level
  return level
}


export function paperPageOf(rgba: Uint8ClampedArray, width: number, height: number): { level: number; dark: boolean } | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null
  const count = width * height
  if (rgba.length < count * 4) return null
  const { grey, clear } = greyOf(rgba, count)
  if (clear === count) return null
  const level = levelOf(grey, rgba, count, clear)
  return { level, dark: level < DARK_PAPER }
}


export function cleanPaper(rgba: Uint8ClampedArray, width: number, height: number,
  options: CleanPaperOptions = {}): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return true
  const count = width * height
  if (rgba.length < count * 4) return false

  const { grey, clear } = greyOf(rgba, count)
  if (clear === count) return true

  // What the page's paper is comes from the pixels that are there; a transparent one takes that level
  // so it is not black to the window round it, and so never makes ink of its neighbour.
  const level = levelOf(grey, rgba, count, clear)
  if (options.darkPaper ?? level < DARK_PAPER) return false
  // (a part of a page is told against the whole page's paper: inside a shape bigger than the part, its own level is the shape's)
  const pageLevel = Number.isFinite(options.paperLevel) ? Math.max(0, Math.min(255, options.paperLevel!)) : level

  const threshold = Math.max(1, Number.isFinite(options.threshold) ? options.threshold! : PAPER_INK_THRESHOLD)
  const radius = Number.isFinite(options.radius)
    ? Math.max(0, Math.trunc(options.radius!)) : localMeanRadius(width, height)
  const paper = localMean(grey, width, height, radius)

  const darkBelow = pageLevel - PAPER_DARK_SHAPE_DROP
  for (let index = 0; index < count; index++) {
    const at = index * 4
    if (rgba[at + 3] === 0) continue
    const against = paper[index]! < darkBelow ? pageLevel : paper[index]!
    if (against - grey[index]! >= threshold) {
      // The array rounds and holds a channel at 255.
      const gain = 255 / Math.max(1, against)
      rgba[at] = rgba[at]! * gain
      rgba[at + 1] = rgba[at + 1]! * gain
      rgba[at + 2] = rgba[at + 2]! * gain
    } else {
      rgba[at] = 255
      rgba[at + 1] = 255
      rgba[at + 2] = 255
    }
  }
  return true
}
