const {test}=require('node:test'),assert=require('node:assert/strict');
test('camera selection can move and resize without leaving the image',async()=>{
 const {selectionHit,selectionStep}=await import('../src/tablet/renderer/selectionGesture.js');
 const box={x:.2,y:.2,width:.4,height:.4};
 assert.equal(selectionHit(box,{x:.2,y:.2},{x:.02,y:.02}),'nw');
 assert.equal(selectionHit(box,{x:.4,y:.4},{x:.02,y:.02}),'move');
 assert.deepEqual(selectionStep({mode:'move',start:{x:.4,y:.4},box},{x:1,y:1}),{x:.6,y:.6,width:.4,height:.4});
 const resized=selectionStep({mode:'se',start:{x:.6,y:.6},box},{x:.8,y:.9});
 assert.ok(Math.abs(resized.width-.6)<1e-10 && Math.abs(resized.height-.7)<1e-10);
});
