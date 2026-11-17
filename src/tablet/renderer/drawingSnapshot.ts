import type { InkStroke } from './tabletPage'
import { colourOfPaper, inkOn, paintPaper, parsePaper, type Paper } from './tabletPaper'

type Region = { x: number; y: number; width: number; height: number }
type Source = { name: string; aspect: number; strokes: InkStroke[]; backdrop?: string | null; paper: Paper; target?: any; viewport?: Region }

/** Committed strokes are immutable; retain their identities while freezing the export's sheet and selection. */
export function snapshotDrawing(source: Source, selection: Region | null = null) {
  return { ...source, strokes: source.strokes.slice(), paper: { ...source.paper }, selection: selection ? { ...selection } : null, region: { ...(selection || source.viewport || { x: 0, y: 0, width: 1, height: 1 }) }, target: source.target ? { ...source.target } : null }
}

const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Use the screen's paper painter, including its pixel alignment, for the inserted SVG's background. */
function paperSvg(paper: Paper, sheet: {width:number;height:number}, region: Region): string {
  const area = {x:region.x*sheet.width,y:region.y*sheet.height,width:region.width*sheet.width,height:region.height*sheet.height}
  const size = {width:Math.max(1,Math.round(area.width)),height:Math.max(1,Math.round(area.height))}
  const pieces:string[] = [], circles:string[] = []
  const context = {
    fillStyle: colourOfPaper(paper.colour).paper,
    setTransform() {},
    fillRect(x:number,y:number,width:number,height:number) {pieces.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${this.fillStyle}"/>`)},
    beginPath() {circles.length=0},
    moveTo() {},
    arc(x:number,y:number,radius:number) {circles.push(`<circle cx="${x}" cy="${y}" r="${radius}"/>`)},
    fill() {if(circles.length)pieces.push(`<g fill="${this.fillStyle}">${circles.join('')}</g>`)},
  }
  paintPaper(context as unknown as CanvasRenderingContext2D,paper,sheet,area,size)
  return `<g transform="translate(${area.x} ${area.y}) scale(${area.width/size.width} ${area.height/size.height})">${pieces.join('')}</g>`
}

/** The preview and editable payload describe the same sheet; paper is included unless explicitly omitted. */
export function svgDrawing(snapshot: ReturnType<typeof snapshotDrawing>, withPaper = true): string | null {
  const {region,aspect,backdrop,strokes} = snapshot
  if(!withPaper&&!strokes.length&&!backdrop)return null
  const w=1000,h=1000/aspect,paper=parsePaper(snapshot.paper)
  const paths=strokes.map(stroke=>stroke.points.map((point,index)=>{
    const previous=stroke.points[Math.max(0,index-1)],pressure=stroke.pressures?.[index]??.5
    const thickness=stroke.width*(.2+1.6*Math.max(0,Math.min(1,pressure))),colour=withPaper?inkOn(paper,stroke.colorHex):stroke.colorHex
    return `<path d="M${(previous.x*w).toFixed(2)} ${(previous.y*h).toFixed(2)} L${(point.x*w).toFixed(2)} ${(point.y*h).toFixed(2)}" fill="none" stroke="${attribute(colour)}" stroke-width="${thickness}" stroke-linecap="round"/>`
  }).join('')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${region.x*w} ${region.y*h} ${region.width*w} ${region.height*h}">${withPaper?paperSvg(paper,{width:w,height:h},region):''}${backdrop?`<image href="${attribute(backdrop)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`:''}${paths}</svg>`
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
