/**
 * The tablet pen's sheet: says whether a tablet pen has been seen, whether it reports pressure, and holds the pen's choices
 * (penSettings.ts): drawing, pressure, buttons, orientation, and manual access/retry controls for an available Wacom.
 *
 * It was the Wacom CHIP on the bar until 2026-10-10 (Sean: "i only need a pen enabled and disabled button.. and a dropdown"):
 * now it is the pen menu's last row, "Tablet buttons and orientation…" (`PenSheetRow`, the old chip's `data-pen="chip"` and
 * its `pen-none` / `pen-pen` / `pen-pressure` classes with it), and this popover opens under the pen button.
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { returnFocusSoon } from "./focusReturn"
import { setButton, setPenDraws, setPressure, usePenSettings } from "./penSettings"
import {
  ACTION_WORDS, DOUBLE_CHOICES, HOLD_CHOICES, buttonRows, buttonSummary, buttonsHint, type HoldAction, type TapAction,
} from "./penButtons"
import { heldAction, heldSlot, usePenLive } from "./penLive"
import { OrientationSelect } from "./OrientationSelect"
import { useNativeButtons } from "./nativeButtonsFeed"
import { acceptStatus, changeSettings, usePenFeedStore } from "./penFeed"
import { menuRoot, menuSize } from "./padCoordinates"

const WORDS = {
  none: "No pen seen yet. Touch the tablet with the pen over this window.",
  pen: "Pen detected, but it reports no pressure. In Wacom Tablet Properties turn on \"Use Windows Ink\" (then restart NoteMind) for pressure and the eraser end.",
  pressure: "Pen detected with pressure.",
} as const

/** Try the system mapping again on this tablet (the driver's earlier "no" is forgotten). */
export async function retryMapping(): Promise<void> {
  try {
    const status = await window.wm.pen?.retryMapping()
    if (status) acceptStatus(status)
  } catch { /* the feed is not there */ }
}

/** The pen menu's row that opens the sheet: the old chip's words as its title, and a dot that says what the pen has been seen to do. */
export function PenSheetRow({ onOpen, close }: { onOpen(): void; close(): void }) {
  const settings = usePenSettings()
  const live = usePenLive()
  const held = heldAction(live)
  const heldName = heldSlot(live) && held && held !== "none" ? ACTION_WORDS[held] : null
  const summary = buttonSummary(settings.buttons)
  return (
    <button type="button" role="menuitem" className={`pen-chip pen-${settings.seen}`} data-pen="chip"
            title={`${WORDS[settings.seen]} ${summary}.${settings.eraser ? " Erase tool is on." : ""}${settings.selectTool ? " Select tool is on." : ""}${heldName ? ` Button held now: ${heldName}.` : ""}`}
            onClick={() => { close(); onOpen() }}>
      <span className="float-label">Tablet buttons and orientation…</span>
      <span className="pen-dot" aria-hidden="true" />
    </button>
  )
}

/** Where the sheet goes: under the pen button, its right edge on the button's. */
export interface SheetPlace { top: number; right: number }

export function PenSheet({ at, onClose }: { at: SheetPlace; onClose(): void }) {
  const settings = usePenSettings()
  const status = usePenFeedStore().status
  const [pad, setPad] = useState<{enabled:boolean;available:boolean;owned:boolean}|null>(null)
  const [padAction, setPadAction] = useState<string|null>(null)
  const [padError, setPadError] = useState<string|null>(null)
  const padPending = useRef(false)
  useEffect(() => {
    const api = (window as any).notemind?.pad
    if (!api) return
    let live = true, pushed = false
    const off = api.onState(value => { pushed = true; if (live) setPad(value) })
    api.state().then(value => { if (live && !pushed) setPad(value) }).catch(() => {})
    return () => { live = false; off() }
  }, [])
  const onPad = !!(pad?.enabled && pad.available && pad.owned)
  const runPadAction = async (action:"requestAccess"|"retry") => {
    if (padPending.current) return
    const api = (window as any).notemind?.pad
    if (!api?.[action]) return
    padPending.current = true; setPadAction(action); setPadError(null)
    try { await api[action]() }
    catch (error) { setPadError(error instanceof Error ? error.message : String(error)) }
    finally { padPending.current = false; setPadAction(null) }
  }
  const display = useNativeButtons().present || !!pad?.available
  const physicalFeed = status?.tablet?.sideButtonMapping === "physical"
  const pop = useRef<HTMLDivElement | null>(null)
  const [popupDoc,setPopupDoc]=useState<Document|null>(null)
  const [bounds,setBounds]=useState<{left:number;top:number;width:number;maxHeight:number}|null>(null)
  useLayoutEffect(()=>{
    const element=pop.current
    if(!element)return
    setPopupDoc(element.ownerDocument)
    const viewport=menuSize(element.ownerDocument),width=Math.max(0,Math.min(400,viewport.width-8)),maxHeight=Math.max(0,viewport.height-8)
    const height=Math.min(maxHeight,element.scrollHeight+Math.max(0,element.offsetHeight-element.clientHeight))
    const next={left:Math.max(4,viewport.width-at.right-width),top:Math.max(4,Math.min(at.top,viewport.height-height-4)),width,maxHeight}
    setBounds(was=>was&&was.left===next.left&&was.top===next.top&&was.width===next.width&&was.maxHeight===next.maxHeight?was:next)
  })
  // Like the app's other popovers: a click anywhere else or Esc puts it away. Esc goes first and stops there, so the same
  // press does not also let go of a box or a tool; the keyboard goes back to the notes.
  useEffect(() => {
    const doc = pop.current?.ownerDocument ?? document
    const view = doc.defaultView ?? window
    const away = (event: PointerEvent) => { const target = event.target as Node | null; if (!target || typeof target.nodeType !== "number" || !pop.current?.contains(target)) onClose() }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      onClose()
      if (doc === document) returnFocusSoon()
    }
    view.addEventListener("pointerdown", away, true)
    view.addEventListener("keydown", key, true)
    view.addEventListener("resize", onClose)
    return () => {
      view.removeEventListener("pointerdown", away, true); view.removeEventListener("keydown", key, true)
      view.removeEventListener("resize", onClose)
    }
  }, [onClose])
  const where: CSSProperties = bounds?{position:"fixed",...bounds,right:"auto"}:{ position: "fixed", top: at.top, right: at.right, left: "auto", maxHeight: `calc(100vh - ${at.top + 8}px)` }
  const contents=(
    <div ref={pop} className="pen-pop" data-pen="sheet" style={{ width: 400, ...where }}
         onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
      <p>{WORDS[settings.seen]}</p>
      <label>
        <input type="checkbox" checked={settings.penDraws}
               onChange={(event) => setPenDraws(event.target.checked)} />
        {" "}Pen always draws (the mouse keeps selecting)
      </label>
      <label>
        <input type="checkbox" checked={settings.pressure}
               onChange={(event) => setPressure(event.target.checked)} />
        {" "}Pressure changes the line width
      </label>

      <h4>Buttons</h4>
      <div className="pen-buttons" data-pen="buttons"
           style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "4px 6px", alignItems: "center" }}>
        <span />
        <span className="hint" style={{ margin: 0 }}>Hold</span>
        <span className="hint" style={{ margin: 0 }}>Double-tap</span>
        {buttonRows(settings.buttons, display || physicalFeed).map((row) => (
          <Fragment key={row.slot}>
            <span>{row.name}</span>
            <select value={row.hold} data-pen={`btn-${row.slot}`} aria-label={`${row.name}: hold`} style={{ minWidth: 0 }}
                    onChange={(event) => setButton(row.slot, "hold", event.target.value as HoldAction)}>
              {HOLD_CHOICES.map((choice) => <option key={choice.action} value={choice.action}>{choice.label}</option>)}
            </select>
            {row.double === null ? <span className="hint" style={{ margin: 0 }}>—</span> : (
              <select value={row.double} data-pen={`dbl-${row.slot}`} aria-label={`${row.name}: double-tap`} style={{ minWidth: 0 }}
                      onChange={(event) => setButton(row.slot, "double", event.target.value as TapAction)}>
                {DOUBLE_CHOICES.map((choice) => <option key={choice.action} value={choice.action}>{choice.label}</option>)}
              </select>
            )}
          </Fragment>
        ))}
      </div>
      <p className="hint" data-pen="buttons-hint">{buttonsHint(display, physicalFeed)}</p>

      <h4>Tablet orientation</h4>
      <label className="pen-slot">
        How the tablet is turned
        <OrientationSelect />
      </label>
      {pad?.available && <div className="pen-input-actions">
        {(window as any).notemind?.platform === "darwin" && <button type="button" data-pen="input-monitoring" disabled={padAction!==null}
          title="Open macOS Input Monitoring settings for pen input" onClick={() => { void runPadAction("requestAccess") }}>Input Monitoring…</button>}
        <button type="button" data-pen="retry-input" disabled={padAction!==null}
          title="Try the Wacom pen input again" onClick={() => { void runPadAction("retry") }}>Retry Pen Input</button>
        {padError && <p className="hint" role="alert">{padError}</p>}
      </div>}
      {!onPad && <label>
        <input type="checkbox" data-pen="map-sheet" checked={status?.settings.mapSheet === true}
               onChange={(event) => { void changeSettings({ mapSheet: event.target.checked }) }} />
        {" "}Map the whole tablet to the sheet
      </label>}
      {!onPad && <p className="hint">
        While the sheet is in front the whole tablet writes on it (on a Mac NoteMind takes the tablet from the
        Wacom driver, which asks once for Input Monitoring). If the cursor ever misbehaves, switch it off or restart
        NoteMind.
      </p>}
      {!onPad && status?.mapping === "refused" && (
        <p className="hint">
          The Wacom driver would not confine the pen to the sheet.{" "}
          <button className="icon-button" data-pen="retry-mapping" title="Try mapping the tablet to this sheet again" onClick={() => { void retryMapping() }}
                  style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>Retry</button>
        </p>
      )}
    </div>
  )
  return popupDoc?createPortal(contents,menuRoot(popupDoc)):contents
}

