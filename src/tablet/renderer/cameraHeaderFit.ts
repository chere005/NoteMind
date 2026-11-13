import { CARET_WIDTH } from './splitButton'
export const BAR_BTN=28
const GAP=2,PAD=12,INSERT_WORDS=150
export interface HeaderFitInput {width:number;zoomed:boolean;backToNotes:boolean}
export interface HeaderFit {words:boolean;readout:boolean;turns:boolean;undo:boolean;keep:boolean}
// Core camera actions stay put; rotation and ink actions remain in Camera options.
export function headerWidth(words:boolean,_readout:boolean,backToNotes:boolean,turns=true,undo=true,keep=true):number {
 const controls=5+(keep?1:0)+(turns?2:0)+(undo?2:0)+(backToNotes?1:0)
 return PAD+(BAR_BTN+CARET_WIDTH)+BAR_BTN*3+(words?INSERT_WORDS:BAR_BTN+CARET_WIDTH)+(keep?BAR_BTN:0)+(turns?BAR_BTN*2:0)+(undo?BAR_BTN*2:0)+(backToNotes?BAR_BTN:0)+(controls-1)*GAP
}
export function headerFit({width,backToNotes}:HeaderFitInput):HeaderFit {
 for(const [words,turns,undo]of [[true,true,true],[true,false,true],[true,false,false],[false,false,true],[false,false,false]])if(headerWidth(words,false,backToNotes,turns,undo)<=width)return {words,turns,undo,readout:false,keep:true}
 return {words:false,turns:false,undo:false,readout:false,keep:true}
}
