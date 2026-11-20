

import { useCallback, useEffect, useRef, useState } from "react"
import { DRAWING_PANE_WIDTH, fractionFor, maxVideoWidth, readFraction, videoWidth } from "../shared/layout"

const KEY = "notemind.videoFraction"
type PaneSize = number | null | 'drawing'

function load(): PaneSize {
  try { const saved = localStorage.getItem(KEY); return saved === 'drawing' ? saved : readFraction(saved) } catch { return null }
}
function store(fraction: PaneSize): void {
  try {
    if (fraction === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(fraction))
  } catch {  }
}

interface Props {
  sidebar: boolean
	onResetDrawing?: () => void
}

export function PaneDivider({ sidebar, onResetDrawing }: Props) {
  const self = useRef<HTMLDivElement>(null)
  const fraction = useRef<PaneSize>(load())
  const before = useRef<{ fraction: PaneSize } | null>(null)
  const [dragging, setDragging] = useState(false)
  const pointer=useRef<{id:number;node:HTMLElement;x:number;width:number;size:PaneSize}|null>(null)
  const width = (room: number) => videoWidth(room, fraction.current === 'drawing' ? DRAWING_PANE_WIDTH / room : fraction.current)

  const app = (): HTMLElement | null => self.current?.closest<HTMLElement>(".workspace") ?? null

  
  const available = useCallback((): number => {
    const root = app()
    if (!root) return 0
    const side = root.querySelector<HTMLElement>(".sidebar:not([hidden])")
    const divider = self.current?.parentElement?.getBoundingClientRect().width ?? 0
    return root.clientWidth - (side ? side.getBoundingClientRect().width : 0) - divider
  }, [])

  const apply = useCallback(() => {
    const root = app()
    const room = available()
    if (!root || room <= 0) return
    root.style.setProperty("--video-w", `${width(room)}px`)
  }, [available])

  // Re-measured whenever the window, the sidebar or the display scale changes.
  useEffect(() => {
    apply()
    const root = app()
    if (!root) return
    const watcher = new ResizeObserver(apply)
    watcher.observe(root)
    const side = root.querySelector<HTMLElement>('.sidebar')
    if (side) watcher.observe(side)
    return () => watcher.disconnect()
  }, [apply, sidebar])

  const move = (clientX: number) => {
    const start = pointer.current
    const room = available()
    if (!start || room <= 0) return
    const video = start.width + start.x - clientX
    fraction.current = clientX === start.x ? start.size : fractionFor(room, videoWidth(room, fractionFor(room, video)))
    apply()
  }

  
  const toggleFull = () => {
    const room = available()
    if (room <= 0) return
	if (onResetDrawing) {
		before.current = null
		fraction.current = 'drawing'
		onResetDrawing()
	} else if (width(room) >= maxVideoWidth(room) - 1) {
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
    const now = width(room)
    fraction.current = fractionFor(room, videoWidth(room, fractionFor(room, now + delta)))
    apply()
    store(fraction.current)
  }

  const ownsPointer=(event:{pointerId:number;currentTarget:HTMLElement})=>pointer.current?.id===event.pointerId&&pointer.current.node===event.currentTarget
  const finishPointer=(event:React.PointerEvent<HTMLDivElement>,commit=false)=>{
    if(!ownsPointer(event)||event.type==='lostpointercapture'&&event.currentTarget.hasPointerCapture(event.pointerId))return
    if(commit)move(event.clientX)
    pointer.current=null;setDragging(false)
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
    store(fraction.current)
  }

  return (
    <div ref={self} className={`pane-divider${dragging ? " dragging" : ""}`}
         role="separator" aria-orientation="vertical" aria-label="Resize editor and capture pane"
         tabIndex={0}
         title={onResetDrawing ? "Drag to resize · Double-click to reset drawing size and Fit" : "Drag to resize · Double-click to expand or restore"}
         onPointerDown={(event) => {
           if (event.button !== 0||pointer.current) return
           // The mouse must not take the keyboard from the notes.
           event.preventDefault()
           const room=available()
           if(room<=0)return
           try{event.currentTarget.setPointerCapture(event.pointerId)}catch{return}
           pointer.current={id:event.pointerId,node:event.currentTarget,x:event.clientX,width:width(room),size:fraction.current}
           setDragging(true)
         }}
         onPointerMove={(event) => { if (ownsPointer(event)) move(event.clientX) }}
         onPointerUp={event=>finishPointer(event,true)}
         onPointerCancel={event=>finishPointer(event)}
         onLostPointerCapture={event=>finishPointer(event)}
         onDoubleClick={toggleFull}
         onKeyDown={(event) => {
           if(event.defaultPrevented||event.isComposing||event.nativeEvent?.isComposing||event.keyCode===229||event.nativeEvent?.keyCode===229)return
           if (event.key === "ArrowLeft") { event.preventDefault(); nudge(24) }
           else if (event.key === "ArrowRight") { event.preventDefault(); nudge(-24) }
           else if (event.key === "Home") { event.preventDefault(); fraction.current = null; before.current = null; store(null); apply() }
         }} />
  )
}
