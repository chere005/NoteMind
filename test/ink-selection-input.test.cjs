const {test}=require('node:test'),assert=require('node:assert/strict'),{selectionMode,selectionRectangle}=require('../src/ink-selection-input.cjs')
test('selection modifiers preserve additive pen maps and explicit remove/toggle choices',()=>{
 assert.equal(selectionMode({},{}),'replace');assert.equal(selectionMode({shiftKey:true},{}),'add');assert.equal(selectionMode({},{additive:true}),'add');assert.equal(selectionMode({ctrlKey:true},{}),'toggle');assert.equal(selectionMode({metaKey:true},{}),'toggle');assert.equal(selectionMode({altKey:true,shiftKey:true},{}),'remove')
})
test('the marquee is a canonical rectangle in either direction and ignores thin accidental drags',()=>{
 const point=(x,y)=>({point:{x,y},px:{x:x*100,y:y*200}});
 assert.deepEqual(selectionRectangle(point(.75,.75),point(.25,.5)),{x:.25,y:.5,width:.5,height:.25});
 assert.deepEqual(selectionRectangle(point(.25,.5),point(.75,.75)),{x:.25,y:.5,width:.5,height:.25});
 assert.equal(selectionRectangle(point(0,0),point(.03,.5)),null);
 assert.equal(selectionRectangle(point(0,0),point(.5,0)),null);
})
