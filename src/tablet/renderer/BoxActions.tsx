import {createPortal} from 'react-dom'
import {useSelectionMirror,mirrorRowPlace,type MirrorAnchor} from './SelectionMirror'


import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Rect, Size } from "@notemind/core"
import { placeRow, ROW_GAP, rowPressToSheet, type RowPlace } from "./boxRow"
import { CLICK_SLOP_PX, SYNTH_POINTER_ID } from "./penFeed"

export interface BoxButtons {
  text?: () => void | Promise<void>
  erase(): void | Promise<void>
  bring(): void | Promise<void>
  
  picture(): void | Promise<void>
  copy(): void | Promise<void>
  
  bringOff: string | null
  clear?: () => void
  
}

interface Props extends BoxButtons {
  mirrored?: boolean
  mirrorAnchor?: MirrorAnchor
  
  box: Rect
  
  sheet: { x: number; y: number; width: number; height: number }
}

export function BoxActions({ box, sheet, erase, bring, picture, copy, bringOff, clear, text, mirrored=false, mirrorAnchor }: Props) {
  const row = useRef<HTMLDivElement | null>(null)
  const mirror = useSelectionMirror(row, sheet, mirrored)
  const [size, setSize] = useState<Size | null>(null)
  const [pending, setPending] = useState(false)
  
  const [full, setFull] = useState<number | null>(null)
  // The short labels only when the full row would not fit across the sheet.
  const compact = full !== null && full > sheet.width - 2 * ROW_GAP
  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    if (full === null) { setFull(element.offsetWidth); return }
    const next = { width: element.offsetWidth, height: element.offsetHeight }
    setSize((was) => (was && was.width === next.width && was.height === next.height ? was : next))
  }, [compact, full, bringOff, pending, sheet.width])

  // (The sheet is letterboxed in the middle of its pane, tabletPage.ts fitRect: the margin under it is the one over it.)
  const place: RowPlace | null = size ? placeRow(box, sheet, size, ROW_GAP, { above: sheet.y, below: sheet.y }) : null
  
  const run = (action: () => void | Promise<void>) => async () => {
    if (pending) return
    setPending(true)
    try { await action() } finally { setPending(false) }
  }
  const off = bringOff !== null
  const mirrorPlace = mirrorAnchor&&size ? mirrorRowPlace(mirrorAnchor,size) : null

  
  const watching = useRef<(() => void) | null>(null)
  useEffect(() => () => watching.current?.(), [])
  const watch = (down: PointerEvent): void => {
    watching.current?.()
    // The native feed's pen decides this itself (penFeed.ts holds its contact back); touch and other mouse buttons stay clicks.
    if (down.pointerId === SYNTH_POINTER_ID || down.pointerType === "touch" || (down.pointerType === "mouse" && down.button !== 0)) return
    const sheet = row.current?.parentElement?.querySelector<HTMLElement>('[data-tablet="surface"]')
    const view = sheet?.ownerDocument.defaultView as (Window & typeof globalThis) | null
    if (!sheet || !view) return
    const start = { x: down.clientX, y: down.clientY }
    const moves: PointerEvent[] = []
    const again = (type: "pointerdown" | "pointermove", from: PointerEvent): PointerEvent => new view.PointerEvent(type, {
      pointerId: down.pointerId, pointerType: down.pointerType, isPrimary: down.isPrimary, width: from.width, height: from.height,
      pressure: from.pressure, tiltX: from.tiltX, tiltY: from.tiltY, clientX: from.clientX, clientY: from.clientY,
      screenX: from.screenX, screenY: from.screenY, button: type === "pointerdown" ? down.button : -1, buttons: from.buttons,
      ctrlKey: from.ctrlKey, altKey: from.altKey, shiftKey: from.shiftKey, metaKey: from.metaKey,
      bubbles: true, cancelable: true, composed: true, view,
    })
    const move = (event: PointerEvent): void => {
      if (event.pointerId !== down.pointerId) return
      if(event.buttons===0&&!(event.pointerType==='pen'&&event.pressure>0)){stop();return}
      moves.push(event)
      if (!rowPressToSheet(sheet.getBoundingClientRect(), start, { x: event.clientX, y: event.clientY }, CLICK_SLOP_PX)) return
      stop()
      // The sheet's from its first point: its own pointerdown there (it takes the pointer), then the moves so far. This move
      // reaches the sheet by itself when it is already over it.
      sheet.dispatchEvent(again("pointerdown", down))
      for (const one of moves) {
        if (one === event && event.target instanceof view.Node && sheet.contains(event.target)) continue
        sheet.dispatchEvent(again("pointermove", one))
      }
    }
    const end = (event: PointerEvent): void => { if (event.pointerId === down.pointerId) stop() }
    const stop = (): void => {
      view.removeEventListener("pointermove", move, true)
      view.removeEventListener("pointerup", end, true)
      view.removeEventListener("pointercancel", end, true)
      view.removeEventListener("blur", stop)
      view.removeEventListener("pagehide", stop)
      if (watching.current === stop) watching.current = null
    }
    view.addEventListener("pointermove", move, true)
    view.addEventListener("pointerup", end, true)
    view.addEventListener("pointercancel", end, true)
    view.addEventListener("blur", stop)
    view.addEventListener("pagehide", stop)
    watching.current = stop
  }

  return (
    <>
    {mirror&&createPortal(<BoxActions box={box} sheet={mirror.sheet} erase={erase} bring={bring} picture={picture} copy={copy} bringOff={bringOff} clear={clear} text={text} mirrorAnchor={mirror.anchor} mirrored/>,mirror.target)}
    <div className="box-actions" ref={row} data-tablet="box-actions" data-pen-handover="" data-side={place?.side ?? ""} data-compact={compact ? "1" : "0"}
         role="group"
         aria-label="The box"
         style={{
           left: mirrorPlace?.left ?? sheet.x + (place?.left ?? 0), top: mirrorPlace?.top ?? sheet.y + (place?.top ?? 0),
           visibility: place && full !== null ? "visible" : "hidden",
         }}
         // The row is not the sheet: a press here never reaches the box's own gestures (one that moves is handed over: `watch`).
         onPointerDown={(event) => { event.stopPropagation(); watch(event.nativeEvent) }}
         onPointerUp={(event) => event.stopPropagation()}
         onContextMenu={(event) => event.preventDefault()}>
      <button type="button" className="primary" data-box-action="ink" disabled={off || pending}
              title={bringOff ?? "Insert the writing inside the box as an image. The sheet keeps it."}
              onClick={run(bring)}>{compact ? "Writing" : "Bring in writing"}</button>
      <button type="button" data-box-action="picture" disabled={off || pending}
              title={bringOff ?? "Bring the boxed part of the sheet into the note as a picture, paper and all. The sheet keeps it."}
              onClick={run(picture)}>Picture</button>
      <span className="sep" aria-hidden />
      <button type="button" data-box-action="copy" disabled={pending} title="Copy the selected drawing as an image" onClick={run(copy)}>Copy</button>
      <button type="button" className="danger" data-box-action="erase" disabled={pending}
              title="Rub out the strokes wholly inside the box; one crossing its edge stays (one Undo on the sheet brings them back)"
              onClick={run(erase)}>Erase</button>

    </div>
    </>
  )
}
