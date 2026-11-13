

import { CARET_WIDTH } from "./splitButton"

export const BAR_BTN = 28
const GAP = 2
const PAD = 12

const SEG_WORDS = 152   // (measured 150.3 on a Mac, 2026-10-18; the fonts of a PC and an Arch machine are not this one's)
const SEG_ICONS = 84

const READOUT = 34

const BACK = 150



export interface HeaderFitInput {
  
  width: number
  
  zoomed: boolean
  
  backToNotes: boolean
}

export interface HeaderFit {
  
  words: boolean
  
  readout: boolean
  
  turns: boolean
  
  undo: boolean
  
  keep: boolean
}


export function headerWidth(words: boolean, readout: boolean, backToNotes: boolean, turns = true, undo = true, keep = true): number {
  // Zoom and Find Page are split buttons; Undo, Clear, Hold, Keep Page and the two turns are plain buttons.
  const tools = (turns ? 5 : 3) + (undo ? 2 : 0) + (keep ? 1 : 0)
  const carets = 2
  // The gaps are between the tools (tools - 1), then the tools and the spacer, the spacer and the segments, the segments and the close button.
  const left = tools * BAR_BTN + carets * CARET_WIDTH + (tools + 2) * GAP + (readout ? READOUT : 0) + (backToNotes ? BACK + GAP : 0)
  const right = (words ? SEG_WORDS : SEG_ICONS) + BAR_BTN
  return PAD + left + right
}

export function headerFit({ width, zoomed, backToNotes }: HeaderFitInput): HeaderFit {
  // (every rung but the last keeps Keep Page: it is the last thing to go)
  const fits = (words: boolean, readout: boolean, turns: boolean, undo: boolean): boolean =>
    headerWidth(words, readout, backToNotes, turns, undo, true) <= width
  if (fits(true, zoomed, true, true)) return { words: true, readout: zoomed, turns: true, undo: true, keep: true }
  if (fits(true, false, true, true)) return { words: true, readout: false, turns: true, undo: true, keep: true }
  if (zoomed && fits(false, true, true, true)) return { words: false, readout: true, turns: true, undo: true, keep: true }
  if (fits(false, false, true, true)) return { words: false, readout: false, turns: true, undo: true, keep: true }
  if (zoomed && fits(false, true, false, true)) return { words: false, readout: true, turns: false, undo: true, keep: true }
  if (fits(false, false, false, true)) return { words: false, readout: false, turns: false, undo: true, keep: true }
  if (zoomed && fits(false, true, false, false)) return { words: false, readout: true, turns: false, undo: false, keep: true }
  if (fits(false, false, false, false)) return { words: false, readout: false, turns: false, undo: false, keep: true }
  return { words: false, readout: false, turns: false, undo: false, keep: false }
}
