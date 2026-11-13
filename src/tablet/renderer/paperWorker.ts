

import { cleanPaper } from "../image-processing/paper"
import type { PaperAnswer, PaperJob } from "./paperPass"

const scope = self as unknown as { onmessage: ((event: MessageEvent<PaperJob>) => void) | null; postMessage(message: PaperAnswer, transfer: Transferable[]): void }

scope.onmessage = (event) => {
  const { id, width, height, pixels, radius, darkPaper, paperLevel } = event.data
  try {
    const rgba = new Uint8ClampedArray(pixels)
    const cleaned = cleanPaper(rgba, width, height, {
      ...(radius !== undefined ? { radius } : {}), ...(darkPaper !== undefined ? { darkPaper } : {}), ...(paperLevel !== undefined ? { paperLevel } : {}),
    })
    scope.postMessage({ id, pixels: rgba.buffer as ArrayBuffer, cleaned }, [rgba.buffer as ArrayBuffer])
  } catch (error) {
    scope.postMessage({ id, error: String((error as Error).message ?? error) }, [])
  }
}