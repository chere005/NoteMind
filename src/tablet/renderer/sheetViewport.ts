import type { Point, Rect, Size } from '@notemind/core'
import { strokeBox } from '../../stroke-bounds.js'

export const UNIT_SHEET: Rect = { x: 0, y: 0, width: 1, height: 1 }

/** The whole available surface, expressed in the drawing's original coordinates. Only blank paper expands. */
export function sheetViewport(aspect: number, extent: Rect = UNIT_SHEET, size: Size): Rect {
  if (!(size.width > 0 && size.height > 0 && aspect > 0)) return { ...extent }
  const ratio = size.width / size.height
  let width = extent.width, height = extent.height
  if (aspect * width / height < ratio) width = height * ratio / aspect
  else height = width * aspect / ratio
  return { x: extent.x + (extent.width - width) / 2, y: extent.y + (extent.height - height) / 2, width, height }
}

export const pointOnView = (point: Point, view: Rect): Point => ({ x: (point.x - view.x) / view.width, y: (point.y - view.y) / view.height })
export const pointOnPage = (point: Point, view: Rect): Point => ({ x: view.x + point.x * view.width, y: view.y + point.y * view.height })
export const rectOnView = (rect: Rect, view: Rect): Rect => ({ ...pointOnView(rect, view), width: rect.width / view.width, height: rect.height / view.height })
export const pagePixelSize = (size: Size, view: Rect): Size => ({ width: size.width / view.width, height: size.height / view.height })

/** Keep newly written margins when the view changes, without growing the page just because a window was resized. */
export function includeInk(extent: Rect, strokes: { points: Point[] }[]): Rect {
  let rx = Math.max(.5, .5 - extent.x, extent.x + extent.width - .5)
  let ry = Math.max(.5, .5 - extent.y, extent.y + extent.height - .5)
  for (const stroke of strokes) {
    const box=strokeBox(stroke)
    if(!box.count)continue
    rx = Math.max(rx, Math.abs(box.x - .5), Math.abs(box.right - .5));ry = Math.max(ry, Math.abs(box.y - .5), Math.abs(box.bottom - .5))
  }
  if (extent.x === .5 - rx && extent.y === .5 - ry && extent.width === 2 * rx && extent.height === 2 * ry) return extent
  return { x: .5 - rx, y: .5 - ry, width: 2 * rx, height: 2 * ry }
}

export const validExtent = (value: unknown): value is Rect => {
  const rect = value as Rect | null
  return !!rect && [rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(value => Number.isFinite(value * 10000))
    && rect.x <= 0 && rect.y <= 0 && rect.width >= 1 && rect.height >= 1
    && rect.x + rect.width >= 1 && rect.y + rect.height >= 1
}
