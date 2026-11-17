const test=require('node:test'),assert=require('node:assert/strict');
const {afterCameraCapture,outsideCameraSelection}=require('../src/camera-editing.js');
const {createInkActionController,projectInkSnapshot,appendInkStroke}=require('../src/ink-mutations.js');
const stroke=(x=.5)=>({colorHex:'#123456',width:2,points:[{x,y:.5}]});
const owner=strokes=>({strokes,leases:0,retainGeometry(){this.leases++;return()=>this.leases--},async replaceAsync(next,options){if(!options.valid())return false;this.before=this.strokes;this.strokes=next;return true},add(value){this.strokes=[...this.strokes,value]}});

test('camera consumption preserves later repeated identities and intervening edits',async()=>{
 const a=stroke(),b=stroke(.7);assert.deepEqual(await afterCameraCapture([a,a],[a,a,a,b]),[a,b]);assert.equal(await afterCameraCapture([a],[b,a]),null);assert.deepEqual(await afterCameraCapture([a],[a]),[]);
});
test('queued camera consumption and Save retain writing accepted afterward',async()=>{
 const a=stroke(),later=stroke(.8),p=owner([a]),controller=createInkActionController(p);let release;const ready=new Promise(resolve=>release=resolve);
 const pending=controller.enqueue(async(_captured,current)=>{await ready;const next=await afterCameraCapture([a],current);return {target:next,commit:options=>p.replaceAsync(next,options)}},{capture:false});
 const append=appendInkStroke(p,later);const saved=projectInkSnapshot(p,p.strokes);release();await pending;await append;
 assert.deepEqual(p.strokes,[later]);assert.deepEqual(await saved,[later]);assert.deepEqual(p.before,[a]);assert.equal(p.leases,0);
});
test('camera selection clear yields inside a single dense stroke without changing input',async()=>{
 const dense={...stroke(),points:Array.from({length:20000},()=>({x:.5,y:.5}))},outside=stroke(.9),empty={...stroke(),points:[]};let yields=0;
 const next=await outsideCameraSelection([dense,outside,empty],{x:.1,y:.1,width:.5,height:.5},{yieldControl:async()=>{yields++}});
 assert.deepEqual(next,[outside,empty]);assert.equal(dense.points.length,20000);assert.ok(yields>=2);
 const controller=new AbortController();await assert.rejects(outsideCameraSelection([dense],{x:0,y:0,width:1,height:1},{signal:controller.signal,yieldControl:async()=>controller.abort()}),{name:'AbortError'});
});
