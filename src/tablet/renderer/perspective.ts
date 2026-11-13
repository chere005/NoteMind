type Point = {x:number,y:number}; type Size = {width:number,height:number}; const EDGE_INSET=0.025;
export interface Quad {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}


export interface Homography {
  
  m: number[]
}


export function unitSquareTo(quad: Quad): Homography {
  const { x: x0, y: y0 } = quad.topLeft
  const { x: x1, y: y1 } = quad.topRight
  const { x: x2, y: y2 } = quad.bottomRight
  const { x: x3, y: y3 } = quad.bottomLeft
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // A parallelogram: plain affine.
    return { m: [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1] }
  }
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) <= 1e-12) return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
  const g = (dx3 * dy2 - dx2 * dy3) / det
  const h = (dx1 * dy3 - dx3 * dy1) / det
  return {
    m: [x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
      y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
      g, h, 1],
  }
}

export function applyHomography(homography: Homography, point: Point): Point {
  const m = homography.m
  const w = m[6]! * point.x + m[7]! * point.y + m[8]!
  if (Math.abs(w) <= 1e-12) return point
  return {
    x: (m[0]! * point.x + m[1]! * point.y + m[2]!) / w,
    y: (m[3]! * point.x + m[4]! * point.y + m[5]!) / w,
  }
}

export function warpToPage(source: Uint8ClampedArray, sw: number, sh: number, quad: Quad,
  page: Size, inset: number = EDGE_INSET): Uint8ClampedArray<ArrayBuffer> {
  const w = Math.max(1, Math.round(page.width)), h = Math.max(1, Math.round(page.height))
  const out = new Uint8ClampedArray(w * h * 4)
  const map = unitSquareTo(quad)
  const span = 1 - 2 * inset
  for (let y = 0; y < h; y++) {
    const v = inset + ((y + 0.5) / h) * span
    for (let x = 0; x < w; x++) {
      const u = inset + ((x + 0.5) / w) * span
      const at = applyHomography(map, { x: u, y: v })
      // Back to the photograph's own rows, which run downwards.
      const px = at.x - 0.5, py = (sh - at.y) - 0.5
      const x0 = Math.floor(px), y0 = Math.floor(py)
      const fx = px - x0, fy = py - y0
      const to = (y * w + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        const sample = (cx: number, cy: number): number => {
          const ix = Math.min(Math.max(cx, 0), sw - 1), iy = Math.min(Math.max(cy, 0), sh - 1)
          return source[(iy * sw + ix) * 4 + channel]!
        }
        const top = sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx
        const bottom = sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx
        out[to + channel] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return out
}


export function quadFromPixels(corners: {
  topLeft: { x: number; y: number }
  topRight: { x: number; y: number }
  bottomRight: { x: number; y: number }
  bottomLeft: { x: number; y: number }
}, height: number): Quad {
  const up = (p: { x: number; y: number }) => ({ x: p.x, y: height - p.y })
  return {
    topLeft: up(corners.topLeft), topRight: up(corners.topRight),
    bottomRight: up(corners.bottomRight), bottomLeft: up(corners.bottomLeft),
  }
}

