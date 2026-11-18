

import { promises as fs } from "node:fs"
import path from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import * as ort from "onnxruntime-web"
import { loadEngine } from "./engine"
import { DEFAULT_TUNING, readPicture, type Engine, type RecogniserSource } from "./pipeline"
import { decodePng, isPng, type Rgba } from "./png"

interface Job { id: number; file?: string; bytes?: Uint8Array; pixels?: Rgba; ownedPixels?: boolean; japanese?: boolean }

const { folder, threads } = workerData as { folder: string; threads: number }
let engine: Promise<Engine<RecogniserSource>> | null = null

parentPort!.on("message", async (job: Job) => {
  let ownedImage: Rgba | undefined = job.ownedPixels ? job.pixels : undefined
  let pixelsReleased = !job.ownedPixels
  const retireImage = () => {
    const image = ownedImage
    if (image) {
      if (!(image.data?.buffer instanceof ArrayBuffer) || image.data.byteOffset || image.data.byteLength !== image.data.buffer.byteLength) throw new Error("unconfirmed private pixel ownership")
      const backing = image.data.buffer as ArrayBuffer & { transfer(size: number): ArrayBuffer }
      if (backing.byteLength) backing.transfer(0)
      if (backing.byteLength) throw new Error("pixel backing did not retire")
    }
    ownedImage = undefined
    pixelsReleased = true
  }
  try {
    const started = performance.now()
    let image = job.pixels
    if (image) {
      const { width, height, data } = image
      if (!Number.isSafeInteger(width) || width < 1 || width > 32768 || !Number.isSafeInteger(height) || height < 1 || height > 32768 || width * height > 16_000_000 || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.byteLength !== width * height * 4) throw new Error("invalid exact RGBA pixels")
      if (job.ownedPixels) {
        if (!(data.buffer instanceof ArrayBuffer) || data.byteOffset || data.byteLength !== data.buffer.byteLength) throw new Error("invalid owned RGBA backing")
        ownedImage = image
      }
    }
    if (!image) {
      const bytes = job.bytes ?? new Uint8Array(await fs.readFile(job.file!))
      if (!isPng(bytes)) throw new Error("the bundled reader decodes PNG itself; other pictures come as pixels")
      image = decodePng(bytes)
      ownedImage = image
    }
    const decoded = performance.now()
    engine ??= loadEngine(ort, path.join(folder, "models"), { threads, wasmFolder: path.join(folder, "ort"), lazyRecognisers: true })
    // Validate/decode before loading model sessions; the engine is reused for the next queued picture.
    const ready = await engine.catch((error: unknown) => { engine = null; throw error })
    const loaded = performance.now()
    const reading = await readPicture(ready, image, DEFAULT_TUNING, { japanese: job.japanese !== false })
    retireImage()
    parentPort!.postMessage({ id: job.id, lines: reading.lines, timing: { ...reading.timing, decode: decoded - started, load: loaded - decoded }, japanese: ready.japanese !== undefined, ...(job.ownedPixels ? { pixelsReleased } : {}) })
  } catch (error) {
    let failure = error
    try { retireImage() } catch (cleanup) { failure = new Error("Pixel cleanup failed: " + (cleanup as Error).message) }
    parentPort!.postMessage({ id: job.id, error: (failure as Error).message ?? String(failure), ...(job.ownedPixels ? { pixelsReleased } : {}) })
  }
})
