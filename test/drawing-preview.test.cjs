const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {surfaceHarness,load}=require('./helpers/tablet-surface.cjs'),{snapshotDrawing,svgDrawing,denseDrawing,pngDrawingSvg,canvasPng}=load('src/tablet/renderer/drawingSnapshot.ts');
const paper={kind:'dots',spacing:'medium',colour:'white'},png='data:image/png;base64,aGVsbG8=';
test('cached surface preview freezes both paper and ink pixels before asynchronous encoding',async()=>{
 const copies=[];let complete;const canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>copies.push(args)})},h=surfaceHarness({canvasFactory:()=>canvas,encodePreview:()=>new Promise(resolve=>complete=resolve)});
 h.pointer('pointerdown',100,200);h.pointer('pointermove',200,300);h.pointer('pointerup',300,400);
 const snapshot=snapshotDrawing({name:'Frozen',aspect:h.page.aspect,strokes:h.page.strokes,viewport:h.page.viewport,backdrop:null,paper}),pending=h.handle.current.preview(snapshot);
 assert.ok(pending);assert.equal(copies.length,2);assert.ok(canvas.width*canvas.height<=4*1024*1024);assert.ok(canvas.width<=4096&&canvas.height<=4096);
 h.page.add({colorHex:'#112233',width:3,points:[{x:.9,y:.9}]});h.unmount();complete(png);assert.equal(await pending,png);assert.equal(copies.length,2);
});
test('cached preview refuses a stale geometry snapshot instead of omitting new ink',()=>{
 const h=surfaceHarness();h.pointer('pointerdown',100,200);h.pointer('pointerup',200,300);const snapshot=snapshotDrawing({name:'Old',aspect:h.page.aspect,strokes:h.page.strokes,viewport:h.page.viewport,backdrop:null,paper});h.page.add({colorHex:'#112233',width:2,points:[{x:.5,y:.5}]});assert.equal(h.handle.current.preview(snapshot),null);h.unmount();
});
test('dense production insertion retains its initiating drawing, crop and Notepad across preview encoding',async()=>{
 const source=fs.readFileSync('src/tablet-entry.tsx','utf8'),implementation=source.slice(source.indexOf(' const drawingSvg='),source.indexOf(' const selectionRaster=')),events=[],origin={id:'original note'},original={aspect:1,strokes:[{colorHex:'#123456',width:2,points:Array.from({length:50000},(_,i)=>({x:i/50000,y:.5}))}],viewport:{x:0,y:0,width:1,height:1},backdrop:null};let complete,seen;
 const context={page:{current:original},sheets:[{name:'Original drawing',page:original,paper}],box:null,paper:()=>paper,snapshotDrawing,svgDrawing,denseDrawing,pngDrawingSvg,canvasPng,graphics:require('../src/graphics-pane.js'),btoa:value=>Buffer.from(value,'binary').toString('base64'),surface:{current:{preview:snapshot=>{seen=snapshot;return new Promise(resolve=>complete=resolve)}}},exportDrawingAssets:async(snapshot)=>({sidecar:require('../src/graphics-pane.js').bytesBase64(require('../src/graphics-pane.js').encodeBytes(snapshot))}),setSaveError:message=>{throw Error(message)},window:{NoteMindNotes:{captureInsertion:()=>({tab:origin,text:'original'})},dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}};
 vm.runInNewContext(implementation+';globalThis.insertDrawing=insert;',context);const pending=context.insertDrawing();assert.equal(events.length,0);assert.equal(seen.strokes[0],original.strokes[0]);original.strokes=[];context.page.current={aspect:2,strokes:[]};context.sheets[0].name='Renamed later';complete(png);await pending;
 assert.equal(events.length,1);assert.equal(events[0].detail.insertion.tab,origin);const restored=require('../src/graphics-pane.js').decodeBase64(events[0].detail.sidecar);assert.equal(restored.name,'Original drawing');assert.equal(restored.strokes[0].points.length,50000);assert.match(Buffer.from(events[0].detail.data,'base64').toString(),/data:image\/png;base64,aGVsbG8=/);assert.match(Buffer.from(events[0].detail.data,'base64').toString(),/viewBox="0 0 1000 1000"/);
});
test('failed background decoding cannot produce a silently incomplete drawing export',async()=>{
 const {rasterDrawing}=load('src/tablet/renderer/drawingSnapshot.ts'),snapshot=snapshotDrawing({name:'Background',aspect:1,strokes:[],backdrop:'data:image/png;base64,aGVsbG8=',paper});let painted=false;
 await assert.rejects(rasterDrawing(snapshot,true,{canvas:()=>({getContext:()=>({})}),paintPaper(){},backdropReady:async()=>null,paintStrokes(){painted=true}}),/drawing background/);assert.equal(painted,false);
});
