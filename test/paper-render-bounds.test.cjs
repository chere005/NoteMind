const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('./helpers/tablet-surface.cjs');
const {paperMarks,paintPaper,PAPER_MARK_BUDGET}=load('src/tablet/renderer/tabletPaper.ts'),{snapshotDrawing,rasterDrawing}=load('src/tablet/renderer/drawingSnapshot.ts');
const paper={kind:'dots',spacing:'medium',colour:'white'};
test('expanded paper rendering has a fixed mark budget without changing the lattice phase',()=>{
 for(const kind of ['dots','isometric','lines','grid','cornell'])for(const size of [1e8,1e300]){
  const marks=paperMarks({...paper,kind},{width:1000,height:1500},{x:-size,y:-size,width:size*2,height:size*2});assert.ok(marks.dots.length+marks.lines.length<=PAPER_MARK_BUDGET+3);assert.ok(marks.dots.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 }
 const ordinary=paperMarks(paper,{width:1000,height:1500});assert.equal(ordinary.dots[0].x,13);assert.equal(ordinary.dots[0].y,13);
 const crop=paperMarks(paper,{width:1000,height:1500},{x:100,y:100,width:400,height:500});for(const p of crop.dots){assert.ok(Math.abs((p.x-13)/26-Math.round((p.x-13)/26))<1e-8);assert.ok(Math.abs((p.y-13)/26-Math.round((p.y-13)/26))<1e-8);}
});
test('subpixel paper patterns use level of detail and reject numeric overflow',()=>{
 let arcs=0;const ctx={setTransform(){},fillRect(){},beginPath(){},moveTo(){},arc(){arcs++},fill(){}};
 paintPaper(ctx,paper,{width:1000,height:1500},{x:-1e9,y:-1e9,width:2e9,height:2e9},{width:1000,height:1500});assert.ok(arcs<100000);assert.ok(arcs>0);
 assert.throws(()=>paperMarks(paper,{width:1000,height:1500},{x:-Number.MAX_VALUE,y:0,width:Number.MAX_VALUE*2,height:1}),/numeric range/);
});
test('expanded drawing raster allocation is uniformly bounded while retaining every source point',async()=>{
 const points=[{x:-1000,y:-1000},{x:1000,y:1000}],snapshot=snapshotDrawing({name:'Expanded',aspect:1,strokes:[{colorHex:'#123456',width:2,points}],paper,viewport:{x:-1000,y:-1000,width:2000,height:2000}}),canvas={getContext:()=>({save(){},scale(){},translate(){},restore(){}})};let painted;
 await rasterDrawing(snapshot,true,{canvas:()=>canvas,paintPaper(){},paintStrokes(_ctx,strokes,toPixel){painted=strokes[0].points.map(toPixel)},inkOn:(_p,c)=>c});
 assert.ok(canvas.width<=8192&&canvas.height<=8192&&canvas.width*canvas.height<=16*1024*1024);assert.equal(canvas.width,canvas.height);assert.deepEqual(JSON.parse(JSON.stringify(painted)),points.map(p=>({x:p.x*1000,y:p.y*1000})));
});
test('drawing storage rejects reference-coordinate overflow while preserving ordinary extended margins',()=>{
 const {validSheets}=load('src/tablet/renderer/validateStorage.js'),graphics=require('../src/graphics-pane.js'),base={name:'Safe',aspect:1,strokes:[{colorHex:'#123456',width:2,points:[{x:-1000,y:1000}]}],extent:{x:-1000,y:-1000,width:2001,height:2001}};
 assert.equal(validSheets([base]),true);assert.doesNotThrow(()=>graphics.validate(base));
 for(const unsafe of [{...base,strokes:[{...base.strokes[0],points:[{x:1e308,y:0}]}]},{...base,extent:{x:-1e308,y:0,width:1e308,height:1}}]){assert.equal(validSheets([unsafe]),false);assert.throws(()=>graphics.validate(unsafe),/Invalid/);}
});
