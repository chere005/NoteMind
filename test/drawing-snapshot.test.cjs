const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
const built=buildSync({entryPoints:['src/tablet/renderer/drawingSnapshot.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],alias:{'@notemind/core':require('node:path').resolve('src/tablet/core.js')}}),loaded={exports:{}};vm.runInNewContext(built.outputFiles[0].text,{module:loaded,exports:loaded.exports,require});
const {snapshotDrawing,rasterDrawing,svgDrawing,denseDrawing,pngDrawingSvg,canvasPng,writingRegion}=loaded.exports;
test('a delayed drawing export keeps its original backdrop, ink, selection, paper and target',async()=>{
 const stroke={colorHex:'#123456',width:3,points:[{x:.2,y:.3}]},paper={kind:'dots',spacing:'small',colour:'cream'},selection={x:.1,y:.2,width:.4,height:.5},source={name:'A',aspect:2,backdrop:'background-A',strokes:[stroke],paper,target:{tabId:'A',assetName:'A.png'}},snapshot=snapshotDrawing(source,selection);let decode;const calls=[];
 const ctx={save(){},scale(){},translate(){},restore(){}},canvas={getContext:()=>ctx},pending=rasterDrawing(snapshot,true,{canvas:()=>canvas,paintPaper:(_ctx,p)=>calls.push(['paper',p.colour]),backdropReady:name=>{calls.push(['decode',name]);return new Promise(resolve=>decode=resolve)},paintBackdrop:(_ctx,image)=>calls.push(['background',image]),paintStrokes:(_ctx,strokes)=>calls.push(['ink',strokes[0]]),inkOn:(_p,c)=>c});
 source.strokes=[];source.aspect=.5;source.backdrop='background-B';source.target.assetName='B.png';paper.colour='dark';selection.width=.9;decode('image-A');await pending;
 assert.equal(canvas.width,400);assert.equal(canvas.height,250);assert.equal(snapshot.strokes[0],stroke);assert.equal(snapshot.target.assetName,'A.png');assert.equal(snapshot.region.width,.4);assert.deepEqual(calls.map(call=>call[0]),['paper','decode','background','ink']);assert.equal(calls[0][1],'cream');assert.equal(calls[1][1],'background-A');assert.equal(calls[2][1],'image-A');assert.equal(calls[3][1],stroke);
});

test('inserted SVG contains the chosen paper colour and marks below the backdrop and ink',()=>{
 const graphics=require('../src/graphics-pane.js'),stroke={colorHex:'#123456',width:3,points:[{x:.2,y:.3}]},backdrop='data:image/png;base64,aGVsbG8=';
 for(const [kind,mark]of [['dots','<circle'],['lines','height="1"'],['grid','height="1"'],['isometric','<circle'],['cornell','height="2"'],['blank',null]]){
  const paper={kind,spacing:'medium',colour:'cream'},sheet={name:'Brought in page',aspect:2,strokes:[stroke],backdrop,paper},snapshot=snapshotDrawing(sheet),svg=svgDrawing(snapshot);
  assert.match(svg,/viewBox="0 0 1000 500"/);assert.match(svg,/<rect x="0" y="0" width="1000" height="500" fill="#f7f0dc"\/>/);
  if(mark)assert.ok(svg.includes(mark),kind+' paper marks are visible in the preview');else assert.doesNotMatch(svg,/<circle/);
  assert.ok(svg.indexOf('<rect')<svg.indexOf('<image')&&svg.indexOf('<image')<svg.indexOf('<path'),'paper, image and ink keep their layer order');
  const restored=graphics.decode(graphics.encode(sheet));assert.deepEqual(restored.paper,paper);assert.equal(restored.backdrop,backdrop);assert.equal(svgDrawing(snapshotDrawing(restored)),svg,'editable storage and its visible preview retain the same page');
 }
});

test('cropped SVG keeps the original paper alignment and dark paper keeps its visible ink',()=>{
 const snapshot=snapshotDrawing({name:'Dark dots',aspect:2,strokes:[{colorHex:'#000000',width:3,points:[{x:.2,y:.3}]}],paper:{kind:'dots',spacing:'medium',colour:'dark'}},{x:.1,y:.2,width:.4,height:.5}),svg=svgDrawing(snapshot);
 assert.match(svg,/viewBox="100 100 400 250"/);assert.match(svg,/translate\(100 100\) scale\(1 1\)/);assert.match(svg,/width="400" height="250" fill="#1e2025"/);assert.match(svg,/<circle cx="17.5"/);assert.match(svg,/stroke="#F2F2F7"/);
 const transparent=svgDrawing(snapshot,false);assert.doesNotMatch(transparent,/<rect|<circle/);assert.match(transparent,/stroke="#000000"/,'the explicit paper-free export keeps its original ink');
});

test('a blank brought-in page still contains its paper while an empty ink-only export stays empty',()=>{
 const snapshot=snapshotDrawing({name:'Blank page',aspect:.75,strokes:[],paper:{kind:'lines',spacing:'large',colour:'cream'}}),svg=svgDrawing(snapshot);
 assert.match(svg,/fill="#f7f0dc"/);assert.match(svg,/height="1"/);assert.doesNotMatch(svg,/<path|<image/);assert.equal(svgDrawing(snapshot,false),null);
});

test('small vector previews use the live mean pressure and retain exact point coordinates',()=>{
 const strokes=[{colorHex:'#123456',width:3,points:[{x:.12345678901234567,y:.2},{x:.6,y:.7}],pressures:[.1,.9]},{colorHex:'#234567',width:3,points:[{x:.2,y:.3}],pressures:[0]}],svg=svgDrawing(snapshotDrawing({name:'Pressure',aspect:1,strokes,paper:{kind:'blank',spacing:'medium',colour:'white'}}));assert.equal((svg.match(/<path/g)||[]).length,2);assert.match(svg,/M123\.45678901234567 200 L600 700/);assert.equal((svg.match(/stroke-width="3"/g)||[]).length,2,'the segment uses mean pressure and the dot uses its unscaled pen width');assert.doesNotMatch(svg,/stroke-width="0\.6"|stroke-width="4\.92"/);
});

test('Writing omits paper from its image and keeps the active sheet paper in the editable payload',()=>{
 const source=require('node:fs').readFileSync('src/tablet-entry.tsx','utf8'),implementation=source.slice(source.indexOf(' const drawingSvg='),source.indexOf(' const selectionRaster=')),events=[];
 assert.ok(implementation.includes('const insert='),'the production insertion path is available');
 const stroke={colorHex:'#000000',width:2,points:[{x:.2,y:.3}]},first={aspect:2,strokes:[stroke],backdrop:'data:image/png;base64,aGVsbG8='},other={aspect:1,strokes:[stroke],backdrop:null};
 const context={surface:{current:null},page:{current:first},sheets:[{name:'Cream lines',page:first,paper:{kind:'lines',spacing:'large',colour:'cream'}},{name:'Dark dots',page:other,paper:{kind:'dots',spacing:'small',colour:'dark'}}],box:null,paper:()=>({kind:'blank',spacing:'medium',colour:'white'}),snapshotDrawing,writingRegion,svgDrawing,denseDrawing,pngDrawingSvg,canvasPng,graphics:require('../src/graphics-pane.js'),btoa:value=>Buffer.from(value,'binary').toString('base64'),window:{dispatchEvent:event=>events.push(event)},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail}}};
 context.active=0;context.liveSheets={current:context.sheets};context.flushInkMutations=()=>null;context.projectInkSnapshot=(_owner,strokes)=>strokes;context.setSaveError=message=>{throw Error(message)};
 vm.runInNewContext(implementation+';globalThis.insertDrawing=insert;globalThis.savedDrawing=drawingSvg;',context);context.insertDrawing();
 assert.equal(events.length,1);assert.equal(events[0].type,'tablet-insert');assert.equal(events[0].detail.inkOnly,true);
 const svg=Buffer.from(events[0].detail.data,'base64').toString();assert.match(svg,/stroke="#000000"/);assert.doesNotMatch(svg,/<rect|<image/);
 assert.deepEqual(JSON.parse(JSON.stringify(events[0].detail.sheet.paper)),context.sheets[0].paper);assert.equal(events[0].detail.sheet.backdrop,null);
 const firstSvg=Buffer.from(context.savedDrawing(true,first),'base64').toString();assert.match(firstSvg,/fill="#f7f0dc"/);assert.match(firstSvg,/height="1"/);assert.match(firstSvg,/<image/);
 const otherSvg=Buffer.from(context.savedDrawing(true,other),'base64').toString();assert.match(otherSvg,/fill="#1e2025"/);assert.match(otherSvg,/stroke="#F2F2F7"/,'saving another sheet uses that sheet’s own paper instead of the active paper');
});
