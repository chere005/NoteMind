

import { BAR_BTN } from "./cameraHeaderFit"

const GAP = 2
const PAD = 12

const CONVERT_LONG = 149
const CONVERT_SHORT = 70
const CANCEL = 56

const ZOOM = 104

const ZOOM_ARROWS = 54

const ROTATE = 54

const VIEW_WORD = 56
const VIEW_ICON = BAR_BTN

const BACK = 150

export interface DocumentHeaderInput {
  
  width: number
  
  pdf: boolean
  
  picture?: boolean
  
  converting: boolean
  
  backToNotes: boolean
  
  view?: boolean
}

export interface DocumentHeaderFit {
  
  longLabel: boolean
  
  percent: boolean
  
  viewWord: boolean
  
  rotate: boolean
}


export function documentHeaderWidth(longLabel: boolean, { pdf, picture, converting, backToNotes, view = true }: Omit<DocumentHeaderInput, "width">, percent = true, viewWord = false, rotate = true): number {
  const first = converting ? CANCEL : longLabel ? CONVERT_LONG : CONVERT_SHORT
  return PAD + first + (pdf || picture ? GAP + (percent ? ZOOM : ZOOM_ARROWS) : 0) + (picture && rotate ? GAP + ROTATE : 0)
    + (view ? GAP + (viewWord ? VIEW_WORD : VIEW_ICON) : 0) + (backToNotes ? GAP + BACK : 0) + 2 * (GAP + BAR_BTN)
}


const LADDER: readonly (readonly [boolean, boolean, boolean, boolean])[] = [
  [true, true, true, true],
  [true, false, true, true],
  [false, false, true, true],
  [false, false, false, true],
  [false, false, false, false],
]

export function documentHeaderFit(input: DocumentHeaderInput): DocumentHeaderFit {
  const row = LADDER.find(([longLabel, viewWord, percent, rotate]) => documentHeaderWidth(longLabel, input, percent, viewWord, rotate) <= input.width) ?? LADDER[LADDER.length - 1]!
  return { longLabel: row[0], viewWord: row[1], percent: row[2], rotate: row[3] }
}
