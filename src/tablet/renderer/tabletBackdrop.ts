/**
 * A PICTURE UNDER A TABLET SHEET'S INK (Sean, 2026-10-24: right-click a picture ▸ "Edit with Tablet" brings it to the right pane to write on).
 * The sheet holds the picture's media file name (`TabletPage.backdrop`); this is where the picture is drawn, as the paper is: under the ink,
 * never ink itself. It is not in `TabletPage.strokes`, so Writing, the insert action (made from strokes alone) never see it; only the Page
 * picture includes it, paper and all, which is how the picture and what was written on it come back into the note.
 *
 * The picture sits CONTAINED in the sheet (all of it, centred, its own shape). Pure geometry first, then the loader (the same
 * `wm://media/` pictures the note shows, anonymous CORS so the Page picture's canvas stays readable).
 */

import type { Rect, Size } from "@notemind/core"

/** Where the picture is on a sheet of `sheetAspect` (width / height), in fractions of the sheet: as large as fits, centred. */
export function backdropRect(sheetAspect: number, pictureAspect: number): Rect {
  const sheet = Number.isFinite(sheetAspect) && sheetAspect > 0 ? sheetAspect : 16 / 9
  const shape = Number.isFinite(pictureAspect) && pictureAspect > 0 ? pictureAspect : sheet
  if (shape >= sheet) {
    const height = sheet / shape
    return { x: 0, y: (1 - height) / 2, width: 1, height }
  }
  const width = shape / sheet
  return { x: (1 - width) / 2, y: 0, width, height: 1 }
}

/** A media file name read back from disk: one plain name (no folder, no control characters), or null. */
export function parseBackdrop(raw: unknown): string | null {
  // eslint-disable-next-line no-control-regex -- a file name never holds a control character
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 255 || /[\u0000-\u001f\\/]/.test(raw)) return null
  return raw
}

/** The picture drawn onto a canvas of `px` that shows the part `view` of a sheet of `units` reference units (as `paintPaper` is). */
export function paintBackdrop(context: CanvasRenderingContext2D, image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number },
  units: Size, view: Rect, px: Size): void {
  const width=image.naturalWidth??image.width??0,height=image.naturalHeight??image.height??0
  if (width <= 0 || height <= 0) return
  const on = backdropRect(units.width / units.height, width / height)
  const dx = px.width / Math.max(1e-6, view.width), dy = px.height / Math.max(1e-6, view.height)
  context.drawImage(image,
    (on.x * units.width - view.x) * dx, (on.y * units.height - view.y) * dy, on.width * units.width * dx, on.height * units.height * dy)
}

const MAX_DECODED_BYTES = 64 * 1024 * 1024, MAX_READY = 8, MAX_LOADING = 4, MAX_PENDING = 32
type Entry = { file: string; status: 'queued' | 'loading' | 'ready' | 'failed'; image: HTMLImageElement | null; bytes: number; callbacks: Set<(image: HTMLImageElement) => void>; promise: Promise<HTMLImageElement | null>; resolve: (image: HTMLImageElement | null) => void }
const images = new Map<string, Entry>(), pending: Entry[] = [], listeners = new Map<string, Set<(image: HTMLImageElement) => void>>()
let loading = 0
function trimImages(): void {
  let bytes = 0, count = 0
  for (const entry of images.values()) if (entry.status === 'ready') { bytes += entry.bytes;count++ }
  for (const [file, entry] of images) {
    if (bytes <= MAX_DECODED_BYTES && count <= MAX_READY) break
    if (entry.status !== 'ready') continue
    // An exporter may still own this image. Removing the cache reference never cancels it.
    images.delete(file);bytes -= entry.bytes;count--
  }
}
function pumpImages(): void {
  while (loading < MAX_LOADING && pending.length) {
    const entry = pending.shift()!
    if (images.get(entry.file) !== entry || entry.status !== 'queued') continue
    entry.status = 'loading';loading++
    const image = new Image();entry.image = image;image.crossOrigin = 'anonymous'
    let timer: ReturnType<typeof setTimeout>
    const finish = (ready: boolean): void => {
      if (entry.status !== 'loading') return
      ready = ready && image.naturalWidth > 0 && image.naturalHeight > 0
      entry.status = ready ? 'ready' : 'failed';loading--
      clearTimeout(timer);image.removeEventListener('load', loaded);image.removeEventListener('error', failed)
      images.delete(entry.file)
      if (ready) { entry.bytes = image.naturalWidth * image.naturalHeight * 4;images.set(entry.file, entry) }
      const callbacks = ready ? [...entry.callbacks] : [];entry.callbacks.clear()
      entry.resolve(ready ? image : null);trimImages();pumpImages()
      if (ready) for (const callback of [...(listeners.get(entry.file) || [])]) if (listeners.get(entry.file)?.has(callback)) callback(image)
      for (const callback of callbacks) callback(image)
    }
    const loaded = (): void => finish(true), failed = (): void => finish(false)
    image.addEventListener('load', loaded);image.addEventListener('error', failed)
    timer = setTimeout(() => { finish(false);image.src = '' }, 5000)
    image.src = entry.file
  }
}
function imageRequest(file: string): Entry | null {
  const held = images.get(file)
  if (held) { if (held.status === 'ready') { images.delete(file);images.set(file, held) }return held }
  if (loading + pending.length >= MAX_PENDING) return null
  let resolve: Entry['resolve']
  const promise = new Promise<HTMLImageElement | null>(complete => { resolve = complete })
  const entry: Entry = { file, status: 'queued', image: null, bytes: 0, callbacks: new Set(), promise, resolve: resolve! }
  images.set(file, entry);pending.push(entry);pumpImages();return entry
}

/** A bounded decoded-image cache; pending callers share one load and one timeout. */
export function backdropImage(file: string, onLoad?: (image: HTMLImageElement) => void): HTMLImageElement | null {
  const entry = imageRequest(file)
  if (!entry) return null
  if (entry.status === 'ready') return entry.image
  if (onLoad) entry.callbacks.add(onLoad);return null
}

/** A visible surface owns this listener across failed/retried loads, independently of cache entries. */
export function watchBackdrop(file: string, onLoad: (image: HTMLImageElement) => void): () => void {
  let subscribed = listeners.get(file)
  if (!subscribed) listeners.set(file, subscribed = new Set())
  let active = true
  const callback = (image: HTMLImageElement) => { if (active) onLoad(image) }
  subscribed.add(callback)
  const stop = () => {
    if (!active) return
    active = false;subscribed!.delete(callback)
    if (!subscribed!.size && listeners.get(file) === subscribed) listeners.delete(file)
  }
  const ready = images.get(file)
  try { if (ready?.status === 'ready' && ready.image) callback(ready.image) } catch (error) { stop();throw error }
  return stop
}

/** Failure is explicit, so exports cannot quietly drop the background. */
export function backdropReady(file: string): Promise<HTMLImageElement | null> {
  return imageRequest(file)?.promise || Promise.resolve(null)
}
