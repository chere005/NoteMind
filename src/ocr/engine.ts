

import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isMarkedAsUntransferable } from "node:worker_threads"
import type * as Ort from "onnxruntime-web"
import { ctcAlphabet } from "./onnxMeta"
import type { Engine, Recogniser, RecogniserSource, SessionLike, TensorLike } from "./pipeline"


export const MODEL_FILES = {
  det: "ch_PP-OCRv5_det_mobile.onnx",
  rec: "en_PP-OCRv5_rec_mobile.onnx",
  recJapanese: "ch_PP-OCRv5_rec_mobile.onnx",
} as const


export function modelsIn(folder: string): { ok: boolean; japanese: boolean } {
  const has = (name: string) => existsSync(path.join(folder, name))
  return { ok: has(MODEL_FILES.det) && has(MODEL_FILES.rec), japanese: has(MODEL_FILES.recJapanese) }
}

export interface LoadOptions {
  
  threads?: number
  
  wasmFolder?: string
  lazyRecognisers?: boolean
}


function configure(ort: typeof Ort, options: LoadOptions): void {
  ort.env.wasm.numThreads = Math.max(1, options.threads ?? 1)
  if (options.wasmFolder) {
    const base = pathToFileURL(path.resolve(options.wasmFolder) + path.sep)
    ort.env.wasm.wasmPaths = {
      mjs: new URL("ort-wasm-simd-threaded.mjs", base).href,
      wasm: new URL("ort-wasm-simd-threaded.wasm", base).href,
    }
  }
}


export function loadEngine(ort: typeof Ort, models: string, options: LoadOptions & { lazyRecognisers: true }): Promise<Engine<RecogniserSource>>
export function loadEngine(ort: typeof Ort, models: string, options?: LoadOptions & { lazyRecognisers?: false }): Promise<Engine>
export function loadEngine(ort: typeof Ort, models: string, options: LoadOptions): Promise<Engine<RecogniserSource>>
export async function loadEngine(ort: typeof Ort, models: string, options: LoadOptions = {}): Promise<Engine<RecogniserSource>> {
  configure(ort, options)
  const retire = (data: Uint8Array | Float32Array | Int32Array): void => {
    const backing = data.buffer
    if (data.byteLength && backing instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === backing.byteLength && !isMarkedAsUntransferable(backing)) {
      ;(backing as ArrayBuffer & { transfer(size: number): ArrayBuffer }).transfer(0)
    }
  }
  const readModel = async (name: string): Promise<Uint8Array> => {
    const bytes = await fs.readFile(path.join(models, name))
    return bytes.buffer instanceof ArrayBuffer && !bytes.byteOffset && bytes.byteLength === bytes.buffer.byteLength && !isMarkedAsUntransferable(bytes.buffer) ? new Uint8Array(bytes.buffer) : Uint8Array.from(bytes)
  }
  const created: Ort.InferenceSession[] = []
  const session = async (bytes: Uint8Array): Promise<SessionLike> => {
    try {
      const value = await ort.InferenceSession.create(bytes, { graphOptimizationLevel: "all" })
      created.push(value)
      return value as unknown as SessionLike
    // Pinned ORT1.30 copies external model bytes into WASM before create()
    // settles; the session retains no borrow of this private file backing.
    } finally { retire(bytes) }
  }
  const recogniser = async (name: string): Promise<Recogniser> => {
    const bytes = await readModel(name)
    try {
      const alphabet = ctcAlphabet(bytes)
      if (!alphabet) throw new Error(`${name} carries no character list`)
      return { session: await session(bytes), alphabet }
    } finally { retire(bytes) }
  }
  const lazyRecogniser = (name: string): (() => Promise<Recogniser>) => {
    let pending: Promise<Recogniser> | undefined
    return () => {
      if (!pending) {
        const owned = recogniser(name).catch((error: unknown) => {
          if (pending === owned) pending = undefined
          throw error
        })
        pending = owned
      }
      return pending
    }
  }
  try { const det = await session(await readModel(MODEL_FILES.det))
  const rec = options.lazyRecognisers ? lazyRecogniser(MODEL_FILES.rec) : await recogniser(MODEL_FILES.rec)
  const japanese = modelsIn(models).japanese ?
    (options.lazyRecognisers ? lazyRecogniser(MODEL_FILES.recJapanese) : await recogniser(MODEL_FILES.recJapanese)) : undefined
  const inputs = new WeakSet<TensorLike>(), released = new WeakSet<TensorLike>()
  return {
    det, rec, ...(japanese ? { japanese } : {}),
    tensor: (data, dims) => { const tensor = new ort.Tensor("float32", data, dims); inputs.add(tensor); return tensor },
    releaseOwnedData: retire,
    releaseTensor: tensor => {
      if (released.has(tensor) || !(tensor instanceof ort.Tensor)) return
      const value = tensor as unknown as Ort.Tensor
      // Default ORT1.30 WASM outputs are fresh CPU copies; inputs lend the
      // strip's data until both language sessions have finished using it.
      const data = !inputs.has(tensor) && value.location === "cpu" ? value.data : undefined
      value.dispose?.()
      if (data instanceof Float32Array) retire(data)
      released.add(tensor)
    },
  }
  } catch (error) {
    const cleanup = await Promise.allSettled(created.map(async value => { await value.release() }))
    const failed = cleanup.find(result => result.status === "rejected")
    if (failed?.status === "rejected") throw Object.assign(new Error("OCR partial initialization cleanup failed: " + String(failed.reason)), { cause: error })
    throw error
  }
}
