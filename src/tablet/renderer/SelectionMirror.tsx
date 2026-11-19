import {useContext, useLayoutEffect, useState, type RefObject} from 'react'
import {PaneChromeContext} from './PaneChrome'

type Sheet = {x:number; y:number; width:number; height:number}
export type MirrorAnchor = {left:number; top:number; width:number; height:number; side:string; stage:Sheet}

export function mirrorRowPlace(anchor:MirrorAnchor, row:{width:number; height:number}) {
	const left = anchor.left + (anchor.width - row.width) / 2
	const top = anchor.side === 'below' ? anchor.top : anchor.top + anchor.height - row.height
	return {
		left:Math.max(0, Math.min(anchor.stage.width - row.width, left)),
		top:Math.max(0, Math.min(anchor.stage.height - row.height, top)),
	}
}

// The page mirror contains pixels; these controls use the main window's actual CSS pixel size.
export function useSelectionMirror(anchor:RefObject<HTMLDivElement|null>, sheet:Sheet, mirrored:boolean) {
	const target = useContext(PaneChromeContext)?.overlay
	const [mapped, setMapped] = useState<{sheet:Sheet; anchor:MirrorAnchor}|null>(null)
	useLayoutEffect(() => {
		const source = anchor.current?.parentElement
		if (mirrored || !source || !target) return
		const measure = () => {
			const scale = target.clientWidth / source.clientWidth
			if (!(scale > 0) || !Number.isFinite(scale)) return
			const element = anchor.current!
			const next = {
				sheet:{x:sheet.x*scale, y:sheet.y*scale, width:sheet.width*scale, height:sheet.height*scale},
				anchor:{left:element.offsetLeft*scale, top:element.offsetTop*scale,
					width:element.offsetWidth*scale, height:element.offsetHeight*scale, side:element.dataset.side || '',
					stage:{x:0, y:0, width:target.clientWidth, height:target.clientHeight}},
			}
			setMapped(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
		}
		const observer = new ResizeObserver(measure)
		observer.observe(source)
		observer.observe(target)
		observer.observe(anchor.current!)
		const changes = new MutationObserver(measure)
		changes.observe(anchor.current!, {attributes:true, attributeFilter:['style', 'data-side']})
		measure()
		return () => {observer.disconnect(); changes.disconnect()}
	}, [target, mirrored, sheet.x, sheet.y, sheet.width, sheet.height])
	return !mirrored && target && mapped ? {target, ...mapped} : null
}
