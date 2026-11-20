import React, { useRef } from 'react';
import { Icon } from './icons';
import { MenuButton } from './MenuButton';
import type { MenuItem } from './FloatingMenu';
import { PEN_SWATCHES, PEN_WIDTHS, dotSize, sameInk } from './penLook';
import { PEN_KINDS, kindOff, kindOn, type InkSurface } from './penKinds';
import { setPenKind, setPenTool, usePenSettings, useSheetTools, setSheetEraser, setSheetSelect } from './penSettings';
import { useToolPresetMenu } from './ToolPresetControl';

interface Props {
  colour: string
  width: number
  onColour(hex: string): void
  onWidth(width: number): void
  presets: { controller: any; state: any }
  presetsEnabled?: boolean
  onError?(message: string): void
  /** What the ink is drawn on (penKinds.ts): which kinds of pen it takes. */
  surface?: InkSurface
  /** The open sheet's own actions, on the same bar after the pen's (the pane has two bars, not three). */
  trailing?: React.ReactNode
  /** Opens the sheet that sets what the pen's side buttons do (PenMenu.tsx). */
  onPenSettings?(): void
}

/**
 * The drawing pane's tool bar: the pen (its kind, width and presets in its menu), eraser, select, the colours.
 * The colours are always swatches on the bar. The width, the presets and the paper have buttons of their own only
 * where the bar has room for all of it (pane.css); they are in the pen's and the options menus at every width.
 */
export function PenControl({ colour, width, onColour, onWidth, presets, presetsEnabled, onError, surface = 'sheet', onPenSettings, trailing = null }: Props) {
  const picker = useRef<HTMLInputElement>(null), tools = useSheetTools(), kind = kindOn(usePenSettings().kind, surface);
  const presetMenu = useToolPresetMenu({ controller: presets.controller, state: presets.state, enabled: presetsEnabled, onError });
  const pen = () => { setPenTool('pen'); setSheetEraser(false); setSheetSelect(false); };
  const eraser = () => { setPenTool('eraser'); setSheetSelect(false); setSheetEraser(true); };
  const widths = [...new Set([...PEN_WIDTHS, width])].sort((a, b) => a - b);
  const kindName = PEN_KINDS.find(one => one.value === kind)!.label;
  const menu = (): MenuItem[] => [
    ...PEN_KINDS.map((one): MenuItem => {
      const off = kindOff(one.value, surface);
      return { label: one.label, icon: one.value, checked: kind === one.value, disabled: off !== null, title: off ?? undefined, dataBar: 'pen-kind-' + one.value, onClick: () => { setPenKind(one.value); pen(); } };
    }),
    '-',
    { header: 'Width' },
    { custom: <span className="pen-widths" role="radiogroup" aria-label="Pen width">
      {widths.map(w => <button type="button" key={w} role="radio" aria-checked={w === width} className={'pen-width' + (w === width ? ' on' : '')} data-pen-width={w} title={w + ' px'} onClick={() => onWidth(w)}><i style={{ width: dotSize(w), height: dotSize(w) }} /></button>)}
    </span> },
    '-',
    { label: 'Tool Presets', icon: 'list', dataBar: 'pen-presets', submenu: presetMenu.items() },
    ...(onPenSettings ? [{ label: 'Pen Buttons…', dataBar: 'pen-buttons', onClick: onPenSettings } as MenuItem] : []),
  ];
  return <>
    <span ref={presetMenu.host} className="tool-preset-control pen-kind">
      <MenuButton icon={kind} name={kindName} title={'Write with the ' + kindName.toLowerCase()} on={!tools.eraser && !tools.selectTool} dataBar="pen" data={{ 'pen-kind': kind }} caretDataBar="pen-kinds" menuBar="pen-kinds-menu" optionsLabel="Pen kind, width and presets" menuFromLeft live onMain={pen} items={menu} />
      {presetMenu.dialog}
    </span>
    <button type="button" className={'bar-btn' + (tools.eraser ? ' on' : '')} data-bar="eraser" aria-label="Eraser" aria-pressed={tools.eraser} title="Erase whole strokes" onClick={eraser}><Icon name="eraser" /></button>
    <button type="button" className={'bar-btn' + (tools.selectTool ? ' on' : '')} data-bar="select" aria-label="Select" aria-pressed={tools.selectTool} title="Select strokes, then drag them to move" onClick={() => { setSheetEraser(false); setSheetSelect(true); }}><Icon name="select" /></button>
    <span className="pen-swatches" role="group" aria-label="Pen colour">
      {PEN_SWATCHES.map(s => <button type="button" key={s.hex} className={'pen-swatch' + (sameInk(s.hex, colour) ? ' on' : '')} style={{ background: s.hex }} title={s.name} aria-label={s.name} aria-pressed={sameInk(s.hex, colour)} onClick={() => onColour(s.hex)} />)}
      <button type="button" className="pen-swatch custom" title="Custom colour…" aria-label="Custom colour" onClick={() => picker.current?.click()} />
    </span>
    <input ref={picker} type="color" value={colour} className="native-colour" aria-label="Choose custom pen colour" tabIndex={-1} onChange={e => onColour(e.target.value)} />
    <select className="pen-width-select" title="Pen width" aria-label="Pen width" value={width} onChange={e => onWidth(Number(e.target.value))}>
      {widths.map(w => <option key={w} value={w}>{w} px</option>)}
    </select>
    <MenuButton icon="list" className="pen-presets" name="Tool presets" title="Tool presets" dataBar="tool-presets" live items={presetMenu.items} />
    {trailing}
  </>;
}
