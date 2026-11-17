

import { promises as fs } from "node:fs"
import path from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import * as ort from "onnxruntime-web"
import { loadEngine } from "./engine"
import { DEFAULT_TUNING, readPicture, type Engine } from "./pipeline"
import { decodePng, isPng, type Rgba } from "./png"

interface Job { id: number; file?: string; bytes?: Uint8Array; pixels?: Rgba; japanese?: boolean }

const { folder, threads } = workerData as { folder: string; threads: number }
let engine: Promise<Engine> | null = null

parentPort!.on("message", async (job: Job) => {
  try {
    const started = performance.now()
    let image = job.pixels
    if (!image) {
      const bytes = job.bytes ?? new Uint8Array(await fs.readFile(job.file!))
      if (!isPng(bytes)) throw new Error("the bundled reader decodes PNG itself; other pictures come as pixels")
      image = decodePng(bytes)
    }
    const decoded = performance.now()
    engine ??= loadEngine(ort, path.join(folder, "models"), { threads, wasmFolder: path.join(folder, "ort") })
    // Validate/decode before loading model sessions; the engine is reused for the next queued picture.
    const ready = await engine.catch((error: unknown) => { engine = null; throw error })
    const loaded = performance.now()
    const reading = await readPicture(ready, image, DEFAULT_TUNING, { japanese: job.japanese !== false })
    parentPort!.postMessage({ id: job.id, lines: reading.lines, timing: { ...reading.timing, decode: decoded - started, load: loaded - decoded }, japanese: ready.japanese !== undefined })
  } catch (error) {
    parentPort!.postMessage({ id: job.id, error: (error as Error).message ?? String(error) })
  }
})
