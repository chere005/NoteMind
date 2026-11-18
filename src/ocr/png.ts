

import { inflateSync } from "node:zlib"
import { isMarkedAsUntransferable } from "node:worker_threads"

export interface Rgba {
  width: number
  height: number
  
  data: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_PIXELS = 16_000_000, MAX_DIMENSION = 32768, MAX_FILTERED_BYTES = 128 * 1024 * 1024
const PASSES: [number, number, number, number][] = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
const retire = (bytes: Uint8Array | undefined, ownedBacking = false): void => {
  if (bytes?.buffer instanceof ArrayBuffer && (ownedBacking || bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) && !isMarkedAsUntransferable(bytes.buffer)) {
    ;(bytes.buffer as ArrayBuffer & { transfer(size: number): ArrayBuffer }).transfer(0)
  }
}

export const isPng = (bytes: Uint8Array): boolean => SIGNATURE.every((value, at) => bytes[at] === value)

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}


function unfilter(data: Uint8Array, offset: number, width: number, height: number, bpp: number,
  bitsPerPixel: number): { rows: Uint8Array; next: number } {
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  // This inflated buffer belongs exclusively to the decoder. Compact each
  // filtered row over bytes already consumed; future filtered input stays ahead.
  const rows = data.subarray(offset, offset + stride * height)
  let at = offset
  for (let y = 0; y < height; y += 1) {
    const filter = data[at++]!
    const row = y * stride, prior = row - stride
    for (let x = 0; x < stride; x += 1) {
      const raw = data[at++]!
      const left = x >= bpp ? rows[row + x - bpp]! : 0
      const up = y > 0 ? rows[prior + x]! : 0
      const upLeft = y > 0 && x >= bpp ? rows[prior + x - bpp]! : 0
      let value: number
      switch (filter) {
        case 0: value = raw; break
        case 1: value = raw + left; break
        case 2: value = raw + up; break
        case 3: value = raw + ((left + up) >> 1); break
        case 4: value = raw + paeth(left, up, upLeft); break
        default: throw new Error(`PNG: unknown filter ${filter}`)
      }
      rows[row + x] = value & 0xff
    }
  }
  return { rows, next: at }
}


export function decodePng(bytes: Uint8Array): Rgba {
  if (!isPng(bytes)) throw new Error("not a PNG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0
  let palette: Uint8Array | null = null
  let alphaTable: Uint8Array | null = null
  const idat: Uint8Array[] = []
  let hasHeader = false, hasEnd = false
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    if (length > bytes.length - at - 12) throw new Error("PNG: truncated chunk")
    if (!hasHeader && type !== "IHDR") throw new Error("PNG: missing first header")
    const body = bytes.subarray(at + 8, at + 8 + length)
    at += 12 + length
    if (type === "IHDR") {
      if (hasHeader || length !== 13) throw new Error("PNG: invalid header")
      hasHeader = true
      const header = new DataView(body.buffer, body.byteOffset, body.byteLength)
      width = header.getUint32(0); height = header.getUint32(4)
      depth = body[8]!; colour = body[9]!; interlace = body[12]!
      if (body[10] !== 0 || body[11] !== 0 || interlace > 1) throw new Error("PNG: unsupported encoding")
    } else if (type === "PLTE") palette = body
    else if (type === "tRNS") alphaTable = body
    else if (type === "IDAT") idat.push(body)
    else if (type === "IEND") { if (length !== 0) throw new Error("PNG: invalid end chunk"); hasEnd = true;break }
  }
  if (!hasEnd) throw new Error("PNG: truncated image")
  if (width <= 0 || height <= 0) throw new Error("PNG: no header")
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw new Error("PNG: image is too large for text recognition")
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 3 ? 1 : colour === 4 ? 2 : colour === 6 ? 4 : 0
  if (channels === 0) throw new Error(`PNG: unknown colour type ${colour}`)
  const depths = colour === 0 ? [1, 2, 4, 8, 16] : colour === 3 ? [1, 2, 4, 8] : [8, 16]
  if (!depths.includes(depth)) throw new Error("PNG: unsupported bit depth")
  const bitsPerPixel = channels * depth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const passBytes = (w: number, h: number) => (Math.ceil(w * bitsPerPixel / 8) + 1) * h
  const expected = interlace === 0 ? passBytes(width, height) : PASSES.reduce((sum, [x0, y0, dx, dy]) => {
    const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy)
    return sum + (w > 0 && h > 0 ? passBytes(w, h) : 0)
  }, 0)
  if (!Number.isSafeInteger(expected) || expected > MAX_FILTERED_BYTES) throw new Error("PNG: decoded image is too large for text recognition")
  const compressed = Buffer.concat(idat)
  let data: Uint8Array
  try { data = inflateSync(compressed, { maxOutputLength: expected }) } finally { retire(compressed) }
  if (data.length !== expected) { retire(data, true); throw new Error("PNG: incomplete image data") }
  let out: Uint8Array | undefined
  try {
  out = new Uint8Array(width * height * 4)
  const max = (1 << Math.min(depth, 8)) - 1

  
  const rawSample = (rows: Uint8Array, row: number, x: number, c: number): number => {
    if (depth === 8) return rows[row + x * channels + c]!
    if (depth === 16) { const at = row + (x * channels + c) * 2; return rows[at]! * 256 + rows[at + 1]! }
    const bit = (x * channels + c) * depth
    return (rows[row + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max
  }
  const sample = (rows: Uint8Array, row: number, x: number, c: number): number => {
    const value = rawSample(rows, row, x, c)
    return depth === 16 ? value >>> 8 : depth === 8 || colour === 3 ? value : Math.round((value * 255) / max)
  }
  const transparentGray = alphaTable && colour === 0 && alphaTable.length >= 2
    ? new DataView(alphaTable.buffer, alphaTable.byteOffset).getUint16(0) : -1
  const transparentRGB = alphaTable && colour === 2 && alphaTable.length >= 6
    ? [0, 2, 4].map(offset => new DataView(alphaTable!.buffer, alphaTable!.byteOffset).getUint16(offset)) : null

  const place = (rows: Uint8Array, w: number, h: number, put: (x: number, y: number) => number) => {
    const stride = Math.ceil((w * bitsPerPixel) / 8)
    for (let y = 0; y < h; y += 1) {
      const row = y * stride
      for (let x = 0; x < w; x += 1) {
        const o = put(x, y) * 4
        if (colour === 3) {
          const index = sample(rows, row, x, 0)
          out[o] = palette?.[index * 3] ?? 0
          out[o + 1] = palette?.[index * 3 + 1] ?? 0
          out[o + 2] = palette?.[index * 3 + 2] ?? 0
          out[o + 3] = alphaTable && index < alphaTable.length ? alphaTable[index]! : 255
        } else if (channels <= 2) {
          const g = sample(rows, row, x, 0)
          out[o] = out[o + 1] = out[o + 2] = g
          out[o + 3] = channels === 2 ? sample(rows, row, x, 1)
            : transparentGray >= 0 && rawSample(rows, row, x, 0) === transparentGray ? 0 : 255
        } else {
          out[o] = sample(rows, row, x, 0)
          out[o + 1] = sample(rows, row, x, 1)
          out[o + 2] = sample(rows, row, x, 2)
          out[o + 3] = channels === 4 ? sample(rows, row, x, 3)
            : transparentRGB && transparentRGB.every((value, c) => rawSample(rows, row, x, c) === value) ? 0 : 255
        }
      }
    }
  }

  if (interlace === 0) {
    place(unfilter(data, 0, width, height, bpp, bitsPerPixel).rows, width, height, (x, y) => y * width + x)
  } else {
    // Adam7: seven passes, each a small image of its own.
    let offset = 0
    for (const [x0, y0, dx, dy] of PASSES) {
      const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy)
      if (w <= 0 || h <= 0) continue
      const { rows, next } = unfilter(data, offset, w, h, bpp, bitsPerPixel)
      offset = next
      place(rows, w, h, (x, y) => (y0 + y * dy) * width + x0 + x * dx)
    }
  }
  return { width, height, data: out }
  } catch (error) { retire(out); throw error } finally { retire(data, true) }
}
