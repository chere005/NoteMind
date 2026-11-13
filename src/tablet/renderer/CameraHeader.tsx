

import { Icon, type IconName } from "./icons"
import { MenuButton } from "./MenuButton"
import { PaperMenu } from "./PaperMenu"
import { OrientationMenu } from "./OrientationSelect"
import { BringInMenu } from "./BringInMenu"
import type { BringTo, CaptureMode } from "./cameraSettings"
import type { HeaderFit } from "./cameraHeaderFit"


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


export function CameraHeader(p: CameraProps) {
  const percent = `${p.zoomPercent}%`
  if (p.empty) {
    return (
      <div className="bar-row camera-bar camera-head empty" role="toolbar" aria-label="Camera" data-camera-head="camera">
        {!p.showEditor && (
          <button type="button" className="bar-btn label" data-pane="notes" title="Back to Side by Side: the notes and the video together again"
                  onClick={() => p.onToggleEditor?.()}><span className="bar-label-text">Back to Side by Side</span></button>
        )}
        <span className="grow" />
        <button type="button" className="bar-btn" aria-label="Put the camera away" title="Put the camera away" onClick={p.onHide}><Icon name="close" /></button>
      </div>
    )
  }
  return (
    <div className="bar-row camera-bar camera-head" role="toolbar" aria-label="Camera" data-camera-head="camera">
      {}
      {p.fit.turns && (
        <>
          <button type="button" className="bar-btn" data-camera-turn="left" aria-label="Turn left" title="Turn the picture a quarter turn anticlockwise"
                  disabled={!p.pictured} onClick={() => p.turn(-90)}><Icon name="rotl" /></button>
          <button type="button" className="bar-btn" data-camera-turn="right" aria-label="Turn right" title="Turn the picture a quarter turn clockwise"
                  disabled={!p.pictured} onClick={() => p.turn(90)}><Icon name="rotate" /></button>
        </>
      )}
      <MenuButton icon="zoom" label={p.fit.readout && p.zoomed ? percent : undefined} on={p.zoomed || p.zooming}
                  disabled={!p.pictured && !p.zoomed} data={{ "camera-zoom": "square" }} caretData={{ "camera-zoom": "menu" }} caretDataBar="zoom-menu"
                  name="Zoom" caretTitle="Zoom options: Zoom to a Box, Original Size"
                  title={p.zoomed ? `Zoom: the pane shows ${percent} of the picture. Click to drag a box and zoom further; the arrow has Original size.`
                    : "Zoom: drag a box on the picture and the pane shows just that much"}
                  onMain={p.onZoom}
                  items={[
                    { header: p.zoomed ? `Showing ${percent} of the picture` : "Showing the whole picture" },
                    { label: "Zoom to a Box", icon: "zoom", onClick: p.onZoom, dataBar: "zoom-box" },
                    { label: "Original Size", disabled: !p.zoomed, onClick: p.onOriginalSize, dataBar: "zoom-original" },
                  ]} />
      <button type="button" className={`bar-btn${p.holding ? " on" : ""}`} data-camera="hold" aria-pressed={p.holding} aria-label="Hold image"
              title={p.holdTitle} disabled={p.holdOff} onClick={p.onHold}><Icon name="pause" /></button>
      {p.fit.keep && p.keep && (
        <button type="button" className="bar-btn" data-camera="keep" aria-label="Keep Page" title={p.keep.off ?? p.keep.title}
                disabled={p.keep.off !== null} onClick={p.keep.onKeep}><Icon name="keeppage" /></button>
      )}
      <MenuButton icon="straighten" dataBar="find-page" on={p.findPage} disabled={!p.pictured && !p.findPage} onMain={p.onFindPage}
                  name="Find Page" caretTitle="Find Page options: Zoom to Page"
                  title={p.findPage
                    ? "Find Page is on: the page is selected (drag a corner if it is off) and is what Writing and Image take, squared up. Click to let it go."
                    : "Find Page: look for the page under the camera and select it, squared up (its corners can be dragged). Click again to let it go."}
                  items={[{ label: "Zoom to Page", icon: "zoom", disabled: !p.pictured, onClick: p.onZoomToPage, dataBar: "zoom-page" }]} />
      {p.fit.undo && <>
        <button type="button" className="bar-btn" data-camera="undo" aria-label="Undo ink" title="Take back the last stroke" disabled={!p.canUndoInk} onClick={p.onUndoInk}><Icon name="undo" /></button>
        <button type="button" className="bar-btn danger" data-camera="clear-ink" data-bar="clear-ink" aria-label="Clear the Ink" title="Clear ink on this tab (Undo restores it)" disabled={!p.canClearInk} onClick={p.onClearInk}><Icon name="trash" /></button>
      </>}
      {!p.showEditor && (
        <button type="button" className="bar-btn label" data-pane="notes" title="Back to Side by Side: the notes and the video together again"
                onClick={() => p.onToggleEditor?.()}><span className="bar-label-text">Back to Side by Side</span></button>
      )}
      <span className="grow" />
      <span className="bar-seg" role="group" aria-label="Take">
        {TAKES.map((one) => (
          <button key={one.mode} type="button" className={`bar-btn${p.mode === one.mode ? " on" : ""}`} data-capture={one.mode}
                  aria-label={one.label} title={one.title} disabled={!p.pictured || p.busy} onClick={() => p.onTake(one.mode)}>
            {p.fit.words ? one.label : <Icon name={one.icon} />}
          </button>
        ))}
      </span>
      <button type="button" className="bar-btn" aria-label="Put the camera away" title="Put the camera away" onClick={p.onHide}><Icon name="close" /></button>
    </div>
  )
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
  

  
  reader: boolean
  

  textOff: string | null
  
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
  onHide(): void
  showEditor: boolean
  onToggleEditor?(): void
}


export function TabletHeader(p: TabletProps) {
  return (
    <div className="bar-row camera-bar camera-head" role="toolbar" aria-label="Tablet sheet" data-camera-head="tablet">
      <PaperMenu />
      <OrientationMenu />
      <button type="button" className="bar-btn" data-tablet="undo" aria-label="Undo" title={p.undoTitle} disabled={!p.canUndo} onClick={p.onUndo}><Icon name="undo" /></button>
      <button type="button" className="bar-btn danger" data-tablet="clear" data-bar="clear" aria-label="Clear the Sheet" title="Clear all strokes (Undo restores them)" disabled={!p.canClear} onClick={p.onClear}><Icon name="trash" /></button>
      {!p.showEditor && (
        <button type="button" className="bar-btn label" data-pane="notes" title="Back to Side by Side: the notes and the video together again"
                onClick={() => p.onToggleEditor?.()}><span className="bar-label-text">Back to Side by Side</span></button>
      )}
      <span className="grow" />
      {p.files && (
        <MenuButton icon="doc" label="Save" name="Save" data={{ tablet: "pane-save" }} caretData={{ tablet: "pane-menu" }} caretDataBar="pane-menu"
                    title={p.files.file ? `Save this tab over ${p.files.file}${p.files.dirty ? "" : " (nothing has changed)"}` : "Save this tab as a .nm file: the picture and what is written on it, in one file"}
                    caretTitle="Save As…, Open…, and what this tab's file is kept with"
                    onMain={p.files.save}
                    items={[
                      ...(p.files.picture || p.files.rescan ? [
                        { header: "This picture" } as const,
                        ...(p.files.picture ? [
                          { label: "Save to Original", hint: p.files.picture.saveOriginal ? undefined : "from a note", disabled: !p.files.picture.saveOriginal,
                            dataBar: "pane-save-original", onClick: p.files.picture.saveOriginal ?? (() => undefined) },
                          { label: "Save as New Image", dataBar: "pane-save-new", onClick: p.files.picture.saveNew },
                        ] : []),
                        ...(p.files.rescan ? [{ label: "Rescan with Camera", dataBar: "pane-rescan", onClick: p.files.rescan }] : []),
                        "-" as const,
                      ] : []),
                      { header: "This tab" },
                      { label: "Save As…", dataBar: "pane-save-as", onClick: p.files.saveAs },
                      { label: "Open…", dataBar: "pane-open", onClick: p.files.open },
                      "-",
                      { header: "Keep this file with" },
                      { label: "The open note", checked: p.files.keptNote, disabled: !p.files.canKeepNote, dataBar: "pane-keep-note",
                        onClick: () => p.files!.onKeep("note", !p.files!.keptNote) },
                      { label: "This project", checked: p.files.keptProject, disabled: !p.files.canKeepProject, dataBar: "pane-keep-project",
                        onClick: () => p.files!.onKeep("project", !p.files!.keptProject) },
                    ]} />
      )}
      <BringInMenu to={p.to} onChange={p.onBringTo} title={p.bringTitle} off={p.bringOff} onBring={p.onBring} onPage={p.onBringPage} onSheetText={p.onBringSheetText}
                   reader={p.reader} textOff={p.textOff} />
      <button type="button" className="bar-btn" aria-label="Put the sheet away" title="Put the sheet away" onClick={p.onHide}><Icon name="close" /></button>
    </div>
  )
}
