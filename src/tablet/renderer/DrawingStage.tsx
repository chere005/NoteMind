import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { fitWacomDrawing, type DrawingDisplay } from '../shared/layout'

type Size = { width: number; height: number }

export function DrawingStage({ display, children }: { display: DrawingDisplay | null; children: ReactNode }) {
	const stage = useRef<HTMLDivElement>(null)
	const [size, setSize] = useState<Size | null>(null)
	useLayoutEffect(() => {
		const element = stage.current, pane = element?.closest<HTMLElement>('.tablet-pane')
		if (!display || !element || !pane || element.ownerDocument !== document) {
			setSize(null)
			return
		}
		const measure = () => {
			const available = element.getBoundingClientRect()
			const chrome = display.chromeHeight ?? pane.getBoundingClientRect().height - available.height
			const next = fitWacomDrawing(available, display, chrome)
			setSize(previous => previous?.width === next.width && previous.height === next.height ? previous : next)
		}
		const observer = new ResizeObserver(measure)
		observer.observe(pane)
		observer.observe(element)
		measure()
		return () => observer.disconnect()
	}, [display])
	return <div className="tablet-stage" data-pad-content ref={stage}>
		<div className="drawing-frame" style={size ?? undefined}>{children}</div>
	</div>
}
