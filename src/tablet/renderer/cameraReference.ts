import type {Point,Rect,Size} from '@notemind/core'
import {rotateSheetPoint,type Turns} from '../shared/orientation'
import {inkToScreen,screenToInk,type InkView} from './cameraInkGeometry'

const turns=(degrees:number):Turns=>((Math.round(degrees/90)%4+4)%4) as Turns
const upright=(raw:Size,turn:Turns):Size=>turn%2?{width:raw.height,height:raw.width}:raw
const frame=(size:Size,aspect:'free'|number):Rect=>{
  const ratio=aspect==='free'?size.width/size.height:aspect
  const width=Math.min(size.width,size.height*ratio),height=Math.min(size.height,size.width/ratio)
  return {x:(size.width-width)/2,y:(size.height-height)/2,width,height}
}
export function cameraReference(raw:Size,settings:{rotation?:number;aspect?:string;inkRotation?:number;inkAspect?:'free'|number}) {
  const current=turns(settings.rotation||0),original=turns(settings.inkRotation??settings.rotation??0),delta=((current-original+4)%4) as Turns
  const now=upright(raw,current),before=upright(raw,original),preview=frame(now,settings.aspect==='free'||settings.aspect==null?'free':Number(settings.aspect))
  const base=frame(before,settings.inkAspect??(settings.aspect==='free'||settings.aspect==null?'free':Number(settings.aspect)))
  const referenceWidth=delta%2?base.height:base.width,referenceHeight=delta%2?base.width:base.height
  const reference={x:(now.width-referenceWidth)/2,y:(now.height-referenceHeight)/2,width:referenceWidth,height:referenceHeight}
  return {upright:now,preview,reference,turns:delta}
}
export type CameraReference=ReturnType<typeof cameraReference>
export function cameraInkView(layout:CameraReference,view:InkView):InkView {
  const sx=view.shown.width/layout.preview.width,sy=view.shown.height/layout.preview.height
  return {...view,turns:layout.turns,clip:view.shown,shown:{
    x:view.shown.x+(layout.reference.x-layout.preview.x)*sx,y:view.shown.y+(layout.reference.y-layout.preview.y)*sy,
    width:layout.reference.width*sx,height:layout.reference.height*sy,
  }}
}
export function inkToPreview(point:Point,layout:CameraReference):Point {
  const rotated=rotateSheetPoint(point,layout.turns)
  return {x:(layout.reference.x+rotated.x*layout.reference.width-layout.preview.x)/layout.preview.width,
    y:(layout.reference.y+rotated.y*layout.reference.height-layout.preview.y)/layout.preview.height}
}
export function selectionInInk(box:Rect,preview:InkView,ink:InkView):Rect {
  const points=[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x,y:box.y+box.height},{x:box.x+box.width,y:box.y+box.height}]
    .map(point=>screenToInk(inkToScreen(point,preview),ink))
  const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y))
  return {x,y,width:Math.max(...points.map(point=>point.x))-x,height:Math.max(...points.map(point=>point.y))-y}
}
