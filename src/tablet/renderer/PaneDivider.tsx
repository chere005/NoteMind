

import { useCallback, useEffect, useRef, useState } from "react"
import { fractionFor, isMaximised, maxVideoWidth, readFraction, videoWidth } from "../shared/layout"

const KEY = "notemind.videoFraction"

function load(): number | null {
  try { return readFraction(localStorage.getItem(KEY)) } catch { return null }
}
function store(fraction: number | null): void {
  try {
    if (fraction === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(fraction))
  } catch {  }
}

interface Props {
  
  sidebar: boolean
}

export function PaneDivider({ sidebar }: Props) {
  const self = useRef<HTMLDivElement>(null)
  const fraction = useRef<number | null>(load())
  
  const before = useRef<{ fraction: number | null } | null>(null)
  const [dragging, setDragging] = useState(false)

  const app = (): HTMLElement | null => self.current?.closest<HTMLElement>(".workspace") ?? null

  
  const available = useCallback((): number => {
    const root = app()
    if (!root) return 0
    const side = root.querySelector<HTMLElement>(".sidebar:not([hidden])")
    return root.clientWidth - (side ? side.getBoundingClientRect().width : 0)
  }, [])

  const apply = useCallback(() => {
    const root = app()
    const room = available()
    if (!root || room <= 0) return
    root.style.setProperty("--video-w", `${videoWidth(room, fraction.current)}px`)
  }, [available])

  // Re-measured whenever the window, the sidebar or the display scale changes.
  useEffect(() => {
    apply()
    const root = app()
    if (!root) return
    const watcher = new ResizeObserver(apply)
    watcher.observe(root)
    return () => watcher.disconnect()
  }, [apply, sidebar])

  const move = (clientX: number) => {
    const root = app()
    const room = available()
    if (!root || room <= 0) return
    const video = root.getBoundingClientRect().right - clientX
    fraction.current = fractionFor(room, videoWidth(room, fractionFor(room, video)))
    apply()
  }

  
  const toggleFull = () => {
    const room = available()
    if (room <= 0) return
    if (isMaximised(room, fraction.current)) {
      fraction.current = before.current ? before.current.fraction : null
      before.current = null
    } else {
      before.current = { fraction: fraction.current }
      fraction.current = fractionFor(room, maxVideoWidth(room))
    }
    store(fraction.current)
    apply()
  }

  const nudge = (delta: number) => {
    const room = available()
    if (room <= 0) return
    const now = videoWidth(room, fraction.current)
    fraction.current = fractionFor(room, videoWidth(room, fractionFor(room, now + delta)))
    apply()
    store(fraction.current)
  }

  return (
    <div ref={self} className={`pane-divider${dragging ? " dragging" : ""}`}
         role="separator" aria-orientation="vertical" aria-label="Resize the notes and the video"
         tabIndex={0}
         title="Drag to resize — double-click: the video at full size (again: back)"
         onPointerDown={(event) => {
           if (event.button !== 0) return
           // The mouse must not take the keyboard from the notes.
           event.preventDefault()
           event.currentTarget.setPointerCapture(event.pointerId)
           setDragging(true)
         }}
         onPointerMove={(event) => { if (dragging) move(event.clientX) }}
         onPointerUp={(event) => {
           if (!dragging) return
           setDragging(false)
           try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {  }
           store(fraction.current)
         }}
         onPointerCancel={() => { setDragging(false); store(fraction.current) }}
         onDoubleClick={toggleFull}
         onKeyDown={(event) => {
           if (event.key === "ArrowLeft") { event.preventDefault(); nudge(24) }
           else if (event.key === "ArrowRight") { event.preventDefault(); nudge(-24) }
           else if (event.key === "Home") { event.preventDefault(); fraction.current = null; before.current = null; store(null); apply() }
         }} />
  )
}
