

import {localMeanRadius} from "../image-processing/ink"
import { cleanPaper, paperPageOf } from "../image-processing/paper"


export interface PaperJob { id: number; width: number; height: number; pixels: ArrayBuffer; radius?: number; darkPaper?: boolean; paperLevel?: number }

export type PaperAnswer = { id: number; pixels: ArrayBuffer; cleaned: boolean } | { id: number; error: string }

export interface CleanOptions {
  
  radius?: number
  
  darkPaper?: boolean
  
  paperLevel?: number
}


export const radiusForPart = (whole: { width: number; height: number }, pixelsPerUnit: number): number =>
  localMeanRadius(Math.max(1, Math.round(whole.width * pixelsPerUnit)), Math.max(1, Math.round(whole.height * pixelsPerUnit)))


export const paperStats = { worker: 0, here: 0, asked: 0 }

let worker: Worker | null | undefined
let jobs = 0
const waiting = new Map<number, (answer: PaperAnswer | null) => void>()


function start(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === "undefined") return worker
  try {
    const made = new Worker(new URL("./paper-worker.js", document.baseURI), { type: "module" })
    made.onmessage = (event: MessageEvent<PaperAnswer>) => {
      const done = waiting.get(event.data.id)
      waiting.delete(event.data.id)
      done?.(event.data)
    }
    // A worker that cannot start (or dies) answers every job still waiting with nothing, and is not asked again.
    made.onerror = () => {
      worker = null
      made.terminate()
      for (const done of waiting.values()) done(null)
      waiting.clear()
    }
    worker = made
  } catch { worker = null }
  return worker
}

function ask(away: Worker, pixels: ArrayBuffer, width: number, height: number, options: CleanOptions): Promise<PaperAnswer | null> {
  const id = ++jobs
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    const job: PaperJob = { id, width, height, pixels, ...options }
    try { away.postMessage(job, [pixels]) } catch { waiting.delete(id); resolve(null) }
  })
}


export async function cleanCanvas(canvas: HTMLCanvasElement, options: CleanOptions = {}): Promise<boolean> {
  const { width, height } = canvas
  if (width < 1 || height < 1) return false
  try {
    const context = canvas.getContext("2d")
    if (!context) return false
    const image = context.getImageData(0, 0, width, height)
    const away = start()
    if (away) {
      // (The bytes are handed over, not copied: `image` is of no use after this.)
      const answer = await ask(away, image.data.buffer as ArrayBuffer, width, height, options)
      if (answer && "pixels" in answer) {
        paperStats.worker += 1
        if (answer.cleaned) context.putImageData(new ImageData(new Uint8ClampedArray(answer.pixels), width, height), 0, 0)
        return answer.cleaned
      }
      // The worker failed: the pixels it was given are gone, so they are read again and done here.
      return await cleanHere(context, context.getImageData(0, 0, width, height), options)
    }
    return await cleanHere(context, image, options)
  } catch (error) {
    console.warn("NoteMind: the page's background could not be removed:", error)
    return false
  }
}


export function paperPageOfCanvas(canvas: HTMLCanvasElement): { level: number; dark: boolean } | null {
  const { width, height } = canvas
  const context = canvas.getContext("2d")
  if (!context || width < 1 || height < 1) return null
  return paperPageOf(context.getImageData(0, 0, width, height).data, width, height)
}


async function cleanHere(context: CanvasRenderingContext2D, image: ImageData, options: CleanOptions): Promise<boolean> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  paperStats.here += 1
  const cleaned = cleanPaper(image.data, image.width, image.height, options)
  if (cleaned) context.putImageData(image, 0, 0)
  return cleaned
}