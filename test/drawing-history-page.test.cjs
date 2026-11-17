const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/tablet-surface.cjs');
const {TabletPage}=load('src/tablet/renderer/tabletPage.ts',{setImmediate,setTimeout,MessageChannel,performance});
const stroke=(value=0)=>({colorHex:'#112233',width:2,points:[{x:value,y:.3}],pressures:[.7]});

test('large model hydration, edits and Undo/Redo preserve one atomic operation each',async()=>{
 const page=new TabletPage(.75),original=Array.from({length:5000},(_,i)=>stroke(i*.0001)),ops=[];let changes=0;page.onOp(op=>ops.push(op));page.onChange(()=>changes++);
 assert.equal(await page.loadGeometryAsync(original),true);assert.equal(page.strokes,original);assert.equal(page.canUndo,false);assert.equal(changes,1);
 const next=original.map(s=>({...s,colorHex:'#abcdef'}));assert.equal(await page.replaceAsync(next),true);assert.equal(page.strokes,next);assert.equal(changes,3);assert.deepEqual(ops.map(op=>op.op),['replace']);
 assert.equal(await page.undoAsync(),true);assert.equal(page.strokes,original);assert.equal(await page.redoAsync(),true);assert.equal(page.strokes,next);page.dispose();
});
test('geometry leases prevent unload; async unload preserves identity, layout and listeners',async()=>{
 const page=new TabletPage(.75),original=Array.from({length:5000},()=>stroke()),extent=page.extent;await page.loadGeometryAsync(original);page.backdrop='data:image/png;base64,eA==';page.target='picture.png';let changes=0;page.onChange(()=>changes++);const release=page.retainGeometry();
 assert.equal(page.geometryRetained,true);assert.equal(page.unloadGeometry(),false);assert.equal(await page.unloadGeometryAsync(),false);assert.equal(page.strokes,original);assert.equal(changes,0);release();release();assert.equal(page.geometryRetained,false);
 assert.equal(await page.unloadGeometryAsync(),true);assert.equal(page.strokes.length,0);assert.equal(page.canUndo,false);assert.equal(page.backdrop,null);assert.equal(page.target,null);assert.equal(page.extent,extent);assert.equal(page.aspect,.75);assert.equal(changes,1);assert.equal(await page.loadGeometryAsync(original),true);assert.equal(changes,2);assert.equal(page.strokes,original);assert.ok(Object.keys(page).includes('strokes'));assert.ok(!Object.keys(page).includes('history'));page.dispose();
});
test('ink written during preparation invalidates replacement and remains on its original page',async()=>{
 const page=new TabletPage(),original=Array.from({length:5000},()=>stroke());await page.loadGeometryAsync(original);const next=original.map(s=>({...s,colorHex:'#abcdef'})),ink=stroke(.8);let injected=false;
 assert.equal(await page.replaceAsync(next,{yieldControl:async()=>{if(!injected){injected=true;page.add(ink);}await new Promise(resolve=>setImmediate(resolve));}}),false);assert.equal(page.strokes.length,5001);assert.equal(page.strokes.at(-1),ink);assert.equal(page.strokes[0],original[0]);assert.equal(await page.undoAsync(),true);assert.equal(page.strokes,original);page.dispose();
});
test('failed preparation releases its leases and permits subsequent edits',async()=>{
 const page=new TabletPage(),original=Array.from({length:5000},()=>stroke());await page.loadGeometryAsync(original);const next=original.map(s=>({...s,colorHex:'#abcdef'}));await assert.rejects(page.replaceAsync(next,{yieldControl:async()=>{throw Error('pause failed');}}),/pause failed/);assert.equal(page.strokes,original);assert.equal(await page.replaceAsync(next),true);assert.equal(await page.undoAsync(),true);assert.equal(page.strokes,original);page.dispose();
});
