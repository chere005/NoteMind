

export const DEFAULT_WINDOW = { width: 1280, height: 800 } as const
export const MIN_WINDOW = { width: 900, height: 560 } as const
export const NOTES_MIN = 460
export const NOTES_IDEAL = 720
export const VIDEO_MIN = 280
export const VIDEO_IDEAL = 420
export const DRAWING_PANE_WIDTH = 1080
export const DEFAULT_WACOM_SIZE = { width: DRAWING_PANE_WIDTH, height: 1920 } as const

type Size = { width: number; height: number }
export type DrawingDisplay = Size & { chromeHeight?: number }

/** Fit the display's drawing area after subtracting the bars. */
export function fitWacomDrawing(stage: Size, display: Size, chromeHeight: number): Size {
	const height = Math.max(1, display.height - Math.max(0, chromeHeight))
	const scale = Math.min(1, stage.width / display.width, stage.height / height)
	return { width: display.width * scale, height: height * scale }
}


export const DEFAULT_VIDEO_SHARE = VIDEO_IDEAL / (NOTES_IDEAL + VIDEO_IDEAL)


export function videoWidth(available: number, fraction: number | null): number {
  if (!(available > 0)) return VIDEO_MIN
  const wanted = Math.round(available * (fraction ?? DEFAULT_VIDEO_SHARE))
  const notesMin = Math.min(NOTES_MIN, Math.max(0, available - VIDEO_MIN))
  const most = Math.max(VIDEO_MIN, available - notesMin)
  if (available < VIDEO_MIN + notesMin) return Math.max(0, available - notesMin)
  return Math.min(most, Math.max(VIDEO_MIN, wanted))
}


export function fractionFor(available: number, video: number): number {
  if (!(available > 0)) return DEFAULT_VIDEO_SHARE
  return Math.round(Math.min(1, Math.max(0, video / available)) * 10000) / 10000
}


export function readFraction(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(value) && value > 0.05 && value < 0.95 ? value : null
}


export const maxVideoWidth = (available: number): number => videoWidth(available, 1)
