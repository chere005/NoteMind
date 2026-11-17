import React, { useRef } from 'react';
import { Icon } from './icons';
import { DrawingLocation } from './DrawingLocation';
import { MenuButton } from './MenuButton';
import { PEN_SWATCHES, PEN_WIDTHS, sameInk } from './penLook';
import { setPenTool, useSheetTools, setSheetEraser, setSheetSelect } from './penSettings';
import { ToolPresetControl } from './ToolPresetControl';

export function PenControl({ colour, width, onColour, onWidth, presets, presetsEnabled, onError }) {
  const picker = useRef<HTMLInputElement>(null), tools = useSheetTools();
  const pen = () => { setPenTool('pen'); setSheetEraser(false); setSheetSelect(false); };
  const eraser = () => { setPenTool('eraser'); setSheetSelect(false); setSheetEraser(true); };
  return <>
    <button type="button" className={'bar-btn' + (!tools.eraser && !tools.selectTool ? ' on' : '')} data-bar="pen" aria-label="Pen" aria-pressed={!tools.eraser && !tools.selectTool} title="Write with the pen" onClick={pen}><Icon name="pen" /></button>
    <button type="button" className={'bar-btn' + (tools.eraser ? ' on' : '')} data-bar="eraser" aria-label="Eraser" aria-pressed={tools.eraser} title="Erase whole strokes" onClick={eraser}><Icon name="eraser" /></button>
    <button type="button" className={'bar-btn' + (tools.selectTool ? ' on' : '')} data-bar="select" aria-label="Select" aria-pressed={tools.selectTool} title="Select strokes, then drag them to move" onClick={() => { setSheetEraser(false); setSheetSelect(true); }}><Icon name="select" /></button>
    <span className="pen-swatches" role="group" aria-label="Pen colour">
      {PEN_SWATCHES.map(s => <button type="button" key={s.hex} className={'pen-swatch' + (sameInk(s.hex, colour) ? ' on' : '')} style={{ background: s.hex }} title={s.name} aria-label={s.name} aria-pressed={sameInk(s.hex, colour)} onClick={() => onColour(s.hex)} />)}
      <button type="button" className="pen-swatch custom" title="Custom colour…" aria-label="Custom colour" onClick={() => picker.current?.click()} />
    </span>
    <MenuButton icon="pen" className="pen-colour-menu" name="Pen colour" title="Pen colour" style={{color:colour}} dataBar="pen-colour-menu" live items={()=>[
      ...PEN_SWATCHES.map(s=>({label:s.name,checked:sameInk(s.hex,colour),dataBar:'pen-colour-'+s.name.toLowerCase(),onClick:()=>onColour(s.hex)})),
      {label:'Custom colour…',onClick:()=>picker.current?.click()},
    ]}/>
    <input ref={picker} type="color" value={colour} className="native-colour" aria-label="Choose custom pen colour" tabIndex={-1} onChange={e => onColour(e.target.value)} />
    <select className="pen-width-select" aria-label="Pen width" value={width} onChange={e => onWidth(Number(e.target.value))}>
      {[...new Set([...PEN_WIDTHS, width])].sort((a, b) => a - b).map(w => <option key={w} value={w}>{w} px</option>)}
    </select>
    {presets&&<ToolPresetControl controller={presets.controller} state={presets.state} enabled={presetsEnabled} onError={onError}/>}
    <DrawingLocation />
  </>;
}
