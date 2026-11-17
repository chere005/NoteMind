const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){const caches=[];class ObservedWeakMap extends WeakMap{constructor(){super();this.sets=0;caches.push(this)}set(...args){this.sets++;return super.set(...args)}}const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../src/stroke-bounds.js'),'utf8'),{module,WeakMap:ObservedWeakMap,setTimeout});return{bounds:module.exports,caches};}
const plain=value=>JSON.parse(JSON.stringify(value));
test('dot and empty bounds preserve numeric and signed-zero values without retained per-stroke cache entries',async()=>{
 const {bounds,caches}=fixture();
 for(const [x,y]of [[-0,+0],[+0,-0],[-1.25,3.5],[1e290,-1e290]]){
  const stroke={points:[{x,y}]};bounds.primeStrokeBox(stroke,{x,y,right:x,bottom:y});
  for(const box of [bounds.knownStrokeBox(stroke),bounds.strokeBox(stroke),await bounds.strokeBoxAsync(stroke)]){
   assert.equal(box.count,1);assert.ok(Object.is(box.x,x));assert.ok(Object.is(box.right,x));assert.ok(Object.is(box.y,y));assert.ok(Object.is(box.bottom,y));
  }
 }
 const empty={points:[]},box=bounds.knownStrokeBox(empty);assert.equal(box.count,0);assert.equal(box.x,Infinity);assert.equal(box.y,Infinity);assert.equal(box.right,-Infinity);assert.equal(box.bottom,-Infinity);
 assert.equal(caches[0].sets,0);
});
test('many retained dots keep only the aggregate ink cache and appended bounds remain exact',()=>{
 const {bounds,caches}=fixture(),strokes=Array.from({length:50000},(_,index)=>({points:[{x:index/1000,y:-index/1000}]}));
 for(const stroke of strokes)bounds.primeStrokeBox(stroke,{x:stroke.points[0].x,y:stroke.points[0].y,right:stroke.points[0].x,bottom:stroke.points[0].y});
 const box=bounds.inkBox(strokes);assert.equal(box.count,50000);assert.equal(box.x,0);assert.equal(box.right,49.999);assert.equal(box.y,-49.999);assert.equal(box.bottom,-0);assert.equal(caches[0].sets,0);assert.equal(caches[1].sets,1);
 const added={points:[{x:70,y:-80}]},next=[...strokes,added];bounds.appendInkBox(strokes,next,added);assert.deepEqual(plain(bounds.inkBox(next)),{count:50001,x:0,y:-80,right:70,bottom:0});assert.equal(caches[0].sets,0);
});
test('multi-point caching, legacy count invalidation and asynchronous cancellation remain intact',async()=>{
 const {bounds,caches}=fixture(),stroke={points:[{x:-1,y:4},{x:2,y:3}]},box=bounds.strokeBox(stroke);assert.equal(bounds.knownStrokeBox(stroke),box);assert.equal(bounds.strokeBox(stroke),box);assert.equal(caches[0].sets,1);
 stroke.points.pop();assert.deepEqual(plain(bounds.knownStrokeBox(stroke)),{count:1,x:-1,y:4,right:-1,bottom:4});assert.equal(caches[0].has(stroke),false);
 const signal=new AbortController();signal.abort();await assert.rejects(bounds.strokeBoxAsync({points:[{x:1,y:2}]},{signal:signal.signal}),/cancelled/);
 const dense={points:Array.from({length:8193},(_,i)=>({x:i,y:-i}))};await assert.rejects(bounds.strokeBoxAsync(dense,{signal:signal.signal}),/cancelled/);assert.equal(bounds.knownStrokeBox(dense),null);
});
