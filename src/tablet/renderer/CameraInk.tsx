/**
 * THE PEN WRITES ON THE CAMERA'S PICTURE (Sean, 2026-10-25: "if a document scanner is on, the wacom should also be able to write on top
 * of the image.. this isn't a separate workflow and needs no buttons"). One canvas over the viewfinder, under the box and Find Page's
 * corners: the PEN draws on it (and rubs out with its eraser button or the sheet's Erase Tool, as on the sheet), the MOUSE never draws
 * or rubs out - its presses go on to the pane's box and zoom gestures under it, so the camera view works exactly as before for the mouse.
 *
 * The ink is the open camera tab's (cameraInkPages.ts: kept as fractions of the upright picture, cameraInkGeometry.ts), drawn where the picture
 * is shown and through the zoom, so it stays on the paper whatever the pane does. The canvas is outside the zoom's transform and painted
 * at the screen's own pixels (crisp at any zoom), all again when the view changes and only the new segments while the pen moves.
 *
 * The native Wacom feed (usePenFeed.ts, penFeed.ts) maps the whole tablet onto a TABLET-SHAPED area round the picture as it is shown,
 * zoom included, inside the viewfinder (cameraInkGeometry.ts `inkPenArea`, published here as `data-pen-rect`), turned by the person's
 * Tablet orientation only, exactly as the Tablet sheet is (Sean, 2026-10-26: "the tablet orientation doesn't match in the live camera view
 * and is wrong compared to the normal tablet view"): a circle on the tablet is a circle here, and a turned picture does not turn the pen.
 * Those events always reach this canvas; they must never land in the document beside it. Without a native feed, the window's own pen
 * events write where the pen is over the picture. Both paths use the same handlers below, so they agree point for point: a press off
 * the picture (the dark bars, the area's margin round it) writes nothing, and a stroke that strays off it stops at its edge, as a stroke
 * that strays past the sheet's edge stops there. The canvas over a playing video is not desynchronized (it can flicker over video).
 *
 * THE PEN TIP ALWAYS WRITES: every press of the pen on the picture is this layer's, and it does not reach the pane's box (the box's resize
 * handles, like Find Page's corner dots, take no pointer at all, so the pen writes straight across them, and only the mouse resizes by
 * them). Three things are the pane's, and this layer hands each one over (the pane starts the gesture at that point, with that pointer, as
 * for the mouse; the pen's later moves and its lift bubble to the pane's own handlers):
 *  - the pen's SELECT (a held side button, or the Select Tool toggle) pulls a box as the mouse does (`onPenSelect`), whether the press
 *    arrives as a pointerdown or - the button pressed in the air first - as the pointermove of the pen touching (penButtons.ts holdBegins);
 *  - a press of the pen's tip or Select ON a Find Page corner's dot takes that corner (`onPenCorner`: the pane says whether the press is on a
 *    dot, within 9 points of its centre, cameraHits.ts), so a pen-only person can drag the corners the toast and footer name; a press
 *    anywhere else, writing near a page corner included, writes;
 *  - while the ZOOM IS ARMED (Zoom, Zoom to a Box) every press of the pen is the zoom box's, as it was before this layer: none of it is ink.
 * While a stroke is being written (or rubbed out) the pane is told (`onDrawing`), so the row under the selection can keep out of the pen's
 * way until the pen lifts.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from "react"
import { zoomScale, type Point } from "@notemind/core"
import type { Turns } from "../shared/orientation"
import { subscribeOrientation } from "./orientation"
import { elementPoint } from "./padCoordinates"
import { holdBegins, inContact, penLifted, pressAction } from "./penButtons"
import { penNear, penSettings, sheetPressSettings, useSheetTools } from "./penSettings"
import { setTabletUndo, watchSheetPen } from "./tabletFocus"
import { paintStrokes,paintStrokesYielding, strokeUnderAsync, type InkStroke, type TabletPage } from "./tabletPage"
import {createInkActionController,hasPendingInkMutations,subscribeInkMutations,reserveInkStroke,capacityError} from '../../ink-mutations.js'
import {yieldTask} from '../../graphics-pane.js'
import {primeStrokeBox} from '../../stroke-bounds.js'
import {CameraInkRenderer,cameraRasterPlan,type CameraRasterPlan} from './cameraInkRaster'
import {multiply,inverse,type Matrix} from './cameraInkTransform'
import { currentSheetAspect } from "./tabletSheets"
import { inkPenArea, inkPictureRect, inkToScreen, inkUnit, inkWidth, onPicture, screenToInk, type InkView } from "./cameraInkGeometry"

export interface CameraInkHandle {
  /** Finish the contact before changing the paper's coordinate frame (a turn). */
  finish(): void
  flush(): Promise<void>
  release(owner:TabletPage): Promise<void>
  undo(): boolean
  redo(): boolean
  clear(): void
  /** A take was made: the next Ctrl+Z is the note's (the pointer is over the row or the header, not "back on the picture"). */
  leave(): void
}

interface Props {
  /** The camera tab's identity: a native contact ends before it can cross into another tab. */
  targetKey: string
  /**
   * The picture's quarter turns. A turn is another frame for the paper, so a native contact ends at one (it is in `data-pen-key`); it NEVER
   * turns the pen, which moves on the screen, where the picture is already upright (only the Tablet orientation turns the tablet).
   */
  turns: Turns
  /** The open tab's ink (null: nothing to write on). */
  page: TabletPage | null
  view: InkView
  /** A picture is showing: the pen writes only then. */
  on: boolean
  colour: string
  /** The pen's width in screen points, as on the sheet. */
  width: number
  onEdited(): void
  onError?(error:Error): void
  /** The pen is down on the picture writing or rubbing out (true) and has lifted (false): the selection's row is not shown while it is. */
  onDrawing(active: boolean): void
  /**
   * The zoom is armed (Zoom, Zoom to a Box): the pen drags the zoom box as the mouse does, so no press of the pen is ink and every one goes
   * on to the pane (which accepts a pen's press then).
   */
  zooming: boolean
  /**
   * The pen's Select pressed on the picture - as a pointerdown, or as the pointermove of the pen touching with its button already held:
   * the pane starts its box drag at this point with this pointer, the state the mouse's press sets. The pen's later moves and its lift reach
   * the pane's own handlers.
   */
  onPenSelect(event: React.PointerEvent): void
  /**
   * A press of the pen that would write (or select) at this point: the pane takes the corner of Find Page that is ON the press and answers
   * true (this layer then writes nothing), or answers false for a press that is on no corner's dot.
   */
  onPenCorner(event: React.PointerEvent): boolean
}

/** How near a stroke the eraser has to be, in screen points. */
const ERASE_RADIUS = 8

type Gesture =
  | { kind: "draw"; pointerId: number; stroke: InkStroke; drawn: number; page: TabletPage; reservation:ReturnType<typeof reserveInkStroke>;full?:boolean;bounds:{x:number;y:number;right:number;bottom:number} }
  | { kind: "erase"; pointerId: number; page: TabletPage; samples:Point[]; ended:boolean; wake:(()=>void)|null; preview:InkStroke[]|null; view:InkView; done?:Promise<any> }

export const CameraInk = forwardRef<CameraInkHandle, Props>(function CameraInk(
  { targetKey, turns, page, view, on, colour, width, onEdited, onError, onDrawing, zooming, onPenSelect, onPenCorner }, handle,
) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const context = useRef<CanvasRenderingContext2D | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const everything = useRef(true)
  const renderer=useRef<CameraInkRenderer|null>(null),paintVersion=useRef(0)
  const painted=useRef<{page:TabletPage;plan:CameraRasterPlan;matrix:Matrix}|null>(null)
  const hovered = useRef(false)
  const touching = useRef(false)
  const fullPages=useRef(new WeakSet<TabletPage>())
  const actionControllers=useRef(new WeakMap<TabletPage,ReturnType<typeof createInkActionController>>())
  const controllerSet=useRef(new Set<ReturnType<typeof createInkActionController>>())
  const tools = useSheetTools()
  /** The Tablet sheet's shape (the tablet's, turned by its orientation): the native pen's area here has it too. */
  const sheetAspect = useSyncExternalStore(subscribeOrientation, currentSheetAspect)
  const latest = useRef({ page, view, on, colour, width, onEdited, onError, onDrawing, zooming, onPenSelect, onPenCorner })
  latest.current = { page, view, on, colour, width, onEdited, onError, onDrawing, zooming, onPenSelect, onPenCorner }

  const toPixel = useCallback((point: Point): Point => inkToScreen(point, latest.current.view), [])

  const paint = useCallback(() => {
    frame.current = null
    const element = canvas.current
    const { view: v, page: p } = latest.current
    if (!element) return
    const ratio = Math.min(element.ownerDocument.defaultView?.devicePixelRatio||1,8192/Math.max(1,v.size.width),8192/Math.max(1,v.size.height),Math.sqrt(16*1024*1024)/Math.sqrt(Math.max(1,v.size.width))/Math.sqrt(Math.max(1,v.size.height)))
    const w = Math.max(1, Math.floor(v.size.width * ratio)), h = Math.max(1, Math.floor(v.size.height * ratio))
    const plan=latest.current.on&&p?cameraRasterPlan(v,ratio):null,previous=painted.current,newMatrix=plan?multiply(plan.workerToDevice,plan.canonicalToWorker):null
    const changedSize=element.width!==w||element.height!==h,changedView=previous?.plan.key!==plan?.key||previous?.page!==p
    let old:HTMLCanvasElement|null=null
    if((changedSize||changedView)&&previous?.page===p&&plan&&newMatrix){old=element.ownerDocument.createElement('canvas');old.width=element.width;old.height=element.height;old.getContext('2d')?.drawImage(element,0,0)}
    if(changedSize){element.width=w;element.height=h;everything.current=true}
    context.current ??= element.getContext("2d", { desynchronized: false })
    const ctx = context.current
    if (!ctx) return
    if(changedSize||changedView){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);if(old&&plan&&newMatrix&&previous){ctx.save();ctx.beginPath();ctx.rect(plan.clip.x*ratio,plan.clip.y*ratio,plan.clip.width*ratio,plan.clip.height*ratio);ctx.clip();ctx.setTransform(...multiply(newMatrix,inverse(previous.matrix)));ctx.drawImage(old,0,0);ctx.restore();old.width=old.height=1;}painted.current=p&&plan&&newMatrix?{page:p,plan,matrix:newMatrix}:null;everything.current=true}
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const unit = inkUnit(v)
    const g = gesture.current
    if (everything.current) {
      everything.current = false
      if(!p||!plan||!latest.current.on){ctx.clearRect(0,0,v.size.width,v.size.height);renderer.current?.dispose();renderer.current=null;return}
      // Native contact pixels remain visible while their exact signature is
      // prepared. A stale worker frame must never paint over that contact.
      const preview=g?.kind==='erase'&&g.page===p?g.preview:null
      if(g?.kind==='draw'||hasPendingInkMutations(p)&&!preview){
        if(g?.kind==='draw'&&g.stroke.points.length>g.drawn){const picture=inkPictureRect(v);ctx.save();ctx.beginPath();ctx.rect(picture.x,picture.y,picture.width,picture.height);ctx.clip();paintStrokes(ctx,[g.stroke],toPixel,unit,undefined,g.drawn);ctx.restore();g.drawn=g.stroke.points.length}
        return
      }
      const strokes=preview||p.strokes,source=p.strokes,version=++paintVersion.current
      const valid=()=>version===paintVersion.current&&latest.current.page===p&&latest.current.on&&p.strokes===source&&(!gesture.current||(gesture.current.kind==='erase'&&gesture.current.preview===strokes))&&(!hasPendingInkMutations(p)||gesture.current?.kind==='erase'&&gesture.current.preview===strokes)
      if(strokes.length>4096||p.currentGeometryPoints>20000){
        renderer.current ||=new CameraInkRenderer()
        renderer.current.request({page:p,strokes,ownerStrokes:source,view:v,ratio,valid},(result,output,current)=>{
          if(!valid()||!current()||!canvas.current)return false
          const target=canvas.current.getContext('2d');if(!target)return false
          target.save();target.setTransform(ratio,0,0,ratio,0,0);target.beginPath();target.rect(output.clip.x,output.clip.y,output.clip.width,output.clip.height);target.clip();target.setTransform(...output.workerToDevice)
          for(const tile of result.tiles){target.clearRect(tile.x,tile.y,tile.width,tile.height);target.drawImage(tile.bitmap,tile.x,tile.y)}target.restore();return true
        },async(_failure,output,current)=>{
          if(!output||!valid()||!current())return
          const fallback=element.ownerDocument.createElement('canvas');fallback.width=w;fallback.height=h
          try{const target=fallback.getContext('2d');if(!target)throw Error('Could not paint camera ink.');target.setTransform(ratio,0,0,ratio,0,0);target.beginPath();target.rect(output.clip.x,output.clip.y,output.clip.width,output.clip.height);target.clip();await paintStrokesYielding(target,strokes,point=>inkToScreen(point,v),unit,undefined,0,undefined,{cancelled:()=>!valid()||!current(),yieldControl:yieldTask});if(valid()&&current()){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.drawImage(fallback,0,0)}}catch(error){if(valid())reportError(error)}finally{fallback.width=fallback.height=1}
        })
        return
      }
      ctx.clearRect(0, 0, v.size.width, v.size.height)
      const picture=inkPictureRect(v);ctx.save();ctx.beginPath();ctx.rect(picture.x,picture.y,picture.width,picture.height);ctx.clip()
      paintStrokes(ctx, strokes, toPixel, unit)
      if (g?.kind === "draw") { paintStrokes(ctx, [g.stroke], toPixel, unit); g.drawn = g.stroke.points.length }
      ctx.restore()
      return
    }
    if (g?.kind === "draw" && g.stroke.points.length > g.drawn) {
      const picture=inkPictureRect(v);ctx.save();ctx.beginPath();ctx.rect(picture.x,picture.y,picture.width,picture.height);ctx.clip()
      paintStrokes(ctx, [g.stroke], toPixel, unit, undefined, g.drawn)
      ctx.restore()
      g.drawn = g.stroke.points.length
    }
  }, [toPixel])

  const schedule = useCallback((full = false) => {
    if (full) everything.current = true
    if (frame.current === null) frame.current = requestAnimationFrame(paint)
  }, [paint])

  const reportError=(error:any)=>{if(error?.name!=='AbortError')latest.current.onError?.(error)}
  const reportCapacity=(owner:TabletPage)=>{if(!fullPages.current.has(owner)){fullPages.current.add(owner);reportError(capacityError())}}
  const controllerFor=(owner:TabletPage)=>{
    let controller=actionControllers.current.get(owner)
    const callbacks={repaint:()=>{if(owner===latest.current.page)schedule(true)},onEdited:()=>latest.current.onEdited(),onError:reportError}
    if(!controller){controller=createInkActionController(owner,callbacks);actionControllers.current.set(owner,controller);controllerSet.current.add(controller)}else controller.attach(callbacks)
    return controller
  }

  const finish = useCallback(() => {
    touching.current = false
    const g = gesture.current
    if (!g) return
    if (g.kind === "draw") paint()
    gesture.current = null
    latest.current.onDrawing(false)
    if (g.kind === "draw") {
      primeStrokeBox(g.stroke,g.bounds)
      try{const done=controllerFor(g.page).append(g.stroke,{nativeCanonical:true,reservation:g.reservation});void done?.catch(reportError)}catch(error){g.reservation.release();reportError(error)}
    }else{g.ended=true;g.wake?.();g.wake=null;}
  }, [paint])

  // Everything again when the view changes (zoom, the pane's size, a turn, another tab) or the ink does (undo, a turn, another window).
  const viewKey = `${view.shown.x},${view.shown.y},${view.shown.width},${view.shown.height}|${view.zoom ? `${view.zoom.x},${view.zoom.y},${view.zoom.width},${view.zoom.height}` : ""}|${view.size.width},${view.size.height}|${view.turns||0}|${view.clip?`${view.clip.x},${view.clip.y},${view.clip.width},${view.clip.height}`:''}|${on}`
  useLayoutEffect(() => {
    if (gesture.current) finish()
    schedule(true)
  }, [viewKey, page, on, finish, schedule])
  useEffect(() => page?.onChange(() => schedule(true)), [page, schedule])
  useEffect(()=>subscribeInkMutations(owner=>{if(owner===latest.current.page)schedule(true)}),[schedule])
  useEffect(() => {
    const onResize = () => schedule(true)
    const view = canvas.current?.ownerDocument.defaultView ?? window
    view.addEventListener("resize", onResize)
    return () => {
      view.removeEventListener("resize", onResize)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      // Keep a contact written before the pane was put away, on its own page.
      finish()
      for(const controller of controllerSet.current)controller.detach()
      controllerSet.current.clear()
      paintVersion.current++;renderer.current?.dispose();renderer.current=null
    }
  }, [finish, schedule])

  // Undo and redo of the tab's ink: Ctrl+Z with the pointer over the picture, and the pen's double tap (penActions.ts, tabletFocus.ts).
  const act = useCallback((which: "undo" | "redo"): boolean => {
    const p = latest.current.page
    if (!p||!latest.current.on) return false
    finish()
    if(!(which==='undo'?p.canUndo:p.canRedo)&&!hasPendingInkMutations(p))return false
    void controllerFor(p)[which]().catch(()=>{})
    return true
  }, [finish,schedule])
  useEffect(() => {
    if (!on) return
    setTabletUndo((which) => (hovered.current ? act(which) : false))
    return () => setTabletUndo(null)
  }, [act, on])
  /** Where the pointer was when a take left the picture: "entering" it again there is not the pointer coming back. */
  const quietAt = useRef<Point | null>(null)
  const lastAt = useRef<Point | null>(null)
  // The pen over the picture: its double taps and ExpressKeys toggle the sheet's own tools (the Erase Tool rubs out the ink here too).
  useEffect(() => {
    if (!on) return
    const element = canvas.current
    return element ? watchSheetPen(element.closest(".camera-workspace") ?? element) : undefined
  }, [on])

  useImperativeHandle(handle, () => ({
    finish,
    flush:()=>{finish();const p=latest.current.page;return p?controllerFor(p).flush():Promise.resolve()},
    release:async owner=>{if(gesture.current?.page===owner)finish();const controller=actionControllers.current.get(owner);if(!controller)return;await controller.flush();controller.detach();controllerSet.current.delete(controller);actionControllers.current.delete(owner)},
    undo: () => act("undo"),
    redo: () => act("redo"),
    clear: () => { const p = latest.current.page; if (p&&latest.current.on) { finish();void controllerFor(p).clear().catch(()=>{}) } },
    leave: () => { hovered.current = false; quietAt.current = lastAt.current },
  }), [act, finish, schedule])

  const at = (event: { clientX: number; clientY: number }): Point => {
    const point = elementPoint(canvas.current!, event)
    return { x: point.x, y: point.y }
  }

  const eraseAt = (g: Extract<Gesture, { kind: "erase" }>, screen: Point) => {
    if(g.ended)return
    if(g.samples.length>=8192){g.ended=true;g.wake?.();reportError(Error('The eraser is still finishing this gesture.'));return}
    const point=screenToInk(screen,g.view),previous=g.samples.at(-1)
    if(!previous||previous.x!==point.x||previous.y!==point.y)g.samples.push(point)
    g.wake?.();g.wake=null
  }

  const down = (event: React.PointerEvent) => {
    const { page: p, on: showing } = latest.current
    if (!p || !showing) return
    if (event.pointerType === "touch") {
      // A palm on the screen while the pen is near is not a gesture at all.
      if (penNear()) { event.preventDefault(); event.stopPropagation() }
      return
    }
    const pen = event.pointerType === "pen"
    if (pen) touching.current = inContact(event.nativeEvent)
    if (gesture.current && gesture.current.pointerId !== event.pointerId) return
    // ZOOM ARMED: the pen drags the zoom box as it did before the pane had ink - nothing here is this layer's, no press is a stroke.
    if (latest.current.zooming) return
    const action = pressAction(event.nativeEvent, sheetPressSettings())
    // THE SPLIT: the mouse never writes or rubs out here (its press goes on to the box under this layer).
    if (!pen) return
    // A press ON one of Find Page's corner dots takes that corner (the tip, or the Select that would otherwise box from there); anywhere
    // else the tip writes. The eraser end and the Erase Tool rub out wherever they are.
    if ((action === "draw" || action === "select") && latest.current.onPenCorner(event)) return
    // The pen's Select (a held button, the Select Tool) pulls the box as the mouse does: the pane starts it here, now. This may be the
    // pointermove of the pen touching with its button already held (move() below): the pane's pictureDown never sees that one.
    if (action === "select") { latest.current.onPenSelect(event); return }
    // Anything else of the pen's is this layer's, even when it does nothing (a button pressed in the air, Pan, a press off the picture):
    // the box under it is the mouse's.
    event.preventDefault()
    event.stopPropagation()
    if (action === "ignore" || action === "pan") return
    const point = at(event)
    if (action === "draw" && !onPicture(point, latest.current.view)) return
    try { canvas.current?.setPointerCapture(event.pointerId) } catch { /* the pointer is gone */ }
    if (action === "erase") {
      const g: Extract<Gesture,{kind:'erase'}> = { kind: "erase", pointerId: event.pointerId, page: p, samples:[],ended:false,wake:null,preview:null,view:latest.current.view }
      gesture.current = g
      latest.current.onDrawing(true)
      eraseAt(g, point)
      g.done=controllerFor(p).enqueue(async(_captured:InkStroke[],source:InkStroke[],options:any)=>{
        const v=g.view,scale=v.zoom?zoomScale(v.zoom,v.size):1,shownSize={width:(v.turns&&v.turns%2?v.shown.height:v.shown.width)*scale,height:(v.turns&&v.turns%2?v.shown.width:v.shown.height)*scale}
        let next=source
        for(;;){
          while(g.samples.length){
            const sample=g.samples.shift()!,index=await strokeUnderAsync(next,sample,shownSize,ERASE_RADIUS,inkUnit(v),options)
            if(index>=0){const copy:InkStroke[]=[];for(let at=0;at<next.length;at++){if(options.signal.aborted)throw Object.assign(Error('Drawing change cancelled.'),{name:'AbortError'});if(at!==index)copy.push(next[at]!);if(at%4096===4095)await yieldTask()}next=copy;g.preview=next;if(gesture.current===g)schedule(true)}
          }
          if(g.ended)break
          await new Promise<void>(resolve=>{g.wake=resolve})
        }
        if(next===source)return null
        return {target:next,commit:(changeOptions:any)=>p.replaceAsync(next,changeOptions)}
      },{capture:false})
      void g.done.catch(reportError)
      return
    }
    let reservation:ReturnType<typeof reserveInkStroke>
    try{reservation=reserveInkStroke(p);fullPages.current.delete(p)}catch(error:any){if(error?.code==='NOTEMIND_INK_CAPACITY')reportCapacity(p);else reportError(error);try{canvas.current?.releasePointerCapture(event.pointerId)}catch{}return}
    const pressure = event.pressure > 0 ? event.pressure : 0.5
    const normalized=screenToInk(point,latest.current.view)
    gesture.current = {
      kind: "draw", pointerId: event.pointerId, drawn: 0, page: p,
      reservation,
      bounds:{x:normalized.x,y:normalized.y,right:normalized.x,bottom:normalized.y},
      stroke: {
        colorHex: latest.current.colour,
        width: inkWidth(latest.current.width, latest.current.view),
        points: [normalized],
        ...(penSettings().pressure ? { pressures: [pressure] } : {}),
      },
    }
    latest.current.onDrawing(true)
    schedule()
  }

  const move = (event: React.PointerEvent) => {
    lastAt.current = { x: event.clientX, y: event.clientY }
    const g = gesture.current
    const was = touching.current
    if (event.pointerType === "pen") touching.current = inContact(event.nativeEvent)
    if (g && g.pointerId !== event.pointerId) return
    if (event.pointerType === "pen") {
      // A side button held in the air, then the pen touches: its hold begins here (this touch is a pointermove).
      if (!g && holdBegins(was, event.nativeEvent)) { down(event); return }
      if (g && penLifted(event.nativeEvent)) { up(event); return }
    }
    if (!g) return
    event.stopPropagation()
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
    const all = samples.length > 0 ? samples : [event.nativeEvent]
    if (g.kind === "erase") { for (const sample of all) eraseAt(g, at(sample)); return }
    for (const sample of all) {
      if(g.full)break
      if(!g.reservation.accept()){g.full=true;reportCapacity(g.page);break}
      const point=screenToInk(at(sample), latest.current.view)
      g.stroke.points.push(point)
      g.bounds.x=Math.min(g.bounds.x,point.x);g.bounds.y=Math.min(g.bounds.y,point.y);g.bounds.right=Math.max(g.bounds.right,point.x);g.bounds.bottom=Math.max(g.bounds.bottom,point.y)
      g.stroke.pressures?.push(sample.pressure > 0 ? sample.pressure : 0.5)
    }
    schedule()
  }

  const up = (event: React.PointerEvent) => {
    if (event.pointerType === "pen") touching.current = false
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    event.stopPropagation()
    if(g.kind==='draw'&&event.type!=='pointercancel'){
      const point=screenToInk(at(event),latest.current.view),last=g.stroke.points.at(-1)
      if(!last||last.x!==point.x||last.y!==point.y){if(!g.full&&g.reservation.accept()){g.stroke.points.push(point);if(g.stroke.pressures)g.stroke.pressures.push(g.stroke.pressures.at(-1)??.5);g.bounds.x=Math.min(g.bounds.x,point.x);g.bounds.y=Math.min(g.bounds.y,point.y);g.bounds.right=Math.max(g.bounds.right,point.x);g.bounds.bottom=Math.max(g.bounds.bottom,point.y)}else reportCapacity(g.page)}
    }
    try { if (canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId) } catch { /* gone */ }
    finish()
  }

  const picture = inkPictureRect(view)
  // Where the whole tablet writes: the sheet's shape (the tablet, turned by its orientation) round the picture as shown.
  const area = inkPenArea(view, sheetAspect)
  return (
    <>
      <canvas ref={canvas} className="camera-ink" data-camera="ink" aria-hidden
              data-pen-surface={on && page ? "camera" : undefined} data-pen-key={`${targetKey}@${turns}`}
              data-pen-rect={`${area.x},${area.y},${area.width},${area.height}`}
              data-pen-picture={`${picture.x},${picture.y},${picture.width},${picture.height}`}
              style={{ width: view.size.width, height: view.size.height, cursor: tools.eraser && !zooming ? "crosshair" : undefined }}
              onPointerEnter={(event) => {
                const quiet = quietAt.current
                if (quiet && Math.hypot(event.clientX - quiet.x, event.clientY - quiet.y) < 3) return
                quietAt.current = null
                hovered.current = true
              }}
              onPointerLeave={() => { hovered.current = false }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onContextMenu={(event) => { if (latest.current.on) event.preventDefault() }} />
    </>
  )
})

