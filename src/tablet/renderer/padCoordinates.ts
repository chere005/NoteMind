import type { Turns } from "../shared/orientation"

export interface LocalPoint { x: number; y: number; width: number; height: number }
export interface ClientPoint { clientX: number; clientY: number }
export interface FractionRect { x: number; y: number; width: number; height: number }

const turnOf = (root: HTMLElement | null): Turns => {
  const value = Number(root?.dataset.padTurns)
  return value === 1 || value === 2 || value === 3 ? value : 0
}
const rootOf = (element: Element): HTMLElement | null => element.closest<HTMLElement>('#notemind-pad-root')

/** The pad root's CSS rotation; ordinary windows and elements outside that root remain unturned. */
export const elementTurns = (element: Element): Turns => turnOf(rootOf(element))

/** Untransformed local dimensions, retaining the browser's fractional CSS pixel measurements. */
export function elementSize(element: Element): { width: number; height: number } {
  const rect = element.getBoundingClientRect()
  return elementTurns(element) % 2 ? { width: rect.height, height: rect.width } : { width: rect.width, height: rect.height }
}

/** A physical window point back into the element's logical drawing coordinates. */
export function elementPoint(element: Element, point: ClientPoint): LocalPoint {
  const rect = element.getBoundingClientRect()
  switch (elementTurns(element)) {
    case 1: return { x: point.clientY - rect.top, y: rect.right - point.clientX, width: rect.height, height: rect.width }
    case 2: return { x: rect.right - point.clientX, y: rect.bottom - point.clientY, width: rect.width, height: rect.height }
    case 3: return { x: rect.bottom - point.clientY, y: point.clientX - rect.left, width: rect.height, height: rect.width }
    default: return { x: point.clientX - rect.left, y: point.clientY - rect.top, width: rect.width, height: rect.height }
  }
}

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  const value = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height }
  return { ...value, toJSON: () => ({ ...value }) } as DOMRect
}

/** A logical normalized region as the physical screenshot rectangle to request from Electron. */
export function elementRegion(element: Element, region: FractionRect): DOMRect {
  const rect = element.getBoundingClientRect()
  let x = region.x, y = region.y, width = region.width, height = region.height
  switch (elementTurns(element)) {
    case 1: x = 1 - region.y - region.height; y = region.x; width = region.height; height = region.width; break
    case 2: x = 1 - region.x - region.width; y = 1 - region.y - region.height; break
    case 3: x = region.y; y = 1 - region.x - region.width; width = region.height; height = region.width; break
  }
  return rectangle(rect.left + x * rect.width, rect.top + y * rect.height, width * rect.width, height * rect.height)
}

function rotatedMenuRoot(doc: Document): HTMLElement | null {
  const root = doc.getElementById('notemind-pad-root')
  return root && turnOf(root) ? root : null
}

/** Popup fixed-position coordinates belong to the transformed pad root when its chrome rotates. */
export const menuRoot = (doc: Document): HTMLElement => rotatedMenuRoot(doc) ?? doc.body

export function menuSize(doc: Document): { width: number; height: number } {
  const root = rotatedMenuRoot(doc)
  return root ? elementSize(root) : { width: doc.defaultView?.innerWidth ?? 0, height: doc.defaultView?.innerHeight ?? 0 }
}

/** A popup anchor in its portal's logical coordinates; normal-window geometry stays unchanged. */
export function menuRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect(), root = rotatedMenuRoot(element.ownerDocument)
  if (!root) return rect
  const first = elementPoint(root, { clientX: rect.left, clientY: rect.top })
  const last = elementPoint(root, { clientX: rect.right, clientY: rect.bottom })
  return rectangle(Math.min(first.x, last.x), Math.min(first.y, last.y), Math.abs(last.x - first.x), Math.abs(last.y - first.y))
}
