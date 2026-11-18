

import type { Rgba } from "./png"

// MARK: - The runtime, as far as this file needs it

export interface TensorLike { readonly dims: readonly number[]; readonly data: unknown }
export type TensorMaker = (data: Float32Array, dims: number[]) => TensorLike
export interface SessionLike {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>
}


export interface Recogniser { session: SessionLike; alphabet: string[] }
export type RecogniserSource = Recogniser | (() => Promise<Recogniser>)

export interface Engine<R extends RecogniserSource = Recogniser> {
  det: SessionLike
  
  rec: R
  
  japanese?: R
  tensor: TensorMaker
  // Supplied only by the owned runtime adapter. A generic engine may lend its
  // tensors or scratch arrays and retains the original borrowing contract.
  releaseTensor?: (tensor: TensorLike) => void
  releaseOwnedData?: (data: Float32Array | Int32Array) => void
}


export interface BundledLine {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
  words: { text: string; x: number; y: number; width: number; height: number }[]
}

export interface ReadTuning {
  
  maxSide: number
  
  minSide: number
  
  threshold: number
  
  boxThreshold: number
  
  unclip: number
  
  minConfidence: number
}

export const DEFAULT_TUNING: ReadTuning = {
  maxSide: 1600, minSide: 640, threshold: 0.3, boxThreshold: 0.5, unclip: 1.6, minConfidence: 0.5,
}


const checkStop = (shouldStop?: () => boolean): void => {
  if (shouldStop?.()) throw Object.assign(new Error("cancelled"), { name: "AbortError" })
}

// MARK: - Pixels


function sampler(image: Rgba): (x: number, y: number, out: Float32Array) => void {
  const { width, height, data } = image
  const px = (x: number, y: number, c: number): number => {
    const o = (y * width + x) * 4
    const a = data[o + 3]! / 255
    return data[o + c]! * a + 255 * (1 - a)
  }
  return (x, y, out) => {
    const fx = Math.min(width - 1, Math.max(0, x - 0.5)), fy = Math.min(height - 1, Math.max(0, y - 0.5))
    const x0 = Math.floor(fx), y0 = Math.floor(fy)
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
    const ax = fx - x0, ay = fy - y0
    for (let c = 0; c < 3; c += 1) {
      const top = px(x0, y0, c) * (1 - ax) + px(x1, y0, c) * ax
      const bottom = px(x0, y1, c) * (1 - ax) + px(x1, y1, c) * ax
      out[c] = top * (1 - ay) + bottom * ay
    }
  }
}


function sampleQuad(image: Rgba, origin: Point, u: Point, v: Point, outW: number, outH: number, release?: (data: Float32Array) => void): Float32Array {
  const take = sampler(image)
  const spanU = Math.hypot(u.x, u.y) / outW, spanV = Math.hypot(v.x, v.y) / outH
  const k = Math.max(1, Math.min(4, Math.ceil(Math.max(spanU, spanV))))
  const out = new Float32Array(outW * outH * 3)
  const rgb = new Float32Array(3)
  try { for (let j = 0; j < outH; j += 1) {
    for (let i = 0; i < outW; i += 1) {
      let r = 0, g = 0, b = 0
      for (let sj = 0; sj < k; sj += 1) {
        for (let si = 0; si < k; si += 1) {
          const s = (i + (si + 0.5) / k) / outW, t = (j + (sj + 0.5) / k) / outH
          take(origin.x + u.x * s + v.x * t, origin.y + u.y * s + v.y * t, rgb)
          r += rgb[0]!; g += rgb[1]!; b += rgb[2]!
        }
      }
      const o = (j * outW + i) * 3, n = k * k
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n
    }
  }
  return out
  } finally { release?.(rgb) }
}

// MARK: - Detection

export interface Point { x: number; y: number }


export interface LineBox {
  center: Point
  
  u: Point
  
  v: Point
  halfWidth: number
  halfHeight: number
  score: number
}


export function detectorSize(width: number, height: number, tuning: ReadTuning = DEFAULT_TUNING):
{ width: number; height: number } {
  let scale = 1
  if (Math.max(width, height) > tuning.maxSide) scale = tuning.maxSide / Math.max(width, height)
  else if (Math.min(width, height) < tuning.minSide) {
    scale = Math.min(tuning.minSide / Math.min(width, height), tuning.maxSide / Math.max(width, height))
  }
  const round = (side: number) => Math.max(32, Math.round((side * scale) / 32) * 32)
  return { width: round(width), height: round(height) }
}

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]


export function detectorInput(image: Rgba, size: { width: number; height: number }, release?: (data: Float32Array) => void): Float32Array {
  const rgb = sampleQuad(image, { x: 0, y: 0 }, { x: image.width, y: 0 }, { x: 0, y: image.height }, size.width, size.height, release)
  try {
  const plane = size.width * size.height
  const out = new Float32Array(plane * 3)
  for (let p = 0; p < plane; p += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgb[p * 3 + (2 - c)]! / 255  // BGR
      out[c * plane + p] = (value - MEAN[c]!) / STD[c]!
    }
  }
  return out
  } finally { release?.(rgb) }
}

const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)


export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 2) return sorted
  const lower: Point[] = [], upper: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop(); lower.pop()
  return lower.concat(upper)
}


export function minAreaRect(points: Point[]): Omit<LineBox, "score"> {
  const hull = convexHull(points)
  let best = { area: Infinity, center: { x: 0, y: 0 }, u: { x: 1, y: 0 }, w: 0, h: 0 }
  const edges = hull.length >= 2 ? hull.length : 1
  for (let i = 0; i < edges; i += 1) {
    const a = hull[i] ?? { x: 0, y: 0 }, b = hull[(i + 1) % hull.length] ?? a
    let ux = b.x - a.x, uy = b.y - a.y
    const length = Math.hypot(ux, uy)
    if (length === 0) { ux = 1; uy = 0 } else { ux /= length; uy /= length }
    let minS = Infinity, maxS = -Infinity, minT = Infinity, maxT = -Infinity
    for (const p of hull) {
      const s = p.x * ux + p.y * uy, t = -p.x * uy + p.y * ux
      minS = Math.min(minS, s); maxS = Math.max(maxS, s); minT = Math.min(minT, t); maxT = Math.max(maxT, t)
    }
    const area = (maxS - minS) * (maxT - minT)
    if (area < best.area) {
      const cs = (minS + maxS) / 2, ct = (minT + maxT) / 2
      best = { area, center: { x: cs * ux - ct * uy, y: cs * uy + ct * ux }, u: { x: ux, y: uy }, w: maxS - minS, h: maxT - minT }
    }
  }
  let u = best.u, w = best.w, h = best.h
  // The long side is the line; a box near square keeps whichever axis is nearer horizontal.
  const swap = h > w * 1.25 ? true : w > h * 1.25 ? false : Math.abs(u.y) > Math.abs(u.x)
  if (swap) { u = { x: -u.y, y: u.x }; [w, h] = [h, w] }
  if (u.x < 0 || (u.x === 0 && u.y < 0)) u = { x: -u.x, y: -u.y }
  const v = { x: -u.y, y: u.x }
  return { center: best.center, u, v: v.y < 0 ? { x: -v.x, y: -v.y } : v, halfWidth: w / 2, halfHeight: h / 2 }
}


export function linesInMap(map: Float32Array, width: number, height: number, tuning: ReadTuning = DEFAULT_TUNING, release?: (data: Int32Array) => void): LineBox[] {
  const label = new Int32Array(width * height)
  const lines: LineBox[] = []
  const stack: number[] = []
  let next = 0
  try { for (let start = 0; start < map.length; start += 1) {
    if (label[start] !== 0 || map[start]! <= tuning.threshold) continue
    next += 1
    label[start] = next
    stack.push(start)
    // The left and right ends of each row of the blob are enough for its hull.
    const rowMin = new Map<number, number>(), rowMax = new Map<number, number>()
    let count = 0, sum = 0
    while (stack.length > 0) {
      const at = stack.pop()!
      const x = at % width, y = (at - x) / width
      count += 1
      sum += map[at]!
      if (!(rowMin.get(y)! <= x)) rowMin.set(y, x)
      if (!(rowMax.get(y)! >= x)) rowMax.set(y, x)
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue
          const n = ny * width + nx
          if (label[n] === 0 && map[n]! > tuning.threshold) { label[n] = next; stack.push(n) }
        }
      }
    }
    if (count < 4) continue
    const points: Point[] = []
    for (const [y, x] of rowMin) {
      points.push({ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 })
      const right = rowMax.get(y)!
      points.push({ x: right, y }, { x: right + 1, y }, { x: right, y: y + 1 }, { x: right + 1, y: y + 1 })
    }
    const rect = minAreaRect(points)
    if (Math.min(rect.halfWidth, rect.halfHeight) * 2 < 3) continue
    const score = sum / count
    if (score < tuning.boxThreshold) continue
    const w = rect.halfWidth * 2, h = rect.halfHeight * 2
    const distance = (w * h * tuning.unclip) / (2 * (w + h))
    lines.push({ ...rect, halfWidth: rect.halfWidth + distance, halfHeight: rect.halfHeight + distance, score })
  }
  return lines
  } finally { release?.(label) }
}

// MARK: - Recognition

const REC_HEIGHT = 48

const REC_MIN_WIDTH = 320

const REC_MAX_WIDTH = 3200


export interface Strip {
  
  data: Float32Array
  
  width: number
  
  padded: number
  
  origin: Point
  along: Point
  across: Point
}


export function cutStrip(image: Rgba, box: LineBox, release?: (data: Float32Array) => void): Strip {
  let u = box.u, v = box.v, hw = box.halfWidth, hh = box.halfHeight
  if (hh * 2 >= hw * 2 * 1.5) {
    // Paddle's np.rot90: the top of the line becomes its left, the right its top.
    const nu = v, nv = { x: -u.x, y: -u.y }
    u = nu; v = nv; [hw, hh] = [hh, hw]
  }
  const along = { x: u.x * hw * 2, y: u.y * hw * 2 }, across = { x: v.x * hh * 2, y: v.y * hh * 2 }
  const origin = { x: box.center.x - u.x * hw - v.x * hh, y: box.center.y - u.y * hw - v.y * hh }
  const width = Math.max(1, Math.min(REC_MAX_WIDTH, Math.ceil((REC_HEIGHT * hw) / Math.max(1e-6, hh))))
  const padded = Math.max(REC_MIN_WIDTH, width)
  const rgb = sampleQuad(image, origin, along, across, width, REC_HEIGHT, release)
  try {
  const plane = padded * REC_HEIGHT
  const data = new Float32Array(plane * 3)  // padding is 0 after normalising, as Paddle's is
  for (let y = 0; y < REC_HEIGHT; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c += 1) data[c * plane + y * padded + x] = rgb[o + (2 - c)]! / 127.5 - 1  // BGR
    }
  }
  return { data, width, padded, origin, along, across }
  } finally { release?.(rgb) }
}


export interface Emitted { char: string; first: number; last: number; probability: number }


export function ctcDecode(probabilities: Float32Array, steps: number, classes: number, alphabet: string[]): Emitted[] {
  const out: Emitted[] = []
  let previous = -1
  for (let t = 0; t < steps; t += 1) {
    let best = 0, bestP = -Infinity
    const row = t * classes
    for (let c = 0; c < classes; c += 1) {
      const p = probabilities[row + c]!
      if (p > bestP) { bestP = p; best = c }
    }
    if (best !== 0 && best === previous && out.length > 0) {
      const last = out[out.length - 1]!
      last.last = t
      last.probability = Math.max(last.probability, bestP)
    } else if (best !== 0) {
      out.push({ char: alphabet[best] ?? "", first: t, last: t, probability: bestP })
    }
    previous = best
  }
  return out
}


export function lineFrom(emitted: Emitted[], steps: number, strip: Strip, pictureWidth: number, pictureHeight: number):
BundledLine | null {
  const text = emitted.map((one) => one.char).join("").replace(/\s+/g, " ").trim()
  if (text === "") return null
  const kept = emitted.filter((one) => one.char.trim() !== "")
  const confidence = kept.reduce((sum, one) => sum + one.probability, 0) / Math.max(1, kept.length)
  const stepWidth = strip.padded / Math.max(1, steps)
  
  const boxBetween = (from: number, to: number) => {
    const s0 = Math.max(0, Math.min(1, from / strip.width)), s1 = Math.max(0, Math.min(1, to / strip.width))
    const corners = [s0, s1].flatMap((s) => [0, 1].map((t) => ({
      x: strip.origin.x + strip.along.x * s + strip.across.x * t,
      y: strip.origin.y + strip.along.y * s + strip.across.y * t,
    })))
    const xs = corners.map((p) => Math.max(0, Math.min(pictureWidth, p.x)))
    const ys = corners.map((p) => Math.max(0, Math.min(pictureHeight, p.y)))
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x: x / pictureWidth, y: y / pictureHeight, width: (Math.max(...xs) - x) / pictureWidth, height: (Math.max(...ys) - y) / pictureHeight }
  }
  const words: BundledLine["words"] = []
  let current: Emitted[] = []
  const flush = () => {
    if (current.length === 0) return
    const from = current[0]!.first * stepWidth, to = (current[current.length - 1]!.last + 1) * stepWidth
    words.push({ text: current.map((one) => one.char).join(""), ...boxBetween(from - stepWidth / 2, to + stepWidth / 2) })
    current = []
  }
  for (const one of emitted) {
    if (one.char.trim() === "") flush()
    else current.push(one)
  }
  flush()
  return { text, confidence, ...boxBetween(0, strip.width), words }
}


export const hasJapanese = (text: string): boolean => /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿ｦ-ﾝ]/.test(text)


export function pickReading(english: BundledLine | null, japanese: BundledLine | null): BundledLine | null {
  if (japanese && hasJapanese(japanese.text) && japanese.confidence >= (english?.confidence ?? 0) - 0.05) return japanese
  return english
}

async function recognise(engine: Engine<RecogniserSource>, source: RecogniserSource, strip: Strip, image: Rgba,
  shouldStop?: () => boolean): Promise<BundledLine | null> {
  checkStop(shouldStop)
  const recogniser = typeof source === "function" ? await source() : source
  checkStop(shouldStop)
  const { session, alphabet } = recogniser
  const input = engine.tensor(strip.data, [1, 3, REC_HEIGHT, strip.padded])
  let out: Record<string, TensorLike> | undefined
  try { out = await session.run({ [session.inputNames[0]!]: input })
  const probabilities = out[session.outputNames[0]!]!
  const [, steps, classes] = probabilities.dims as [number, number, number]
  if (classes !== alphabet.length) throw new Error(`the recogniser has ${classes} classes and its dictionary ${alphabet.length}`)
  const emitted = ctcDecode(probabilities.data as Float32Array, steps, classes, alphabet)
  return lineFrom(emitted, steps, strip, image.width, image.height)
  } finally { releaseTensors(engine, input, out) }
}

function releaseTensors(engine: Engine<RecogniserSource>, input: TensorLike | undefined, outputs?: Record<string, TensorLike>): void {
  if (!engine.releaseTensor) return
  let failure: unknown
  const seen = new Set<TensorLike>()
  for (const tensor of [input, ...Object.values(outputs ?? {})]) {
    if (!tensor || seen.has(tensor)) continue
    seen.add(tensor)
    try { engine.releaseTensor(tensor) } catch (error) { failure ??= error }
  }
  if (failure) throw failure
}

// MARK: - The whole read

export interface Reading {
  lines: BundledLine[]
  
  timing: { detect: number; recognise: number }
}

export interface ReadChoices {
  
  japanese?: boolean
  
  shouldStop?: () => boolean
}


export async function readPicture(engine: Engine<RecogniserSource>, image: Rgba, tuning: ReadTuning = DEFAULT_TUNING,
  choices: ReadChoices = {}): Promise<Reading> {
  const { shouldStop } = choices
  const japanese = choices.japanese !== false ? engine.japanese : undefined
  const started = Date.now()
  const size = detectorSize(image.width, image.height, tuning)
  const inputData = detectorInput(image, size, engine.releaseOwnedData)
  let input: TensorLike | undefined, detOut: Record<string, TensorLike> | undefined, boxes: LineBox[]
  try { input = engine.tensor(inputData, [1, 3, size.height, size.width])
  checkStop(shouldStop)
  detOut = await engine.det.run({ [engine.det.inputNames[0]!]: input })
  checkStop(shouldStop)
  const map = detOut[engine.det.outputNames[0]!]!
  const [mapH, mapW] = [map.dims[2]!, map.dims[3]!]
  const scaleX = image.width / mapW, scaleY = image.height / mapH
  boxes = linesInMap(map.data as Float32Array, mapW, mapH, tuning, engine.releaseOwnedData).map((box): LineBox => {
    // Back into picture pixels. The two scales are equal up to the rounding to 32, near enough for a box.
    const toPicture = (p: Point) => ({ x: p.x * scaleX, y: p.y * scaleY })
    const ends = [
      toPicture({ x: box.center.x - box.u.x * box.halfWidth, y: box.center.y - box.u.y * box.halfWidth }),
      toPicture({ x: box.center.x + box.u.x * box.halfWidth, y: box.center.y + box.u.y * box.halfWidth }),
    ]
    const sides = [
      toPicture({ x: box.center.x - box.v.x * box.halfHeight, y: box.center.y - box.v.y * box.halfHeight }),
      toPicture({ x: box.center.x + box.v.x * box.halfHeight, y: box.center.y + box.v.y * box.halfHeight }),
    ]
    const halfWidth = Math.hypot(ends[1]!.x - ends[0]!.x, ends[1]!.y - ends[0]!.y) / 2
    const halfHeight = Math.hypot(sides[1]!.x - sides[0]!.x, sides[1]!.y - sides[0]!.y) / 2
    const u = { x: (ends[1]!.x - ends[0]!.x) / (2 * halfWidth || 1), y: (ends[1]!.y - ends[0]!.y) / (2 * halfWidth || 1) }
    const v = { x: (sides[1]!.x - sides[0]!.x) / (2 * halfHeight || 1), y: (sides[1]!.y - sides[0]!.y) / (2 * halfHeight || 1) }
    return { center: toPicture(box.center), u, v, halfWidth, halfHeight, score: box.score }
  })
  } finally {
    try { releaseTensors(engine, input, detOut) } finally { engine.releaseOwnedData?.(inputData) }
  }
  const detect = Date.now() - started

  const lines: BundledLine[] = []
  for (const box of boxes) {
    checkStop(shouldStop)
    const strip = cutStrip(image, box, engine.releaseOwnedData)
    try { const english = await recognise(engine, engine.rec, strip, image, shouldStop)
      const line = japanese ? pickReading(english, await recognise(engine, japanese, strip, image, shouldStop)) : english
      if (line && line.confidence >= tuning.minConfidence) lines.push(line)
    } finally { engine.releaseOwnedData?.(strip.data) }
  }
  // Reading order: top to bottom, then left to right (textRecognition's tidyReading refines this into bands).
  lines.sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x)
  return { lines, timing: { detect, recognise: Date.now() - started - detect } }
}
