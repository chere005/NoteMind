import './precisionView.css'
export function PrecisionControls({zoom,onZoom,onFit,line,angle,onLine,onAngle}:{zoom:number;onZoom:(factor:number)=>void;onFit:()=>void;line:boolean;angle:number;onLine:(enabled:boolean)=>void;onAngle:(value:number)=>void}){
 return <div className="precision-controls" role="toolbar" aria-label="Drawing view and line tools" onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()}>
   <button type="button" title="Zoom out" aria-label="Zoom out" data-precision="out" disabled={zoom<=1} onClick={()=>onZoom(.5)}>−</button>
   <button type="button" title="Fit the whole drawing page" aria-label="Fit drawing page" data-precision="fit" onClick={onFit}>{Math.round(zoom*100)}%</button>
   <button type="button" title="Zoom in" aria-label="Zoom in" data-precision="in" disabled={zoom>=64} onClick={()=>onZoom(2)}>+</button>
   <span aria-hidden="true"/>
   <button type="button" title="Draw straight lines" aria-label="Straight line" aria-pressed={line} data-precision="line" onClick={()=>onLine(!line)}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 13 13 3" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></button>
   <select title="Straight-line angle constraint" aria-label="Line angle constraint" data-precision="angle" value={angle} onChange={event=>onAngle(Number(event.target.value))}>
     <option value={0}>Free</option><option value={15}>15°</option><option value={45}>45°</option><option value={90}>90°</option>
   </select>
 </div>
}
