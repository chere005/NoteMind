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
export function paintBackdrop(context: CanvasRenderingContext2D, image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  units: Size, view: Rect, px: Size): void {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return
  const on = backdropRect(units.width / units.height, image.naturalWidth / image.naturalHeight)
  const dx = px.width / Math.max(1e-6, view.width), dy = px.height / Math.max(1e-6, view.height)
  context.drawImage(image,
    (on.x * units.width - view.x) * dx, (on.y * units.height - view.y) * dy, on.width * units.width * dx, on.height * units.height * dy)
}

const images = new Map<string, HTMLImageElement>()

/** The picture when it is loaded, else null and `onLoad` is called when it is (once per file: the image is kept). */
export function backdropImage(file: string, onLoad: () => void): HTMLImageElement | null {
  const held = images.get(file)
  // (one that failed before - the pane's copy was not there yet - is tried again)
  if (held && held.complete && held.naturalWidth === 0) images.delete(file)
  else if (held) {
    if (held.complete && held.naturalWidth > 0) return held
    held.addEventListener("load", onLoad, { once: true })
    return null
  }
  const image = new Image()
  image.crossOrigin = "anonymous"
  image.addEventListener("load", onLoad, { once: true })
  image.addEventListener("error", () => { images.delete(file); console.error('NoteMind: could not load the picture') })
  image.src = file
  images.set(file, image)
  return null
}

/** The picture, loaded (a moment's wait at most); null when it will not load. */
export function backdropReady(file: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const guard = setTimeout(() => resolve(null), 5000)
    const check = (): boolean => {
      const image = backdropImage(file, check)
      if (!image) return false
      clearTimeout(guard)
      resolve(image)
      return true
    }
    check()
  })
}
