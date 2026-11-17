import type { InkStroke } from './tabletPage'
import type { Paper } from './tabletPaper'

type Region = { x: number; y: number; width: number; height: number }
type Source = { name: string; aspect: number; strokes: InkStroke[]; backdrop?: string | null; paper: Paper; target?: any }

/** Committed strokes are immutable; retain their identities while freezing the export's sheet and selection. */
export function snapshotDrawing(source: Source, selection: Region | null = null) {
  return { ...source, strokes: source.strokes.slice(), paper: { ...source.paper }, selection: selection ? { ...selection } : null, region: { ...(selection || { x: 0, y: 0, width: 1, height: 1 }) }, target: source.target ? { ...source.target } : null }
}

export async function rasterDrawing(snapshot: ReturnType<typeof snapshotDrawing>, withPaper: boolean, deps: any) {
  const { region, aspect, backdrop, strokes, paper } = snapshot, w = 1000, h = 1000 / aspect
  const canvas = deps.canvas();canvas.width = Math.max(1, Math.round(region.width * w));canvas.height = Math.max(1, Math.round(region.height * h))
  const ctx = canvas.getContext('2d'), sheet = { width: w, height: h }, area = { x: region.x * w, y: region.y * h, width: region.width * w, height: region.height * h }, size = { width: canvas.width, height: canvas.height }
  if (withPaper) deps.paintPaper(ctx, paper, sheet, area, size)
  if (backdrop) { const image = await deps.backdropReady(backdrop);if (image) deps.paintBackdrop(ctx, image, sheet, area, size) }
  ctx.save();ctx.scale(canvas.width / area.width, canvas.height / area.height);ctx.translate(-area.x, -area.y)
  deps.paintStrokes(ctx, strokes, (point: any) => ({ x: point.x * w, y: point.y * h }), 1, undefined, 0, withPaper ? (colour: string) => deps.inkOn(paper, colour) : undefined)
  ctx.restore();return canvas
}
