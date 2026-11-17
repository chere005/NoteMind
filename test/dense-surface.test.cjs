const {test}=require('node:test'),assert=require('node:assert/strict'),{surfaceHarness,pageModule,load}=require('./helpers/tablet-surface.cjs'),{snapshotDrawing}=load('src/tablet/renderer/drawingSnapshot.ts');
const stroke=x=>({colorHex:'#123456',width:2,points:[{x,y:.2},{x:x+.001,y:.3}],pressures:[.2,.8]}),png='data:image/png;base64,aGVsbG8=';
function flush(h){for(const [id,fn]of [...h.frames]){h.frames.delete(id);fn();}h.render();}
function dense(){const page=new pageModule.TabletPage(1);page.strokes=Array.from({length:2500},(_,i)=>stroke(i/3000));page.restoreExtent();return page;}
const image=()=>({close(){}});
test('dense initial painting stays off the input thread and rejects a stale source before accepting current tiles',()=>{
 const page=dense(),h=surfaceHarness({page,encodePreview:async()=>png}),ctx=h.find('ink').props.ref.current.getContext('2d');let painted=0;ctx.stroke=()=>painted++;flush(h);assert.equal(painted,0);assert.equal(h.inkRequests.length,1);const old=h.inkRequests[0];page.add(stroke(.9));assert.equal(old.onFrame({tiles:[{x:0,y:0,width:10,height:10,bitmap:image()}]},old.scene),false);flush(h);const current=h.inkRequests.at(-1);assert.equal(current.scene.strokes,page.strokes);assert.equal(current.onFrame({tiles:[{x:0,y:0,width:10,height:10,bitmap:image()}]},current.scene),true);const snapshot=snapshotDrawing({name:'Dense',aspect:page.aspect,strokes:page.strokes,paper:current.scene.config.paper,backdrop:null,viewport:page.viewport});assert.ok(h.handle.current.preview(snapshot));h.unmount();
});
test('a bitmap cannot overwrite a new in-contact stroke and a later lift remains editable',()=>{
 const page=dense(),h=surfaceHarness({page});flush(h);const old=h.inkRequests[0],before=page.strokes.length;h.pointer('pointerdown',300,400);h.pointer('pointermove',350,450);assert.equal(old.onFrame({tiles:[]},old.scene),false);h.pointer('pointerup',400,500);assert.equal(page.strokes.length,before+1);flush(h);const latest=h.inkRequests.at(-1);assert.equal(latest.scene.strokes,page.strokes);assert.equal(latest.onFrame({tiles:[]},latest.scene),true);h.unmount();assert.equal(latest.onFrame({tiles:[]},latest.scene),false,'late pixels from a closed surface are ignored');
});
test('dense worker failure yields its fallback and cannot advertise incomplete pixels as a valid preview',async()=>{
 const page=dense(),h=surfaceHarness({page,encodePreview:async()=>png});flush(h);const job=h.inkRequests[0];let current=true;const pending=job.onError(Error('worker stopped'),job.scene,()=>current);current=false;await pending;const snapshot=snapshotDrawing({name:'Incomplete',aspect:page.aspect,strokes:page.strokes,paper:job.scene.config.paper,backdrop:null,viewport:page.viewport});assert.equal(h.handle.current.preview(snapshot),null);h.unmount();
});
test('reference paper overrides drawing preferences without changing source ink',()=>{
 const h=surfaceHarness();h.props.paperOverride={kind:'blank',spacing:'medium',colour:'cream'};h.render();flush(h);assert.equal(h.find('tablet').props['data-paper'],'blank');assert.equal(h.find('tablet').props['data-paper-colour'],'cream');h.pointer('pointerdown',100,100);h.pointer('pointerup',200,200);assert.equal(h.page.strokes[0].colorHex,'#123456');h.unmount();
});
test('Undo during a selection gesture cannot restore the removed source ink on lift',()=>{
 const page=new pageModule.TabletPage(1);page.add(stroke(.3));const h=surfaceHarness({page});h.props.box={x:.2,y:.1,width:.4,height:.5};h.tools.select=true;h.render();h.pointer('pointerdown',350,500,1,'mouse');h.pointer('pointermove',400,550,1,'mouse');assert.equal(page.undo(),true);assert.equal(page.strokes.length,0);h.pointer('pointerup',450,600,0,'mouse');assert.equal(page.strokes.length,0);h.unmount();
});

test('flushing a moving selection commits its visible placement once before the later lift',()=>{
 const page=new pageModule.TabletPage(1);page.add(stroke(.3));const h=surfaceHarness({page});h.props.box={x:.2,y:.1,width:.4,height:.5};h.tools.select=true;h.render();h.pointer('pointerdown',350,500,1,'mouse');h.pointer('pointermove',400,550,1,'mouse');h.handle.current.flush();const changed=page.strokes;assert.notEqual(changed[0].points[0].x,.3);h.pointer('pointerup',450,600,0,'mouse');assert.equal(page.strokes,changed);assert.equal(page.undo(),true);assert.equal(page.strokes[0].points[0].x,.3);h.unmount();
});
