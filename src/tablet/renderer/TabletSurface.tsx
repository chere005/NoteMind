/**
 * The tablet as a source for the video pane: a sheet of paper in place of the camera's picture.
 *
 * Pen and mouse follow the Pen, Eraser and Select tools. Native pen samples arrive as PointerEvents on the same
 * path. Held side buttons override the tool: lower erases complete strokes, upper selects; double taps undo/redo.
 * In Select mode, drag outside the box to select, inside to move selected ink, or at a corner to resize it.
 * The mouse's right button temporarily selects, moves or resizes ink without changing the active tool.
 * The sheet's tools belong to penSettings `sheetTools`, independently of the document's drawing controls.
 *
 * Built to feel like a pad. Pointer events arrive far faster than frames, so every coalesced sample is kept (the
 * stroke's real shape) and the ink canvas is only touched once a frame, and then only for the segments that are
 * NEW. The canvas is `desynchronized` and sized in device pixels, so hairlines are crisp on a high-DPI screen.
 *
 * THE PAPER (tabletPaper.ts) is a second canvas UNDER the ink. It is never ink data: the strokes are fractions of
 * the sheet and know nothing of it. Palm rejection is the notes page's rule (`penNear`).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import { isBoxDrag, type Point, type Rect, type Size } from "@notemind/core"
import { holdBegins, inContact, penLifted, pressAction, resolvePress, slotOf, withNative } from "./penButtons"
import { penNear, penSettings, sheetPressSettings, useSheetTools } from "./penSettings"
import { setTabletUndo, watchSheetPen } from "./tabletFocus"
import {
  boxFromPoints, hitBox, moveBox, paintStrokes, resizeBox, SHEET_REF, strokeUnder,strokeUnderAsync,
  paintStrokesYielding,
  type BoxHandle, type BoxHit, type InkStroke, type TabletPage,
} from "./tabletPage"
import { backdropImage, backdropRect, paintBackdrop } from "./tabletBackdrop"
import { doubleClickBox } from "./doubleClickBox"
import { colourOfPaper, inkOn, paintPaper, usePaper, type Paper } from "./tabletPaper"
import { BoxActions, type BoxButtons } from "./BoxActions"
import { elementPoint, elementSize } from "./padCoordinates"
import { pagePixelSize, pointOnPage, pointOnView, rectOnView, UNIT_SHEET } from './sheetViewport'
import { canvasPng, type snapshotDrawing } from './drawingSnapshot'
import graphics from "../../graphics-pane.js"
import { InkRenderer } from './inkRenderer'
import {primeStrokeBox,knownStrokeBox} from '../../stroke-bounds.js'
import {transformDrawingInk} from '../../drawing-export.js'
import {beginInkMutation,pendingInkMutation,flushInkMutations,registerInkProjection,appendInkStroke,hasPendingInkMutations,createInkActionController,reserveInkStroke,capacityError} from '../../ink-mutations.js'
import {useInkSelection} from "./useInkSelection"
import {InkSelectionActions} from "./InkSelectionActions"
import {certifyFreshStroke,prepareFreshStroke} from "../../drawing-history.js"
import {lineStroke,constrainedEnd} from "../../ink-constraints.cjs"
import {usePrecisionView} from "./usePrecisionView"
import {PrecisionControls} from "./PrecisionControls"
import "./tablet.css"

export interface SurfaceHandle {
  undo(): void | Promise<void>
  redo(): void | Promise<void>
  clear(): void | Promise<void>
  /** Repaint everything (after the page was changed from outside). */
  repaint(): void
  selectedInk(): number
  deleteSelectedInk(): boolean
  clearInkSelection(): boolean
  /** Commit the current pen/selection gesture before taking an owned export snapshot. */
  flush(): void | Promise<void>
  /** The sheet's size on screen, in CSS pixels. */
  size(): Size
  /** A Bring in from the header: what it did is in the NOTE, so the next Ctrl+Z is the note's (as the box row's `leaveFor`). */
  leave(): void
  /** Freeze the displayed pixels before encoding, if they represent this exact immutable snapshot. */
  preview(snapshot: ReturnType<typeof snapshotDrawing>): Promise<string> | null
}

interface Props {
  page: TabletPage
  colour: string
  width: number
  /** The dashed box, in FRACTIONS of the sheet. */
  box: Rect | null
  /** The box changed (fractions of the sheet), or was taken away (null). */
  onBox(rect: Rect | null): void
  /** The page changed (a stroke, an erase, an undo): the buttons may need to update. */
  onEdited(owner?: TabletPage): void
  /** A sheet bound to an ink region (regionSheets.ts): the region, in FRACTIONS of the sheet. The rest is shaded and a stroke stops at its edge. */
  frame?: Rect | null
  /** The row of buttons under the box (BoxActions.tsx): Erase, Bring in Writing, Bring in as Drawing Region, Copy Region. */
  buttons?: BoxButtons | null
  /** A fixed reference page keeps its own visible paper independently of drawing preferences. */
  paperOverride?: Paper
}

/** How near a stroke the eraser has to be, in points. */
const ERASE_RADIUS = 8
/** A box smaller than this, either way, is a click. */
const MIN_BOX_PX = 8
/** Two clicks this close in time and place are a double click. */
const DOUBLE_MS = 450
const HANDLES: BoxHandle[] = ["nw", "ne", "sw", "se"]
const inkCounts=new WeakMap<object,number>()
const denseInk=(strokes:InkStroke[])=>{if(strokes.length>=2500)return true;let count=inkCounts.get(strokes);if(count===undefined){count=strokes.reduce((n,stroke)=>n+stroke.points.length,0);inkCounts.set(strokes,count)}return count>=50000}
const displayRatio=(size:Size,ratio:number)=>size.width>0&&size.height>0?Math.min(ratio,8192/size.width,8192/size.height,Math.sqrt(16*1024*1024)/Math.sqrt(size.width)/Math.sqrt(size.height)):ratio

type DeferredInput={pointerId:number;page:TabletPage;action:'erase'|'select';points:{unit:Point;raw:Point;px:Point}[];origin:Rect|null;view:Rect;pixelSize:Size;unit:number;ended:boolean;cancelled:boolean;done:Promise<void>;resolve:()=>void;reject:(error:any)=>void;rejectProject:(error:any)=>void;project:(map:any)=>void;release:()=>void;barrier:Promise<void>;started:boolean;marked:boolean;dragged:boolean;replacements:Map<InkStroke,InkStroke|null>;controller:AbortController;erased:InkStroke[];lastSample?:Point}

type Gesture = { pointerId: number } & (
  // A stroke and an erase belong to the sheet they began on (a key can open another tab while the pen is down).
  // `out`: on a sheet bound to a drawing region, the pen left the region: the stroke was made up to its edge, and a new one
  // begins where it comes back in (nothing is drawn outside the region, nothing is pinned to its border).
  | { kind: "draw"; stroke: InkStroke; drawn: number; pen: boolean; page: TabletPage; reservation:ReturnType<typeof reserveInkStroke>;constraint?:{enabled:boolean;stepDegrees?:number;metric:Point;frame?:Rect|null};full?:boolean;out?: boolean;bounds:{x:number;y:number;right:number;bottom:number} }
  | { kind: "erase"; marked: boolean; page: TabletPage }
  | {
    kind: "box"; mode: "new" | "move" | "resize"
    startPx: Point; start: Point; origin: Rect | null; handle: BoxHandle | null; dragged: boolean; page: TabletPage; strokes: InkStroke[]
    next?: Rect; waiting?: string; preview?: { width: number; height: number; paper: string; fixed: HTMLCanvasElement; ink: HTMLCanvasElement; inkBounds?:Rect }
  }
)

const CURSORS: Record<Exclude<BoxHit, null>, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", inside: "move",
}

export const TabletSurface = forwardRef<SurfaceHandle, Props>(function TabletSurface(
  { page, colour, width, box, onBox, onEdited, frame: regionBox = null, buttons = null, paperOverride }, handle) {
  const host = useRef<HTMLDivElement | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState({ x: 0, y: 0, width: 0, height: 0, viewport: { ...UNIT_SHEET } })
  /** A backdrop picture finished loading: the paper canvas is painted again. */
  const [backdropTick, setBackdropTick] = useState(0)
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1))
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const lineCanvas = useRef<HTMLCanvasElement | null>(null)
  const bindLineCanvas=useCallback((node:HTMLCanvasElement|null)=>{const old=lineCanvas.current;if(old&&old!==node)old.width=old.height=1;lineCanvas.current=node},[])
  const pendingLines = useRef(new Map<InkStroke,{page:TabletPage;preview:InkStroke}>())
  const backdrop = useRef<HTMLCanvasElement | null>(null)
  // The visible sheet owns its image independently of the bounded shared LRU.
  const loadedBackdrop = useRef<{file:string;image:HTMLImageElement}|null>(null)
  const paintedPaper = useRef<{backdrop:string|null;paper:string;viewport:Rect}|null>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const size = useRef<Size>({ width: 0, height: 0 })
  const viewport = useRef<Rect>({ ...UNIT_SHEET })
  const gesture = useRef<Gesture | null>(null)
  const finishGesture = useRef<() => void>(() => {})
  const committingStroke = useRef(false)
  const actionQueue = useRef<Promise<void>>(Promise.resolve())
  const actionControllers = useRef(new WeakMap<TabletPage,ReturnType<typeof createInkActionController>>())
  const deferredInputs = useRef<DeferredInput[]>([])
  const replaying = useRef(false)
  const pendingStrokes = useRef(new Map<TabletPage,Set<InkStroke>>())
  const fullPages = useRef(new WeakSet<TabletPage>())
  const canvasView = useRef<{page:TabletPage;region:Rect}|null>(null)
  /** The box is being dragged, moved or resized: its row of buttons waits until it is let go. */
  const [boxing, setBoxing] = useState(false)
  /** The last click that began and ended in one place, and the box there was when it was made (a double click's first click clears it). */
  const lastClick = useRef<{ time: number; x: number; y: number; box: Rect | null } | null>(null)
  const frame = useRef<number | null>(null)
  const everything = useRef(true)
  const raster = useRef<InkRenderer|null>(null)
  const rasterPending = useRef(false)
  const paintVersion = useRef(0)
  const paintedInk = useRef<{page:TabletPage;strokes:InkStroke[];key:string}|null>(null)
  const inkOwner = useRef<TabletPage|null>(null)
  const extraDirty = useRef<Rect[]>([])
  const lastDense = useRef(false)
  // The sheet's OWN Erase / Select (the pen's Erase Tool toggle, the header's Select), never the document toolbar's (penSettings.ts).
  const tools = useSheetTools()
  const rememberedPaper = usePaper(),paper = paperOverride||rememberedPaper
  const latest = useRef({ colour, width, onBox, onEdited, page, box, paper, regionBox })
  latest.current = { colour, width, onBox, onEdited, page, box, paper, regionBox }

  useEffect(()=>()=>{paintVersion.current++;raster.current?.dispose();raster.current=null},[])

  useEffect(() => {
    const finish = () => finishGesture.current()
    window.addEventListener('camera-flush', finish)
    return () => window.removeEventListener('camera-flush', finish)
  }, [])

  const toPixel = useCallback((point: Point): Point => {
    const shown = pointOnView(point, viewport.current)
    return { x: shown.x * size.current.width, y: shown.y * size.current.height }
  }, [])

  const pageSize = () => pagePixelSize(size.current, viewport.current)

  /** Pixels per reference unit: a stroke's width is kept in units of the sheet, not of the screen. */
  const unit = () => pageSize().width / SHEET_REF
  /** How a stroke's colour looks on this paper. */
  const tint = (hex: string): string => inkOn(latest.current.paper, hex)
  const rasterConfig=()=>{const ratio=displayRatio(size.current,canvas.current?.ownerDocument.defaultView?.devicePixelRatio||1);return {width:Math.max(1,Math.floor(size.current.width*ratio)),height:Math.max(1,Math.floor(size.current.height*ratio)),paintWidth:size.current.width*ratio,paintHeight:size.current.height*ratio,ratio,region:{...viewport.current},paper:{...latest.current.paper}}}
  const rasterKey=()=>{const config=rasterConfig();return JSON.stringify([config.width,config.height,config.paintWidth,config.paintHeight,config.ratio,config.region,config.paper.colour])}
  const releasePreview=(g:Extract<Gesture,{kind:'box'}>)=>{if(g.preview){g.preview.fixed.width=g.preview.ink.width=1;g.preview.fixed.height=g.preview.ink.height=1;g.preview=undefined}}
  const restorePreview=(g:Extract<Gesture,{kind:'box'}>)=>{const preview=g.preview,element=canvas.current;if(!preview||!element||g.page!==latest.current.page||preview.paper!==rasterKey())return;const ctx=element.getContext('2d');if(!ctx)return;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,element.width,element.height);ctx.drawImage(preview.fixed,0,0);ctx.drawImage(preview.ink,0,0);const ratio=rasterConfig().ratio;ctx.setTransform(ratio,0,0,ratio,0,0);paintedInk.current={page:g.page,strokes:g.strokes,key:preview.paper}}
  const dirtyPreview=(g:Extract<Gesture,{kind:'box'}>)=>{if(!g.preview||!g.origin||!g.next)return;const bounds=g.preview.inkBounds||{x:0,y:0,width:g.preview.width,height:g.preview.height},from=toPixel(g.origin),to=toPixel(g.next),ratio=rasterConfig().ratio,sx=g.next.width/g.origin.width,sy=g.next.height/g.origin.height,tx=(to.x-from.x*sx)*ratio,ty=(to.y-from.y*sy)*ratio;extraDirty.current.push({x:tx+bounds.x*sx-3,y:ty+bounds.y*sy-3,width:bounds.width*sx+6,height:bounds.height*sy+6});if(extraDirty.current.length>32){const left=Math.min(...extraDirty.current.map(r=>r.x)),top=Math.min(...extraDirty.current.map(r=>r.y)),right=Math.max(...extraDirty.current.map(r=>r.x+r.width)),bottom=Math.max(...extraDirty.current.map(r=>r.y+r.height));extraDirty.current=[{x:left,y:top,width:right-left,height:bottom-top}]}}

  const reportCapacity=(owner:TabletPage)=>{if(fullPages.current.has(owner))return;fullPages.current.add(owner);reportError(capacityError())}
  const reportError=(error:any)=>{if(error?.name==='AbortError')return;const message=error?.message||'Could not finish the drawing change.';if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('notemind-drawing-error',{detail:message}));else console.error(message)}
  const transformSelection=(g:Extract<Gesture,{kind:'box'}>)=>{
    if(!g.next||!g.origin)return
    dirtyPreview(g);paintVersion.current++;paintedInk.current=null
    if(!denseInk(g.strokes)){g.page.replace(graphics.transform(g.strokes,g.origin,g.next));latest.current.onEdited(g.page);return}
    const from={...g.origin},to={...g.next},source=g.strokes
    try{const operation=beginInkMutation(g.page,(_strokes:any,signal:AbortSignal)=>transformDrawingInk(source,from,to,{signal}),{onCommit:()=>{if(g.page===latest.current.page)schedule(true);latest.current.onEdited(g.page)}});void operation.done.catch((error:any)=>{if(g.page===latest.current.page){schedule(true);latest.current.onBox(g.origin)}reportError(error)})}catch(error){restorePreview(g);latest.current.onBox(g.origin);reportError(error)}
  }

  const linePreview=(g:Extract<Gesture,{kind:'draw'}>):InkStroke=>{const stroke=g.stroke,first=stroke.points[0]!,last=stroke.points.at(-1)!,target=constrainedEnd(first,last,{stepDegrees:g.constraint?.stepDegrees,metric:g.constraint?.metric,frame:g.constraint?.frame});return{colorHex:stroke.colorHex,width:stroke.width,points:stroke.points.length===1?[first]:[first,target],...(stroke.pressures?{pressures:stroke.points.length===1?[stroke.pressures[0]!]:[stroke.pressures[0]!,stroke.pressures.at(-1)!]}:{})}}

  const paint = useCallback(() => {
    frame.current = null
    const element = canvas.current
    if (!element || size.current.width <= 0 || size.current.height <= 0) return
    const ratio = displayRatio(size.current,element.ownerDocument.defaultView?.devicePixelRatio || 1)
    const w = Math.floor(size.current.width * ratio), h = Math.floor(size.current.height * ratio)
    const previous=canvasView.current,currentView=viewport.current,currentPage=latest.current.page,ownerChanged=!!previous&&previous.page!==currentPage,viewChanged=!!previous&&(previous.region.x!==currentView.x||previous.region.y!==currentView.y||previous.region.width!==currentView.width||previous.region.height!==currentView.height),resized=element.width!==w||element.height!==h
    let retained:HTMLCanvasElement|null=null
    if(!ownerChanged&&previous&&(resized||viewChanged)&&element.width&&element.height){retained=element.ownerDocument.createElement('canvas');retained.width=element.width;retained.height=element.height;retained.getContext('2d')?.drawImage(element,0,0)}
    if(resized){element.width=w;element.height=h}
    if(ownerChanged||resized||viewChanged){const target=element.getContext('2d',{desynchronized:true});if(target){target.setTransform(1,0,0,1,0,0);target.clearRect(0,0,w,h);if(retained&&previous){const old=previous.region;target.drawImage(retained,(old.x-currentView.x)/currentView.width*w,(old.y-currentView.y)/currentView.height*h,old.width/currentView.width*w,old.height/currentView.height*h)}}everything.current=true;paintedInk.current=null;paintVersion.current++;if(ownerChanged)inkOwner.current=null}
    if(retained){retained.width=retained.height=1}canvasView.current={page:currentPage,region:{...currentView}}
    context.current ??= element.getContext("2d", { desynchronized: true })
    const ctx = context.current
    const previewLayer=lineCanvas.current,liveLine=gesture.current;let needsPreview=liveLine?.kind==='draw'&&liveLine.constraint?.enabled&&!liveLine.out;for(const item of pendingLines.current.values())if(item.page===latest.current.page){needsPreview=true;break}
    if(previewLayer&&needsPreview){if(previewLayer.width!==w)previewLayer.width=w;if(previewLayer.height!==h)previewLayer.height=h;const previewContext=previewLayer.getContext('2d');if(previewContext){previewContext.setTransform(ratio,0,0,ratio,0,0);previewContext.clearRect(0,0,size.current.width,size.current.height);for(const item of pendingLines.current.values())if(item.page===latest.current.page)paintStrokes(previewContext,[item.preview],toPixel,unit(),undefined,0,tint);if(liveLine?.kind==='draw'&&liveLine.constraint?.enabled&&!liveLine.out)paintStrokes(previewContext,[linePreview(liveLine)],toPixel,unit(),undefined,0,tint)}}else if(previewLayer&&(previewLayer.width!==1||previewLayer.height!==1)){previewLayer.width=previewLayer.height=1}
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const g = gesture.current
    if (g?.kind === "box" && g.dragged && g.origin && g.next) {
      const paperKey = rasterKey()
      if (!g.preview || g.preview.width !== w || g.preview.height !== h || g.preview.paper !== paperKey) {
        if(denseInk(g.strokes)&&g.waiting===paperKey)return
        releasePreview(g)
        const fixed = element.ownerDocument.createElement("canvas"), ink = element.ownerDocument.createElement("canvas")
        fixed.width = ink.width = w; fixed.height = ink.height = h
        const held=paintedInk.current,base=held?.page===g.page&&held.strokes===g.strokes&&held.key===paperKey
        if(denseInk(g.strokes)){
          const fixedContext=fixed.getContext('2d')!,extent=g.page.extent,all=base&&g.origin.x<=extent.x&&g.origin.y<=extent.y&&g.origin.x+g.origin.width>=extent.x+extent.width&&g.origin.y+g.origin.height>=extent.y+extent.height
          if(all){ink.getContext('2d')!.drawImage(element,0,0);g.preview={width:w,height:h,paper:paperKey,fixed,ink,inkBounds:{x:0,y:0,width:w,height:h}}}
          else{
            if(base)fixedContext.drawImage(element,0,0)
            g.waiting=paperKey;let adopted=false;raster.current ||=new InkRenderer()
            const valid=()=>gesture.current===g&&g.page===latest.current.page&&g.strokes===g.page.strokes&&paperKey===rasterKey()
            const adopt=(result:any)=>{if(!valid()||!result.preview)return false;const preview=result.preview;if(preview.clear)fixedContext.clearRect(0,0,w,h);for(const tile of preview.fixed){fixedContext.clearRect(tile.x,tile.y,tile.width,tile.height);fixedContext.drawImage(tile.bitmap,tile.x,tile.y,tile.width,tile.height)}if(preview.ink)ink.getContext('2d')!.drawImage(preview.ink.bitmap,preview.ink.x,preview.ink.y,preview.ink.width,preview.ink.height);adopted=true;g.waiting=undefined;g.preview={width:w,height:h,paper:paperKey,fixed,ink,inkBounds:preview.ink?{x:preview.ink.x,y:preview.ink.y,width:preview.ink.width,height:preview.ink.height}:undefined};schedule();return false}
            raster.current.request({page:g.page,strokes:g.strokes,aspect:g.page.aspect,config:rasterConfig(),selection:g.origin,previewBase:base},adopt,async()=>{
              const chosen:InkStroke[]=[],remaining:InkStroke[]=[];let count=0
              for(const stroke of g.strokes){if(!valid())return;(graphics.selected(stroke,g.origin)?chosen:remaining).push(stroke);if(++count%8192===0)await graphics.yieldTask()}
              fixedContext.clearRect(0,0,w,h);const fc=fixed.getContext('2d')!,ic=ink.getContext('2d')!;fc.scale(ratio,ratio);ic.scale(ratio,ratio)
              if(!await paintStrokesYielding(fc,remaining,toPixel,unit(),undefined,0,tint,{cancelled:()=>!valid(),yieldControl:graphics.yieldTask}))return
              if(!await paintStrokesYielding(ic,chosen,toPixel,unit(),undefined,0,tint,{cancelled:()=>!valid(),yieldControl:graphics.yieldTask}))return
              if(valid()){adopted=true;g.waiting=undefined;g.preview={width:w,height:h,paper:paperKey,fixed,ink,inkBounds:{x:0,y:0,width:w,height:h}};schedule()}
            },()=>{if(!adopted){fixed.width=ink.width=1;fixed.height=ink.height=1;if(g.waiting===paperKey)g.waiting=undefined}})
            return
          }
        }else{
        const fixedContext = fixed.getContext("2d")!, inkContext = ink.getContext("2d")!
        fixedContext.scale(ratio, ratio); inkContext.scale(ratio, ratio)
        const chosen: InkStroke[] = [], remaining: InkStroke[] = []
        for (const stroke of g.strokes) (graphics.selected(stroke, g.origin) ? chosen : remaining).push(stroke)
        paintStrokes(fixedContext, remaining, toPixel, unit(), undefined, 0, tint)
        paintStrokes(inkContext, chosen, toPixel, unit(), undefined, 0, tint)
        g.preview = { width: w, height: h, paper: paperKey, fixed, ink,inkBounds:{x:0,y:0,width:w,height:h} }
        }
      }
      paintedInk.current=null
      ctx.clearRect(0, 0, size.current.width, size.current.height)
      ctx.drawImage(g.preview.fixed, 0, 0, size.current.width, size.current.height)
      const sx = g.next.width / g.origin.width, sy = g.next.height / g.origin.height
      const from = toPixel(g.origin), to = toPixel(g.next)
      ctx.save();ctx.translate(to.x - from.x * sx, to.y - from.y * sy);ctx.scale(sx, sy)
      ctx.drawImage(g.preview.ink, 0, 0, size.current.width, size.current.height);ctx.restore()
      return
    }
    if((pendingInkMutation(latest.current.page)||pendingStrokes.current.get(latest.current.page)?.size)&&everything.current){
      if(g?.kind==='draw'&&!g.constraint?.enabled&&!g.out&&g.stroke.points.length>g.drawn){paintStrokes(ctx,[g.stroke],toPixel,unit(),undefined,g.drawn,tint);g.drawn=g.stroke.points.length}
      return
    }
    if (everything.current) {
      everything.current = false
      const current=latest.current.page,key=rasterKey(),version=++paintVersion.current
      if(denseInk(current.strokes)){
        const forceFull=!lastDense.current||inkOwner.current!==current,dirtyCount=extraDirty.current.length
        if(inkOwner.current!==current){ctx.clearRect(0,0,size.current.width,size.current.height);extraDirty.current=[]}inkOwner.current=current
        lastDense.current=true;rasterPending.current=true;raster.current ||= new InkRenderer()
        raster.current.request({page:current,strokes:current.strokes,aspect:current.aspect,config:rasterConfig(),forceFull,extraDirty:extraDirty.current},(result,scene)=>{
          if(version!==paintVersion.current||latest.current.page!==current||current.strokes!==scene.strokes||key!==rasterKey()||gesture.current?.kind==='draw'||gesture.current?.kind==='box'||pendingInkMutation(current)||pendingStrokes.current.get(current)?.size)return false
          ctx.setTransform(1,0,0,1,0,0)
          for(const tile of result.tiles){ctx.clearRect(tile.x,tile.y,tile.width,tile.height);ctx.drawImage(tile.bitmap,tile.x,tile.y,tile.width,tile.height)}
          ctx.setTransform(ratio,0,0,ratio,0,0);paintedInk.current={page:current,strokes:scene.strokes,key};rasterPending.current=false;extraDirty.current.splice(0,dirtyCount);return true
        },async(_error,scene,owned)=>{
          const valid=()=>owned()&&version===paintVersion.current&&latest.current.page===current&&current.strokes===scene.strokes&&key===rasterKey()&&!gesture.current
          if(!valid())return;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,size.current.width,size.current.height)
          const complete=await paintStrokesYielding(ctx,scene.strokes,toPixel,unit(),undefined,0,tint,{cancelled:()=>!valid(),yieldControl:graphics.yieldTask})
          if(complete&&valid()){paintedInk.current={page:current,strokes:scene.strokes,key};rasterPending.current=false;extraDirty.current.splice(0,dirtyCount)}
        })
        if(g?.kind==='draw'&&!g.constraint?.enabled&&!g.out&&g.stroke.points.length>g.drawn){paintStrokes(ctx,[g.stroke],toPixel,unit(),undefined,g.drawn,tint);g.drawn=g.stroke.points.length}
        return
      }
      raster.current?.dispose();raster.current=null;rasterPending.current=false;lastDense.current=false
      inkOwner.current=current;extraDirty.current=[]
      ctx.clearRect(0, 0, element.width, element.height)
      paintStrokes(ctx, latest.current.page.strokes, toPixel, unit(), undefined, 0, tint)
      // A stroke under the pen is repainted whole after a resize or an erase.
      if (g?.kind === "draw" && !g.constraint?.enabled && !g.out) {
        paintStrokes(ctx, [g.stroke], toPixel, unit(), undefined, 0, tint)
        g.drawn = g.stroke.points.length
      }
      paintedInk.current={page:current,strokes:current.strokes,key}
      return
    }
    if (g?.kind === "draw" && !g.constraint?.enabled && g.stroke.points.length > g.drawn) {
      // Only the segments that are new since the last frame.
      paintStrokes(ctx, [g.stroke], toPixel, unit(), undefined, g.drawn, tint)
      g.drawn = g.stroke.points.length
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tint` reads the latest paper through the ref
  }, [toPixel])

  const schedule = useCallback((full = false) => {
    if (full) everything.current = true
    if (frame.current === null) frame.current = requestAnimationFrame(paint)
  }, [paint])

  const commitStrokeNow=(g:Extract<Gesture,{kind:'draw'}>)=>{
    if(!knownStrokeBox(g.stroke))primeStrokeBox(g.stroke,g.bounds)
    const before=g.page.strokes
    committingStroke.current=true
    try{g.page.add(g.stroke)}finally{committingStroke.current=false}
    const held=paintedInk.current
    if(g.page===latest.current.page&&g.drawn===g.stroke.points.length&&held?.page===g.page&&held.strokes===before&&held.key===rasterKey())paintedInk.current={...held,strokes:g.page.strokes}
    if(g.page===latest.current.page&&denseInk(g.page.strokes))schedule(true)
  }

  const commitStroke=(g:Extract<Gesture,{kind:'draw'}>)=>{
    primeStrokeBox(g.stroke,g.bounds)
    const owned={...g},source=g.stroke,owner=g.page;let pending=false
    if(g.constraint?.enabled)pendingLines.current.set(source,{page:owner,preview:linePreview(g)})
    const completed=()=>{const held=pendingStrokes.current.get(owner);held?.delete(source);pendingLines.current.delete(source);if(held&&!held.size)pendingStrokes.current.delete(owner);if(pending){if(owner===latest.current.page)schedule(true);latest.current.onEdited(owner)}}
    try{const done=appendInkStroke(owner,owned.stroke,{nativeCanonical:true,reservation:owned.reservation,prepare:g.constraint?.enabled?(stroke,options)=>prepareFreshStroke(stroke,value=>lineStroke(value,{...options,stepDegrees:g.constraint!.stepDegrees,metric:g.constraint!.metric,frame:g.constraint!.frame})):undefined,commit:candidate=>{owned.stroke=candidate;if(g.constraint?.enabled){owned.drawn=0;commitStrokeNow(owned);if(owner===latest.current.page)schedule(true)}else commitStrokeNow(owned)},onCommit:completed});if(done){pending=true;let held=pendingStrokes.current.get(owner);if(!held)pendingStrokes.current.set(owner,held=new Set());held.add(owned.stroke);paintVersion.current++;void done.catch(error=>{completed();reportError(error)})}}catch(error){pendingLines.current.delete(source);if(owner===latest.current.page)schedule(true);reportError(error)}
  }

  const controllerFor=(owner:TabletPage)=>{
    let controller=actionControllers.current.get(owner);const callbacks={repaint:()=>{if(owner===latest.current.page)schedule(true)},onEdited:()=>latest.current.onEdited(owner),onError:reportError}
    if(!controller){controller=createInkActionController(owner,callbacks);actionControllers.current.set(owner,controller)}else controller.attach(callbacks)
    return controller
  }
  useEffect(()=>()=>{actionControllers.current.get(page)?.detach()},[page])
  const inkSelect=useInkSelection({page,focusRoot:()=>wrap.current,pixelSize:pageSize,widthScale:unit,finish:()=>finishGesture.current(),onError:reportError,onEdited:owner=>{if(owner===latest.current.page)schedule(true);latest.current.onEdited(owner)}})


  const inkSelectionRef=useRef(inkSelect);inkSelectionRef.current=inkSelect
  const precision=usePrecisionView({page,focusRoot:()=>wrap.current,beforeChange:()=>finishGesture.current(),onError:reportError,onViewport:view=>{viewport.current=view;setFit({x:0,y:0,width:size.current.width,height:size.current.height,viewport:view});schedule(true)}})

  useEffect(() => {
    const element = host.current
    if (!element) return
    const view = element.ownerDocument.defaultView ?? window
    const measure = () => {
      const rect = elementSize(element)
      // All available paper is writable. Only the viewport expands: canonical ink and its history never stretch.
      const baseView = latest.current.page.fitViewport(rect)
      const sheetView = rect.width>0&&rect.height>0?precision.configure(baseView,rect,latest.current.page.aspect):baseView
      viewport.current = sheetView
      const box = { x: 0, y: 0, width: rect.width, height: rect.height, viewport: sheetView }
      size.current = { width: box.width, height: box.height }
      setFit((was) => (was.width === box.width && was.height === box.height
        && was.viewport.x === sheetView.x && was.viewport.y === sheetView.y && was.viewport.width === sheetView.width && was.viewport.height === sheetView.height ? was : box))
      setDpr(view.devicePixelRatio || 1)
      schedule(true)
    }
    measure()
    // The sheet's shape follows the tablet's orientation.
    const unlisten = latest.current.page.onChange(() => {
      if (committingStroke.current) return
      const current=gesture.current
      if(current?.kind==='box'&&current.page===latest.current.page&&current.page.strokes!==current.strokes){gesture.current=null;paintVersion.current++;restorePreview(current);releasePreview(current);setBoxing(false);latest.current.onBox(current.origin)}
      measure()
    })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The display's scale can change under the sheet (150% on one monitor, 100% on the next, a
    // zoom): the canvases are in device pixels, so they are measured again.
    view.addEventListener("resize", measure)
    let ratio: MediaQueryList | null = null
    const watchRatio = () => {
      ratio?.removeEventListener("change", onRatio)
      ratio = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`)
      ratio.addEventListener("change", onRatio)
    }
    const onRatio = () => { measure(); watchRatio() }
    watchRatio()
    return () => {
      finishGesture.current()
      unlisten()
      observer.disconnect()
      view.removeEventListener("resize", measure)
      ratio?.removeEventListener("change", onRatio)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    // Another sheet (a tab): listen to it and paint it whole. Its size is the same (every sheet has the tablet's shape).
  }, [schedule, page])

  // The paper, on its own canvas under the ink: painted when the paper, the sheet's size or the display's scale changes (never per stroke).
  useLayoutEffect(() => {
    const element = backdrop.current
    paintedPaper.current=null
    if (!element || fit.width <= 0 || fit.height <= 0) return
    const ratio=displayRatio({width:fit.width,height:fit.height},dpr),w = Math.max(1, Math.floor(fit.width * ratio)), h = Math.max(1, Math.floor(fit.height * ratio))
    if (element.width !== w || element.height !== h) { element.width = w; element.height = h }
    const ctx = element.getContext("2d")
    if (!ctx) return
    const units: Size = { width: SHEET_REF, height: SHEET_REF / page.aspect }
    const view = fit.viewport, area = { x: view.x * units.width, y: view.y * units.height, width: view.width * units.width, height: view.height * units.height }
    paintPaper(ctx, paper, units, area, { width: w, height: h }, ratio)
    // A picture sent here by Edit with Tablet is under the ink, on the paper (tabletBackdrop.ts).
    if(loadedBackdrop.current?.file!==page.backdrop)loadedBackdrop.current=null
    const file=page.backdrop
    const under=file?(loadedBackdrop.current?.image||backdropImage(file,image=>{if(latest.current.page.backdrop===file){loadedBackdrop.current={file,image};setBackdropTick(n=>n+1)}})):null
    if (under) paintBackdrop(ctx, under, units, area, { width: w, height: h })
    if(!page.backdrop||under)paintedPaper.current={backdrop:page.backdrop||null,paper:JSON.stringify([paper.kind,paper.spacing,paper.colour]),viewport:{...view}}
  }, [paper, page, page.backdrop, backdropTick, fit, dpr])
  // The ink's look follows the paper (dark paper lifts the default ink).
  useEffect(() => { schedule(true) }, [paper.colour, schedule])

  // Undo and redo, for the keys and for the buttons.
  const hovered = useRef(false)
  const act = useCallback((which: "undo" | "redo"): boolean => {
    const p = latest.current.page,available=which==='undo'?p.canUndo:p.canRedo
    if(!available&&!hasPendingInkMutations(p))return false
    finishGesture.current();actionQueue.current=controllerFor(p)[which]().then(()=>{}).catch(()=>{})
    return true
  }, [schedule])

  // The pen over the sheet's side of the pane (or last there): its double taps and ExpressKeys toggle the sheet's tools.
  useEffect(() => {
    const element = host.current
    return element ? watchSheetPen(element.closest(".camera") ?? element) : undefined
  }, [])

  /**
   * A Bring in from the box's row: what it did is in the NOTE, so the next Ctrl+Z is the note's (the row goes with the
   * box, and the sheet under the mouse is not "the pen over the sheet" until the pointer moves onto it again).
   */
  const leave = (): void => {
    hovered.current = false
    // The row goes from under a still pointer, and the browser then says it entered the sheet: that does not count.
    quietAt.current = lastAt.current
    if (wrap.current && wrap.current.contains(wrap.current.ownerDocument.activeElement)) wrap.current.blur()
  }
  const leaveFor = async (action: () => void | Promise<void>): Promise<void> => {
    leave()
    await action()
  }
  /** The last place a pointer was seen over the host (the sheet or the row), in client px. */
  const lastAt = useRef<Point | null>(null)
  /** Where the pointer was when a Bring in left the sheet: "entering" the sheet there is not the pointer moving onto it. */
  const quietAt = useRef<Point | null>(null)
  const enter = (event: { clientX: number; clientY: number }) => {
    const quiet = quietAt.current
    if (quiet && Math.hypot(event.clientX - quiet.x, event.clientY - quiet.y) < 3) return
    quietAt.current = null
    hovered.current = true
  }

  useEffect(() => {
    setTabletUndo((which, byPen) => {
      const focused = !byPen && wrap.current !== null && wrap.current.contains(wrap.current.ownerDocument.activeElement)
      return (hovered.current || focused) ? act(which) : false
    })
    return () => setTabletUndo(null)
  }, [act])

  // Esc takes the box away (not from a text field, which keeps its Esc). It goes first and stops there, so it
  // does not also let go of the pen feed.
  const hasBox = box !== null
  useEffect(() => {
    if (!hasBox) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const active = wrap.current?.ownerDocument.activeElement as HTMLElement | null
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return
      event.preventDefault()
      event.stopPropagation()
      const g=gesture.current
      if(g?.kind==='box'){paintVersion.current++;gesture.current=null;if(g.page.strokes===g.strokes)restorePreview(g);releasePreview(g);for(const owner of [wrap.current,host.current]){try{if(owner?.hasPointerCapture(g.pointerId))owner.releasePointerCapture(g.pointerId)}catch{}}setBoxing(false);schedule(true)}
      for(const input of deferredInputs.current)if(input.action==='select'&&!input.cancelled){input.cancelled=true;input.ended=true;input.controller.abort()}
      void drainInputs();lastClick.current=null;latest.current.onBox(null)
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [hasBox])

  useImperativeHandle(handle, () => ({
    undo: () => { act("undo");return actionQueue.current },
    redo: () => { act("redo");return actionQueue.current },
    clear: () => { const p=latest.current.page;finishGesture.current();return controllerFor(p).clear() },
    repaint: () => schedule(true),
    selectedInk:()=>inkSelectionRef.current.controller.count,
    deleteSelectedInk:()=>{const selection=inkSelectionRef.current;if(!selection.controller.count)return false;void selection.run({type:'delete'});return true},
    clearInkSelection:()=>{const selection=inkSelectionRef.current;if(!selection.controller.count)return false;selection.clear();return true},
    flush: () => {finishGesture.current();return flushInkMutations(latest.current.page)||undefined},
    size: () => size.current,
    leave,
    preview: snapshot => {
      const current=latest.current,ink=canvas.current,paperLayer=backdrop.current,shown=viewport.current,painted=paintedPaper.current
      const ready=paintedInk.current
      if(!ink||!paperLayer||gesture.current||pendingStrokes.current.get(current.page)?.size||!ready||ready.page!==current.page||ready.strokes!==current.page.strokes||ready.key!==rasterKey()||snapshot.aspect!==current.page.aspect
        ||snapshot.backdrop!==current.page.backdrop||snapshot.strokes.length!==current.page.strokes.length
        ||snapshot.strokes.some((stroke,index)=>stroke!==current.page.strokes[index])
        ||snapshot.paper.kind!==current.paper.kind||snapshot.paper.spacing!==current.paper.spacing||snapshot.paper.colour!==current.paper.colour
        ||!painted||painted.backdrop!==(snapshot.backdrop||null)||painted.paper!==JSON.stringify([snapshot.paper.kind,snapshot.paper.spacing,snapshot.paper.colour])
        ||painted.viewport.x!==shown.x||painted.viewport.y!==shown.y||painted.viewport.width!==shown.width||painted.viewport.height!==shown.height)return null
      const region=snapshot.region,sx=(region.x-shown.x)/shown.width,sy=(region.y-shown.y)/shown.height,sw=region.width/shown.width,sh=region.height/shown.height
      if(![sx,sy,sw,sh].every(Number.isFinite)||sx< -1e-9||sy< -1e-9||sw<=0||sh<=0||sx+sw>1+1e-9||sy+sh>1+1e-9)return null
      const rawWidth=ink.width*sw,rawHeight=ink.height*sh,scale=Math.min(1,4096/Math.max(rawWidth,rawHeight),Math.sqrt(4*1024*1024)/Math.sqrt(rawWidth)/Math.sqrt(rawHeight))
      const copy=ink.ownerDocument.createElement('canvas');copy.width=Math.max(1,Math.floor(rawWidth*scale));copy.height=Math.max(1,Math.floor(rawHeight*scale));const ctx=copy.getContext('2d');if(!ctx)return null
      // Copy both layers now. Subsequent pen input or tab switches cannot change the encoded preview.
      for(const layer of [paperLayer,ink])ctx.drawImage(layer,sx*layer.width,sy*layer.height,sw*layer.width,sh*layer.height,0,0,copy.width,copy.height)
      return canvasPng(copy)
    },
  }), [act, schedule])

  /** `unit`: on the sheet (on a bound sheet, at the region's edge); `raw`: where it really is; `inside`: in the region (always, on a plain sheet). */
  const at = (event: { clientX: number; clientY: number }): { px: Point; unit: Point; raw: Point; inside: boolean } => {
    const rect = elementPoint(wrap.current!, event)
    const x = rect.x, y = rect.y
    // A stroke that strays past the edge (the pen is captured) stops at the sheet's edge.
    const clamp = (value: number, from = 0, to = 1) => Math.min(to, Math.max(from, value))
    // On a sheet bound to a region, at the region's edge.
    const f = latest.current.regionBox ?? viewport.current
    const raw = pointOnPage({ x: x / Math.max(1, rect.width), y: y / Math.max(1, rect.height) }, viewport.current)
    const e = 1e-6
    return {
      px: { x, y },
      unit: { x: clamp(raw.x, f.x, f.x + f.width), y: clamp(raw.y, f.y, f.y + f.height) },
      raw,
      inside: !latest.current.regionBox
        || (raw.x >= f.x - e && raw.x <= f.x + f.width + e && raw.y >= f.y - e && raw.y <= f.y + f.height + e),
    }
  }

  const eraseAt = (g: Extract<Gesture, { kind: "erase" }>, point: Point) => {
    const p = g.page
    const index = strokeUnder(p.strokes, point, pageSize(), ERASE_RADIUS, unit())
    if (index < 0) return
    if (!g.marked) { p.mark(); g.marked = true }
    p.removeAt(index)
    schedule(true)
  }

  const drainInputs=async()=>{
    if(replaying.current)return;replaying.current=true
    try{while(deferredInputs.current[0]&&(deferredInputs.current[0]!.ended||deferredInputs.current[0]!.action==='erase')){
      const input=deferredInputs.current[0]!,replacements=input.replacements;let complete=false
      try{
        if(!input.started){await input.barrier;const previous=pendingInkMutation(input.page);if(previous)await previous.done;input.started=true}
        if(input.action==='erase'){
          while(input.points.length&&!input.cancelled){const samples=input.points.splice(0,2)
            for(const point of samples){for(;;){if(input.cancelled)break;const before=input.page.strokes,index=denseInk(before)?await strokeUnderAsync(before,point.unit,input.pixelSize,ERASE_RADIUS,input.unit,{signal:input.controller.signal,yieldControl:graphics.yieldTask}):strokeUnder(before,point.unit,input.pixelSize,ERASE_RADIUS,input.unit);if(input.cancelled)break;if(before!==input.page.strokes)continue;if(index>=0){if(!input.marked){input.page.mark();input.marked=true}const did=await input.page.removeAtAsync(index,{signal:input.controller.signal,valid:()=>input.page.strokes===before,yieldControl:graphics.yieldTask});if(!did)continue;input.erased.push(before[index]!);if(input.page===latest.current.page)schedule(true)}break}}
            await graphics.yieldTask()
          }
          if(!input.ended&&!input.cancelled)break
          if(input.marked)latest.current.onEdited(input.page)
        }else if(!input.cancelled){
          const first=input.points[0],last=input.points[input.points.length-1],origin=input.origin,hit=origin?hitBox(origin,first.unit,input.pixelSize):null,dragged=input.dragged
          if(dragged&&origin&&hit){const target=hit==='inside'?moveBox(origin,last.unit.x-first.unit.x,last.unit.y-first.unit.y,input.view):resizeBox(origin,hit as BoxHandle,last.unit,input.pixelSize,MIN_BOX_PX,input.view)
            if(denseInk(input.page.strokes)){let applied:Map<InkStroke,InkStroke|null>|null=null;const op=beginInkMutation(input.page,async(strokes:any,signal:AbortSignal)=>{applied=await transformDrawingInk(strokes,origin,target,{signal});return applied},{onCommit:()=>latest.current.onEdited(input.page)});const cancel=()=>op.cancel();input.controller.signal.addEventListener('abort',cancel,{once:true});try{await op.done;if(applied)for(const [a,b]of applied)replacements.set(a,b)}finally{input.controller.signal.removeEventListener('abort',cancel)}}
            else{const before=input.page.strokes,next=graphics.transform(before,origin,target);before.forEach((stroke,index)=>{if(stroke!==next[index])replacements.set(stroke,next[index]!)});input.page.replace(next);latest.current.onEdited(input.page)}
            if(input.page===latest.current.page)latest.current.onBox(target)
          }else if(input.page===latest.current.page){const made=boxFromPoints(first.unit,last.unit);latest.current.onBox(dragged&&made.width*input.pixelSize.width>MIN_BOX_PX&&made.height*input.pixelSize.height>MIN_BOX_PX?made:null)}
        }
        input.project(input.action==='erase'?{eraseOccurrences:input.erased}:replacements);if(input.page===latest.current.page)schedule(true);complete=true
      }catch(error){if(input.cancelled)input.project(input.action==='erase'?{eraseOccurrences:input.erased}:replacements);else{input.rejectProject(error);input.reject(error);reportError(error)}complete=true}finally{if(complete){if(deferredInputs.current[0]===input)deferredInputs.current.shift();input.resolve();input.release()}}
    }}finally{replaying.current=false;const input=deferredInputs.current[0];if(input&&(input.ended||input.action==='erase'&&input.points.length))void drainInputs()}
  }
  const pendingInput=(event:PointerEvent)=>deferredInputs.current.find(input=>!input.ended&&input.pointerId===event.pointerId)
  const rememberInput=(input:DeferredInput,event:PointerEvent)=>{
    const samples=event.getCoalescedEvents?.()||[],all=samples.length?samples:[event]
    if(input.action==='erase'&&input.points.length+all.length>8192){input.cancelled=true;input.ended=true;input.controller.abort();reportError(Error('The pending pen gesture is too long. Please repeat it after the drawing finishes moving.'));void drainInputs();return}
    for(const sample of all){const point=at(sample),canonical={...point,unit:latest.current.regionBox?point.raw:point.unit};if(input.action==='select'&&input.points.length){const first=input.points[0];input.dragged ||=isBoxDrag(point.px.x-first.px.x,point.px.y-first.px.y);input.points[1]=canonical}else input.points.push(canonical);input.lastSample=canonical.unit}
    if(input.action==='erase')void drainInputs()
  }

  /** The pen touched the sheet at its last event: a hold begins only where a touch begins (penButtons.holdBegins). */
  const touching = useRef(false)

  const down = (event: PointerEvent) => {
    if (event.pointerType === "touch" && penNear()) { event.preventDefault(); return }
    const pen = event.pointerType === "pen"
    if (pen) touching.current = inContact(event)
    if (precision.pendingGesture()||inkSelect.pendingGesture()||pendingInput(event)||deferredInputs.current.some(input=>!input.ended&&input.pointerId!==event.pointerId)||gesture.current && gesture.current.pointerId !== event.pointerId) return
    if (!pen && event.button !== 0 && !(event.pointerType === "mouse" && event.button === 2)) return
    event.preventDefault()
    const press=resolvePress(event,sheetPressSettings());let action=press.kind;if(precision.panArmed&&!slotOf(withNative(event))&&!event.ctrlKey&&!event.metaKey)action='pan'
    // Nothing to do here: a side button pressed in the air (its double tap is the runtime's, penActions.ts), or Pan.
    if (action === "ignore") return
    wrap.current?.focus({ preventScroll: true })
    // Keep the gesture when the pointer strays past the edge (a synthetic event has no pointer to capture: the feed keeps the target itself).
    try { wrap.current?.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
    // Pen and mouse both follow the active drawing tool.
    const { px, unit: point, raw, inside } = at(event)
    if(action==='pan'){precision.beginPan(event,px);return}
    // A bound sheet: the shaded margin round the region takes no stroke.
    if (action === "draw" && !inside) return
    if(action==='select'&&!latest.current.box&&!(event.pointerType==='mouse'&&(event.button===2||(event.buttons&2)!==0))){if(inkSelect.begin(event,{point:latest.current.regionBox?raw:point,px},press)){latest.current.onBox(null);return}}
    if(action==='select'&&event.pointerType==='mouse'&&(event.button===2||(event.buttons&2)!==0))inkSelect.clear()
    if((action==='erase'||action==='select')&&(action==='erase'&&denseInk(latest.current.page.strokes)||hasPendingInkMutations(latest.current.page)||deferredInputs.current.length)){
      if(deferredInputs.current.length>=8){reportError(Error('Several pen gestures are still finishing. Please try again shortly.'));return}
      let resolve!:()=>void,reject!:(error:any)=>void,rejectProject!:(error:any)=>void,project!:(map:any)=>void;const done=new Promise<void>((a,b)=>{resolve=a;reject=b}),ready=new Promise<any>((a,b)=>{project=a;rejectProject=b});ready.catch(()=>{});done.catch(()=>{});const barrier=flushInkMutations(latest.current.page)||Promise.resolve();registerInkProjection(latest.current.page,ready,done,{capture:()=>{const cutoff=input.erased.length;return ready.then(projection=>action==='erase'?{eraseOccurrences:projection.eraseOccurrences.slice(cutoff)}:projection)}});
      const input:DeferredInput={erased:[],controller:new AbortController(),started:false,marked:false,dragged:false,replacements:new Map(),barrier,done,resolve,reject,rejectProject,project,release:latest.current.page.retainGeometry(),pointerId:event.pointerId,page:latest.current.page,action,points:[],origin:latest.current.box?{...latest.current.box}:null,view:{...viewport.current},pixelSize:{...pageSize()},unit:unit(),ended:false,cancelled:false};deferredInputs.current.push(input);rememberInput(input,event);return
    }
    if (action === "erase") {
      const g: Gesture = { kind: "erase", pointerId: event.pointerId, marked: false, page: latest.current.page }
      gesture.current = g
      eraseAt(g, latest.current.regionBox ? raw : point)
    } else if (action === "select") {
      const current = latest.current.box
      const hit = current ? hitBox(current, point, pageSize()) : null
      const base = { kind: "box" as const, pointerId: event.pointerId, startPx: px, start: point, dragged: false, page: latest.current.page, strokes: latest.current.page.strokes }
      if (current && hit === "inside") gesture.current = { ...base, mode: "move", origin: current, handle: null }
      else if (current && hit && hit !== "inside") gesture.current = { ...base, mode: "resize", origin: current, handle: hit }
      else gesture.current = { ...base, mode: "new", origin: null, handle: null }
    } else {
      let reservation:ReturnType<typeof reserveInkStroke>;try{reservation=reserveInkStroke(latest.current.page);fullPages.current.delete(latest.current.page)}catch(error:any){if(error?.code==='NOTEMIND_INK_CAPACITY')reportCapacity(latest.current.page);else reportError(error);return}
      const pressure = event.pressure > 0 ? event.pressure : 0.5
      gesture.current = {
        reservation,constraint:{enabled:precision.line||event.shiftKey,stepDegrees:event.shiftKey?(precision.angle||15):precision.angle||undefined,frame:latest.current.regionBox?{...latest.current.regionBox}:null,metric:{x:Math.max(1,pageSize().width),y:Math.max(1,pageSize().height)}},kind: "draw", pointerId: event.pointerId, drawn: 0, pen, page: latest.current.page,bounds:{x:point.x,y:point.y,right:point.x,bottom:point.y},
        stroke: certifyFreshStroke({
          colorHex: latest.current.colour,
          width: latest.current.width * SHEET_REF / Math.max(1, pageSize().width),
          points: [point],
          ...(pen && penSettings().pressure ? { pressures: [pressure] } : {}),
        }),
      }
      schedule()
    }
  }

  const move = (event: PointerEvent) => {
    if(precision.active(event.pointerId)){if(event.pointerType==='pen'&&penLifted(event)){up(event);return}precision.movePan(event,at(event).px);return}
    if(inkSelect.active(event.pointerId)){if(event.pointerType==='pen'&&penLifted(event)){up(event);return}const all=event.getCoalescedEvents?.()||[];for(const sampleEvent of all.length?all:[event]){const sample=at(sampleEvent);inkSelect.move(event,{point:latest.current.regionBox?sample.raw:sample.unit,px:sample.px})}return}
    const deferred=pendingInput(event);if(deferred){if(event.pointerType==='pen'&&penLifted(event)){up(event);return}rememberInput(deferred,event);return}
    const g = gesture.current
    const was = touching.current
    if (event.pointerType === "pen") touching.current = inContact(event)
    // The pen may keep hovering while the mouse works through the sidebar mirror.
    // Only the pointer that began a gesture may move or finish it.
    if (g && g.pointerId !== event.pointerId) return
    if (event.pointerType === "pen") {
      // A side button held in the air, then the pen touches: its hold begins here (this touch is a pointermove).
      if (!g && holdBegins(was, event)) { down(event); return }
      // A pen gesture lasts while the pen touches: lifting it with a side button still held ends it.
      if (g && penLifted(event)) { up(event); return }
    }
    if (!g) {
      // The mouse over the box says what a drag would do.
      if (event.pointerType !== "pen" && wrap.current) {
        const current = latest.current.box
        const hit = current ? hitBox(current, at(event).unit, pageSize()) : null
        wrap.current.style.cursor = precision.panArmed?"grab":tools.eraser ? "crosshair" : hit ? CURSORS[hit] : "crosshair"
      }
      return
    }
    // A pen reports far more samples than frames: the coalesced ones are the real stroke.
    const samples = event.getCoalescedEvents?.() ?? []
    const all = samples.length > 0 ? samples : [event]
    if (g.kind === "draw") {
      for (const sample of all) {
        if(g.full)continue
        const here = at(sample)
        if (!here.inside && g.out) continue
        let accepted=false
        if (here.inside && g.out) {
          // Back in the region: a new stroke begins here.
          try{g.reservation=reserveInkStroke(g.page);accepted=true}catch(error:any){if(error?.code==='NOTEMIND_INK_CAPACITY'){g.full=true;reportCapacity(g.page)}else reportError(error);continue}
          const { points: _points, pressures, ...rest } = g.stroke
          g.stroke = certifyFreshStroke({ ...rest, points: [], ...(pressures ? { pressures: [] } : {}) })
          g.drawn = 0
          g.bounds={x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity}
          g.out = false
        }
        if(!accepted&&!g.reservation.accept()){g.full=true;reportCapacity(g.page);continue}
        g.stroke.points.push(here.unit)
        g.bounds.x=Math.min(g.bounds.x,here.unit.x);g.bounds.y=Math.min(g.bounds.y,here.unit.y);g.bounds.right=Math.max(g.bounds.right,here.unit.x);g.bounds.bottom=Math.max(g.bounds.bottom,here.unit.y)
        g.stroke.pressures?.push(sample.pressure > 0 ? sample.pressure : 0.5)
        if (!here.inside) {
          // Out of the region: the stroke ends at its edge, and is made now.
          paint()
          g.out = true
          commitStroke(g)
          schedule(true)
          latest.current.onEdited(g.page)
        }
      }
      schedule()
    } else if (g.kind === "erase") {
      for (const sample of all) { const here = at(sample); eraseAt(g, latest.current.regionBox ? here.raw : here.unit) }
    } else {
      const here = at(event)
      if (!g.dragged && !isBoxDrag(here.px.x - g.startPx.x, here.px.y - g.startPx.y)) return
      if (!g.dragged) setBoxing(true)
      g.dragged = true
      if (g.mode === "move" || g.mode === "resize") {
        const next = g.mode === "move" ? moveBox(g.origin!, here.unit.x - g.start.x, here.unit.y - g.start.y, viewport.current) : resizeBox(g.origin!, g.handle!, here.unit, pageSize(), MIN_BOX_PX, viewport.current)
        g.next = next
        latest.current.onBox(next)
        schedule(true)
      }
      else latest.current.onBox(boxFromPoints(g.start, here.unit))
    }
  }

  const up = (event: PointerEvent) => {
    if(precision.active(event.pointerId)){if(event.type!=='pointercancel')precision.movePan(event,at(event).px);precision.endPan();touching.current=false;try{wrap.current?.releasePointerCapture(event.pointerId)}catch{};return}
    if(inkSelect.active(event.pointerId)){const sample=at(event);if(event.type!=='pointercancel')inkSelect.move(event,{point:latest.current.regionBox?sample.raw:sample.unit,px:sample.px});inkSelect.end(event.type==='pointercancel');touching.current=false;try{wrap.current?.releasePointerCapture(event.pointerId)}catch{};return}
    const deferred=pendingInput(event);if(deferred){if(event.type!=='pointercancel'){const here=at(event),point=latest.current.regionBox?here.raw:here.unit;if(!deferred.lastSample||deferred.lastSample.x!==point.x||deferred.lastSample.y!==point.y)rememberInput(deferred,event)}deferred.ended=true;deferred.cancelled ||= event.type==='pointercancel';if(deferred.cancelled)deferred.controller.abort();touching.current=false;void drainInputs();return}
    if (event.pointerType === "pen" && (event.type === "pointerup" || event.type === "pointercancel")) touching.current = false
    const g = gesture.current
    if (g && g.pointerId !== event.pointerId) return
    if(g?.kind==='box'&&g.dragged&&g.origin&&(g.mode==='move'||g.mode==='resize')){paintVersion.current++;if(event.type!=='pointercancel'){const here=at(event);g.next=g.mode==='move'?moveBox(g.origin,here.unit.x-g.start.x,here.unit.y-g.start.y,viewport.current):resizeBox(g.origin,g.handle!,here.unit,pageSize(),MIN_BOX_PX,viewport.current);latest.current.onBox(g.next);if(g.preview)paint()}}
    // A lift can carry a newer position than the last move (also on the native sample feed).
    if (g?.kind === "draw" && !g.out && !g.full && event.type !== "pointercancel") {
      const point = at(event).unit, last = g.stroke.points[g.stroke.points.length - 1]
      if (!last || point.x !== last.x || point.y !== last.y) {
        if(g.reservation.accept()){
          g.stroke.points.push(point)
          g.bounds.x=Math.min(g.bounds.x,point.x);g.bounds.y=Math.min(g.bounds.y,point.y);g.bounds.right=Math.max(g.bounds.right,point.x);g.bounds.bottom=Math.max(g.bounds.bottom,point.y)
          g.stroke.pressures?.push(event.pressure > 0 ? event.pressure : g.stroke.pressures[g.stroke.pressures.length - 1] ?? .5)
        }else{g.full=true;reportCapacity(g.page)}
      }
    }
    // The last samples are painted now, not left to a frame that will find no stroke.
    if (g?.kind === "draw") paint()
    gesture.current = null
    for (const owner of [wrap.current, host.current]) {
      try { if (owner?.hasPointerCapture(event.pointerId)) owner.releasePointerCapture(event.pointerId) } catch { /* gone */ }
    }
    if (!g) return
    if (g.kind === "draw") {
      // Already made where it left a bound sheet's region.
      if (g.out) return
      commitStroke(g)
      // Begun on a sheet that is no longer open: it went to that sheet, and this one is painted as it is.
      if (g.page !== latest.current.page) schedule(true)
      latest.current.onEdited(g.page)
    } else if (g.kind === "erase") {
      if (g.marked) latest.current.onEdited(g.page)
    } else if (g.dragged) {
      if (g.mode === "move" || g.mode === "resize") {
        if (event.type === "pointercancel") {restorePreview(g);latest.current.onBox(g.origin)}
        else if (g.next) transformSelection(g)
        releasePreview(g)
        schedule(true)
      }
      setBoxing(false)
      lastClick.current = null
      if (g.mode === "new") {
        const made = boxFromPoints(g.start, at(event).unit)
        // Under 8 px either way is a click, not a box.
        latest.current.onBox(made.width * pageSize().width > MIN_BOX_PX && made.height * pageSize().height > MIN_BOX_PX ? made : null)
      }
    } else if (g.mode === "new") {
      // The Mac's rule: one click outside the box takes it away, two take the picture under the ink (else the whole sheet).
      if (!clicked(event)) latest.current.onBox(null)
    } else if (g.mode === "move") {
      // A click inside the box that did not move it: two of them are a double click too (the next size of box).
      clicked(event)
    }
  }

  // A source/document switch can remove the surface before its captured pointer lifts.
  finishGesture.current = () => {
    precision.endPan()
    inkSelect.finish()
    for(const input of deferredInputs.current)input.ended=true
    void drainInputs()
    const g = gesture.current
    if(g?.kind==='draw'&&!g.out&&g.page===latest.current.page)paint()
    if(g?.kind==='box'&&g.preview&&g.next&&g.page===latest.current.page)paint()
    gesture.current = null
    touching.current = false
    if (!g) return
    if (g.kind === "draw" && !g.out) commitStroke(g)
    if(g.kind==='box'){if(g.dragged&&g.next&&(g.mode==='move'||g.mode==='resize')){transformSelection(g)}else if(g.page===latest.current.page)restorePreview(g);releasePreview(g);setBoxing(false);if(g.page===latest.current.page)schedule(true)}
    if ((g.kind === "draw" && !g.out) || (g.kind === "erase" && g.marked)) latest.current.onEdited(g.page)
  }

  /**
   * A click that ended where it began. The second of two close together is a DOUBLE click: it makes the box (the picture under the ink
   * first, then the whole sheet, then the picture: doubleClickBox.ts) and answers true. Otherwise it is remembered, with the box there was.
   */
  const clicked = (event: PointerEvent): boolean => {
    const point = at(event).px
    const before = lastClick.current
    if (before && event.timeStamp - before.time < DOUBLE_MS && Math.hypot(point.x - before.x, point.y - before.y) < 8) {
      lastClick.current = null
      latest.current.onBox(doubleClickBox(before.box, pictureRect(), viewport.current))
      return true
    }
    lastClick.current = { time: event.timeStamp, x: point.x, y: point.y, box: latest.current.box }
    return false
  }

  /** Where the picture under the ink is on the sheet, in fractions of it. Null with none (or not loaded yet). */
  const pictureRect = (): Rect | null => {
    const sheet = size.current
    if (!(sheet.width > 0 && sheet.height > 0)) return null
    const aspect = latest.current.page.aspect
    const current = latest.current.page
    if (!current.backdrop) return null
    const image = loadedBackdrop.current?.file===current.backdrop?loadedBackdrop.current.image:backdropImage(current.backdrop, () => undefined)
    return image && image.naturalWidth > 0 && image.naturalHeight > 0 ? backdropRect(aspect, image.naturalWidth / image.naturalHeight) : null
  }

  const erasing = tools.eraser
  const selectedMembership=inkSelect.controller.bits,selectionWidthScale=unit()
  const selectedAction=(action:any)=>{if(inkSelect.controller.bits===selectedMembership)void inkSelect.run(action)}
  const selectedInk=inkSelect.bounds?rectOnView(inkSelect.bounds,fit.viewport):null
  const lassoPoints=inkSelect.lasso.map(point=>pointOnView(point,fit.viewport)).map(point=>`${point.x*1000},${point.y*1000}`).join(' ')
  const shownBox = box ? rectOnView(box, fit.viewport) : null
  const shownRegion = regionBox ? rectOnView(regionBox, fit.viewport) : null
  return (
    <div className="tablet-host" ref={host} data-tablet="host"
         onPointerMove={(event) => { lastAt.current = { x: event.clientX, y: event.clientY } }}
         onPointerDown={(event) => { if (event.target === host.current) latest.current.onBox(null) }}>
      <div className="tablet" ref={wrap} tabIndex={0} data-tablet="surface" data-paper={paper.kind} data-paper-colour={paper.colour}
           data-sheet-viewport={JSON.stringify(fit.viewport)} data-precision-zoom={precision.zoom}
           style={{ cursor: precision.panning?"grabbing":precision.panArmed?"grab":"crosshair", left: fit.x, top: fit.y, width: fit.width, height: fit.height,
             backgroundColor: colourOfPaper(paper.colour).paper }}
           onPointerEnter={(event) => enter(event)}
           onPointerLeave={() => { hovered.current = false }}
           onPointerDown={(event: React.PointerEvent) => { quietAt.current = null; hovered.current = true; down(event.nativeEvent) }}
           onPointerMove={(event: React.PointerEvent) => { if (!hovered.current) enter(event); move(event.nativeEvent) }}
           onPointerUp={(event: React.PointerEvent) => up(event.nativeEvent)}
           onPointerCancel={(event: React.PointerEvent) => up(event.nativeEvent)}
           onContextMenu={(event) => event.preventDefault()}>
        {/* The ink is first in the tree (what reads "the sheet's canvas" reads the ink); the paper sits under it by z-order. */}
        <canvas ref={canvas} className="ink" data-layer="ink" style={{ width: "100%", height: "100%" }} />
        <canvas ref={backdrop} className="paper" data-layer="paper" style={{ width: "100%", height: "100%" }} />
        <canvas ref={bindLineCanvas} className="line-preview" data-layer="line-preview" style={{width:"100%",height:"100%"}}/>
        {(selectedInk&&inkSelect.count>0||lassoPoints)&&<svg className="ink-selection-outline" data-ink-selection="outline" viewBox="0 0 1000 1000" preserveAspectRatio="none">{selectedInk&&inkSelect.count>0&&<rect x={selectedInk.x*1000} y={selectedInk.y*1000} width={Math.max(selectedInk.width*1000,1)} height={Math.max(selectedInk.height*1000,1)}/>} {lassoPoints&&<path d={'M'+lassoPoints.replaceAll(' ',' L')+' Z'}/>}</svg>}
        {shownRegion && (
          <div className="box-clip">
            <div className="region-frame" data-tablet="region-frame" style={{
              left: `${shownRegion.x * 100}%`, top: `${shownRegion.y * 100}%`, width: `${shownRegion.width * 100}%`, height: `${shownRegion.height * 100}%`,
            }} />
          </div>
        )}
        {shownBox && (
          <div className="box-clip">
            <div className="box" data-tablet="box" style={{
              left: `${shownBox.x * 100}%`, top: `${shownBox.y * 100}%`,
              width: `${shownBox.width * 100}%`, height: `${shownBox.height * 100}%`,
            }}>
              {HANDLES.map((name) => <span key={name} className="handle" data-handle={name} />)}
            </div>
          </div>
        )}
      </div>
      <PrecisionControls zoom={precision.zoom} onZoom={precision.zoomBy} onFit={precision.fit} line={precision.line} angle={precision.angle} onLine={precision.setLine} onAngle={precision.setAngle}/>
      {selectedInk&&inkSelect.count>0&&!lassoPoints&&<InkSelectionActions box={selectedInk} sheet={fit} count={inkSelect.count} busy={inkSelect.busy} colour={inkSelect.style.colour} width={inkSelect.style.width===null?null:inkSelect.style.width*selectionWidthScale} onColour={colour=>selectedAction({type:'recolor',colorHex:colour})} onWidth={value=>selectedAction({type:'width',width:value/selectionWidthScale})} onDuplicate={()=>{void inkSelect.run({type:'duplicate'})}} onDelete={()=>{void inkSelect.run({type:'delete'})}} onClear={inkSelect.clear}/>}
      {shownBox && buttons && !boxing && fit.width > 0 && (
        // Beside the sheet's element, not in it: a click here is the button's, never a box gesture (BoxActions.tsx).
        <BoxActions box={shownBox} sheet={fit} bringOff={buttons.bringOff}
                    erase={async () => {
                      await buttons.erase()
                      // Ctrl+Z next takes the erase back: the sheet has the keys again.
                      wrap.current?.focus({ preventScroll: true })
                    }}
                    bring={() => leaveFor(buttons.bring)}
                    picture={() => leaveFor(buttons.picture)}
                    // Nothing leaves the sheet: the copy is on the clipboard, not in the note.
                    copy={() => buttons.copy()} />
      )}
    </div>
  )
})

