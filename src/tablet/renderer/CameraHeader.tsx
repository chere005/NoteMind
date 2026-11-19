

import { Icon, type IconName } from "./icons"
import { MenuButton } from "./MenuButton"
import { PaperMenu, usePaperItems } from "./PaperMenu"
import { useOrientationItems } from "./OrientationSelect"
import { BringInMenu } from "./BringInMenu"
import { usePadLocation } from "./DrawingLocation"
import type { BringTo, CaptureMode } from "./cameraSettings"
import type { HeaderFit } from "./cameraHeaderFit"
import {headerFit} from './cameraHeaderFit'
import {useLayoutEffect,useState} from 'react'
import {elementSize} from './padCoordinates'


export const TAKES: { mode: CaptureMode; label: string; icon: IconName; title: string }[] = [
  { mode: "ink", label: "Writing", icon: "pen", title: "Take the writing off the page" },
  { mode: "page", label: "Image", icon: "image", title: "Take the page as a photograph" },
  { mode: "raw", label: "Raw", icon: "camera", title: "Take the raw picture, exactly as the camera sees it: no page found, nothing squared" },
]

interface CameraProps {
  fit: HeaderFit
  
  pictured: boolean
  busy: boolean
  turn(by: number): void
  
  zoomed: boolean
  zoomPercent: number
  zooming: boolean
  onZoom(): void
  onOriginalSize(): void
  holding: boolean
  
  holdOff: boolean
  holdTitle: string
  onHold(): void
  
  keep: { title: string; off: string | null; onKeep(): void } | null
  
  findPage: boolean
  onFindPage(): void
  onZoomToPage(): void
  
  canUndoInk: boolean
  canClearInk: boolean
  onUndoInk(): void
  onClearInk(): void
  
  mode: CaptureMode
  onTake(mode: CaptureMode): void
  onHide(): void
  
  showEditor: boolean
  onToggleEditor?(): void
  
  empty?: boolean
}


function EditorButton({onClick}:{onClick?:()=>void}) {
 return <button type="button" className="bar-btn" data-pane="notes" aria-label="Show editor" title="Show the editor beside the capture pane" onClick={onClick}><Icon name="sidebar"/></button>
}
export function CameraHeader(p:CameraProps) {
 const [element,setElement]=useState<HTMLDivElement|null>(null),[width,setWidth]=useState(0)
 useLayoutEffect(()=>{if(!element)return;const measure=()=>setWidth(elementSize(element).width);const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect()},[element])
 if(width)p={...p,fit:headerFit({width,zoomed:p.zoomed,backToNotes:!p.showEditor})}
 if(p.empty)return <div ref={setElement} className="bar-row camera-bar camera-head empty" role="toolbar" aria-label="Camera" data-camera-head="camera">{!p.showEditor&&<EditorButton onClick={p.onToggleEditor}/>}<span className="camera-empty-label">Choose a camera from the source menu</span></div>
 const current=TAKES.find(item=>item.mode===p.mode)||TAKES[0]
 return <div ref={setElement} className="bar-row camera-bar camera-head" role="toolbar" aria-label="Camera" data-camera-head="camera">
  {!p.showEditor&&<EditorButton onClick={p.onToggleEditor}/>}
  {p.fit.turns&&<>
   <button type="button" className="bar-btn" data-camera-turn="left" aria-label="Rotate camera left" title="Rotate camera left" disabled={!p.pictured} onClick={()=>p.turn(-90)}><Icon name="rotl"/></button>
   <button type="button" className="bar-btn" data-camera-turn="right" aria-label="Rotate camera right" title="Rotate camera right" disabled={!p.pictured} onClick={()=>p.turn(90)}><Icon name="rotate"/></button>
  </>}
  <MenuButton icon="zoom" name="Camera zoom" title={p.zoomed?`Showing ${p.zoomPercent}% of image · Drag a box to zoom further`:p.zooming?"Drag a box on the image · Escape cancels":"Drag a box to zoom"} on={p.zoomed||p.zooming} disabled={!p.pictured&&!p.zoomed}
    data={{"camera-zoom":"square"}} caretData={{"camera-zoom":"menu"}} caretDataBar="zoom-menu" onMain={p.onZoom}
    items={[{header:p.zoomed?`Showing ${p.zoomPercent}% of image`:'Whole image'},{label:'Zoom to a Box',onClick:p.onZoom,dataBar:'zoom-box'},{label:'Zoom to Page',disabled:!p.pictured,onClick:p.onZoomToPage,dataBar:'zoom-page'},{label:'Show Whole Image',disabled:!p.zoomed,onClick:p.onOriginalSize,dataBar:'zoom-original'}]}/>
  <button type="button" className={'bar-btn'+(p.holding?' tint':'')} data-camera="hold" aria-pressed={p.holding} aria-label={p.holding?'Resume camera':'Hold image'} title={p.holdTitle} disabled={p.holdOff} onClick={p.onHold}><Icon name="pause"/></button>
  <button type="button" className={'bar-btn'+(p.findPage?' tint':'')} data-bar="find-page" aria-pressed={p.findPage} aria-label="Find Page" title="Find and straighten the page; drag its corners to adjust" disabled={!p.pictured&&!p.findPage} onClick={p.onFindPage}><Icon name="straighten"/></button>
  {p.keep&&<button type="button" className="bar-btn" data-camera="keep" aria-label="Keep Page" title={p.keep.off??'Keep this camera image as a new page'} disabled={p.keep.off!==null} onClick={p.keep.onKeep}><Icon name="keeppage"/></button>}
  {p.fit.undo&&<>
   <button type="button" className="bar-btn" data-camera="undo" aria-label="Undo ink" title="Undo the last ink change" disabled={!p.canUndoInk} onClick={p.onUndoInk}><Icon name="undo"/></button>
   <button type="button" className="bar-btn danger" data-camera="clear-ink" data-bar="clear-ink" aria-label="Clear the Ink" title="Clear camera ink; Undo restores it" disabled={!p.canClearInk} onClick={p.onClearInk}><Icon name="trash"/></button>
  </>}
  <span className="grow"/>
  <MenuButton icon={current.icon} label={p.fit.words?'Insert '+current.label:undefined} name={'Insert '+current.label} primary disabled={!p.pictured||p.busy} title={'Insert '+current.label.toLowerCase()+' into the open Notepad'} data={{capture:p.mode}} caretData={{camera:'insert-menu'}} onMain={()=>p.onTake(p.mode)}
    items={[{header:'Insert into Notepad'},...TAKES.map(item=>({label:item.mode==='raw'?'Raw Image':item.label,checked:p.mode===item.mode,disabled:!p.pictured||p.busy,dataBar:'camera-insert-'+item.mode,onClick:()=>p.onTake(item.mode)}))]}/>
  <MenuButton icon="more" name="Camera options" title="Rotation and ink actions" dataBar="camera-more" items={[
   {label:'Rotate Left',disabled:!p.pictured,onClick:()=>p.turn(-90)},{label:'Rotate Right',disabled:!p.pictured,onClick:()=>p.turn(90)},'-',
   {label:'Undo Ink',disabled:!p.canUndoInk,onClick:p.onUndoInk},{label:'Clear Ink',disabled:!p.canClearInk,onClick:p.onClearInk,danger:true},
  ]}/>
 </div>
}

interface TabletProps {
  
  canUndo: boolean
  undoTitle: string
  onUndo(): void
  canClear: boolean
  onClear(): void
  
  to: BringTo
  onBringTo(next: BringTo): void
  
  bringTitle: string
  
  bringOff: string | null
  onBring(to: BringTo): void
  onBringPage(): void
  onBringSheetText(): void
  docked: boolean
  onDocked(docked: boolean): void
  

  
  reader: boolean
  

  textOff: string | null
  
  onHide(): void
  showEditor: boolean
  onToggleEditor?(): void
}

interface TabletOptionsProps {
  canClear: boolean
  onClear(): void
  files?: {
    save(): void; saveAs(): void; open(): void
    
    file: string | null
    dirty: boolean
    
    rescan: (() => void) | null
    
    picture: { saveOriginal: (() => void) | null; saveNew(): void } | null
    
    keptNote: boolean
    keptProject: boolean
    canKeepNote: boolean
    canKeepProject: boolean
    onKeep(to: "note" | "project", on: boolean): void
  }
}


export function TabletHeader(p:TabletProps) {
 // Not a bar of its own: these follow the pen's controls on the pen bar (PenControl's `trailing`), so the pane has two bars.
 return <span className="pen-trailing" role="group" aria-label="Tablet sheet" data-camera-head="tablet">
  <span className="toolbar-separator"/>
  {!p.showEditor&&<EditorButton onClick={p.onToggleEditor}/>}
  <PaperMenu/>
  <button type="button" className="bar-btn" data-tablet="undo" aria-label="Undo" title={p.undoTitle} disabled={!p.canUndo} onClick={p.onUndo}><Icon name="undo"/></button>
  <span className="pen-insert-actions">
    <button type="button" className="bar-btn" data-tablet="clear" aria-label="Clear Page" title="Clear the drawing page" disabled={!p.canClear} onClick={p.onClear}><Icon name="trash"/></button>
    <span className="grow"/>
    <BringInMenu title="Insert drawing into the open Notepad" off={p.bringOff} onBring={p.onBring} onPage={p.onBringPage}
      docked={p.docked} onDocked={p.onDocked}/>
  </span>
 </span>
}

export function TabletOptions(p: TabletOptionsProps) {
 const original=p.files?.picture?.saveOriginal
 const orientation=useOrientationItems(),paper=usePaperItems(),pad=usePadLocation()
 const sheet=[{label:'Paper',dataBar:'pane-paper',submenu:paper},{label:'Tablet Orientation',dataBar:'pane-orientation',submenu:orientation},
   {label:'Use Wacom Screen',checked:pad.wacom,disabled:pad.busy||!pad.available,dataBar:'pane-wacom',
    title:pad.available?undefined:'The Wacom must be an extended display',onClick:pad.toggle}]
 const clear={label:'Clear the Sheet',disabled:!p.canClear,dataBar:'clear',onClick:p.onClear}
 return <MenuButton icon="more" name="Drawing options" title="Save, open, keep, paper and clear" data={{tablet:'pane-menu'}} dataBar="pane-menu" live items={p.files?[
   {label:original?'Save to Original':'Save Sheet',dataBar:original?'pane-save-original':'pane-save',onClick:original||p.files.save},
   ...(p.files.picture?[{label:'Save as New Image…',dataBar:'pane-save-new',onClick:p.files.picture.saveNew}]:[]),
   {label:'Save Drawing As…',dataBar:'pane-save-as',onClick:p.files.saveAs},{label:'Open Drawing…',dataBar:'pane-open',onClick:p.files.open},
   ...(p.files.rescan?[{label:'Rescan with Camera',dataBar:'pane-rescan',onClick:p.files.rescan}]:[]),'-',
   {header:'Keep a copy with'},
   {label:'The open note',checked:p.files.keptNote,disabled:!p.files.canKeepNote,dataBar:'pane-keep-note',onClick:()=>p.files.onKeep('note',!p.files.keptNote)},
   {label:'This project',checked:p.files.keptProject,disabled:!p.files.canKeepProject,dataBar:'pane-keep-project',onClick:()=>p.files.onKeep('project',!p.files.keptProject)},
   '-',...sheet,clear,
  ]:[...sheet,clear]}/>
}
