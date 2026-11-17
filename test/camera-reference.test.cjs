const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {load}=require('./helpers/tablet-surface.cjs'),{cameraReference,cameraInkView,inkToPreview,selectionInInk}=load('src/tablet/renderer/cameraReference.ts'),{inkToScreen,screenToInk,onPicture,inkUnit}=load('src/tablet/renderer/cameraInkGeometry.ts');
const rotate=(p,n)=>n===1?{x:1-p.y,y:p.x}:n===2?{x:1-p.x,y:1-p.y}:n===3?{x:p.y,y:1-p.x}:p;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} equals ${b}`);

test('camera crops and quarter turns preserve original ink against exact source pixels',()=>{
 const raw={width:1920,height:1080};for(const original of [0,1,2,3])for(const turn of [0,1,2,3])for(const aspect of ['free','1',String(4/3),String(16/9)]){
  const base=cameraReference(raw,{rotation:original*90,aspect:'1',inkRotation:original*90,inkAspect:1});
  const layout=cameraReference(raw,{rotation:turn*90,aspect,inkRotation:original*90,inkAspect:1});
  for(const point of [{x:.2,y:.3},{x:.5,y:.5},{x:.7,y:.65}]){const initial=rotate(point,original),before={x:(initial.x*base.upright.width-base.reference.x)/base.reference.width,y:(initial.y*base.upright.height-base.reference.y)/base.reference.height},actual=inkToPreview(before,layout),current=rotate(point,turn);near(actual.x,(current.x*layout.upright.width-layout.preview.x)/layout.preview.width);near(actual.y,(current.y*layout.upright.height-layout.preview.y)/layout.preview.height);}
 }
});
test('newly exposed crop margins remain writable without moving old ink or stretching its widths',()=>{
 const layout=cameraReference({width:1920,height:1080},{rotation:0,aspect:'free',inkRotation:0,inkAspect:1}),preview={size:{width:1000,height:800},shown:{x:20,y:100,width:960,height:540},zoom:null},view=cameraInkView(layout,preview),left=screenToInk({x:20,y:370},view);assert.ok(left.x<0);near(left.y,.5);const actual=inkToScreen(left,view);near(actual.x,20);near(actual.y,370);assert.equal(onPicture({x:19,y:370},view),false);assert.equal(onPicture({x:20,y:370},view),true);near(inkUnit(view),.54);
});
test('rotated and zoomed pen mapping, visible clipping and selection share one reference frame',()=>{
 for(const turn of [0,1,2,3]){const layout=cameraReference({width:1600,height:900},{rotation:turn*90,aspect:'1',inkRotation:0,inkAspect:'free'}),preview={size:{width:800,height:1000},shown:{x:100,y:200,width:600,height:600},zoom:{x:.2,y:.1,width:.7,height:.7}},view=cameraInkView(layout,preview),point={x:.5,y:.5},screen=inkToScreen(point,view),restored=screenToInk(screen,view);near(restored.x,point.x);near(restored.y,point.y);const selected=selectionInInk({x:.25,y:.25,width:.5,height:.5},preview,view);assert.ok(selected.width>0&&selected.height>0);const again=inkToPreview({x:selected.x+selected.width/2,y:selected.y+selected.height/2},layout);near(again.x,.5);near(again.y,.5);}
});
test('actual camera rotation changes only the view and retains the ink Undo coordinate frame',()=>{
 const source=fs.readFileSync('src/tablet/renderer/CameraWorkspace.tsx','utf8'),start=source.indexOf(' const rotate='),end=source.indexOf('\n\n',start);let model={page:{get strokes(){throw Error('Rotation must not scan or replace ink');}},rotation:0,aspect:'free'},finished=0;const context={pageOpening:false,ink:{current:{finish(){finished++;}}},page:{current:model.page},setPages:fn=>{model=fn([model])[0];},setBox(){},setCorners(){},setZoom(){},setRevision(){}};vm.runInNewContext(source.slice(start,end)+';globalThis.rotateCamera=rotate;',context);context.rotateCamera(90);assert.equal(model.rotation,90);assert.equal(model.inkRotation,0);assert.equal(model.inkAspect,'free');context.rotateCamera(90);assert.equal(model.rotation,180);assert.equal(model.inkRotation,0);assert.equal(finished,2);
});
