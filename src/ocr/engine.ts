

import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type * as Ort from "onnxruntime-web"
import { ctcAlphabet } from "./onnxMeta"
import type { Engine, Recogniser, RecogniserSource, SessionLike } from "./pipeline"


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
  const session = async (bytes: Uint8Array): Promise<SessionLike> =>
    await ort.InferenceSession.create(bytes, { graphOptimizationLevel: "all" }) as unknown as SessionLike
  const recogniser = async (name: string): Promise<Recogniser> => {
    const bytes = new Uint8Array(await fs.readFile(path.join(models, name)))
    const alphabet = ctcAlphabet(bytes)
    if (!alphabet) throw new Error(`${name} carries no character list`)
    return { session: await session(bytes), alphabet }
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
  const det = await session(new Uint8Array(await fs.readFile(path.join(models, MODEL_FILES.det))))
  const rec = options.lazyRecognisers ? lazyRecogniser(MODEL_FILES.rec) : await recogniser(MODEL_FILES.rec)
  const japanese = modelsIn(models).japanese ?
    (options.lazyRecognisers ? lazyRecogniser(MODEL_FILES.recJapanese) : await recogniser(MODEL_FILES.recJapanese)) : undefined
  return {
    det, rec, ...(japanese ? { japanese } : {}),
    tensor: (data, dims) => new ort.Tensor("float32", data, dims),
  }
}
