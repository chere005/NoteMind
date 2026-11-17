const {test}=require('node:test'),assert=require('node:assert/strict'),{selectionMode,appendLasso}=require('../src/ink-selection-input.cjs')
test('selection modifiers preserve additive pen maps and explicit remove/toggle choices',()=>{
 assert.equal(selectionMode({},{}),'replace');assert.equal(selectionMode({shiftKey:true},{}),'add');assert.equal(selectionMode({},{additive:true}),'add');assert.equal(selectionMode({ctrlKey:true},{}),'toggle');assert.equal(selectionMode({metaKey:true},{}),'toggle');assert.equal(selectionMode({altKey:true,shiftKey:true},{}),'remove')
})
test('long lasso paths retain endpoints while bounding samples',()=>{
 const points=[];for(let i=0;i<100000;i++)appendLasso(points,{x:i,y:i%7});assert.equal(points[0].x,0);assert.equal(points.at(-1).x,99999);assert.ok(points.length<=2048);const length=points.length;appendLasso(points,{...points.at(-1)});assert.equal(points.length,length)
})
