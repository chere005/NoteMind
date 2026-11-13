const {test}=require('node:test'),assert=require('node:assert/strict'),{findPenDisplay,moveOffDisplay}=require('../src/pad-display.cjs');
test('finds only an extended Wacom display, deterministically',()=>{
 const primary={id:1,label:'Built-in',internal:true},pad={id:2,label:'Wacom One 12',internal:false},other={id:3,label:'External',internal:false};
 assert.equal(findPenDisplay([primary],1),null);assert.equal(findPenDisplay([primary,other],1),null);assert.equal(findPenDisplay([primary,pad,other],1),pad);assert.equal(findPenDisplay([primary,{...pad,internal:true}],1),null);assert.equal(findPenDisplay([primary,pad,{...pad,id:4}],1),pad);
});
test('moves an obscured window back to the primary work area',()=>{
 const primary={x:0,y:0,width:1440,height:900},pad={x:1440,y:0,width:1920,height:1080};
 assert.equal(moveOffDisplay({x:0,y:0,width:800,height:600},pad,primary),null);
 assert.deepEqual(moveOffDisplay({x:1500,y:100,width:1000,height:700},pad,primary),{x:220,y:100,width:1000,height:700});
 assert.deepEqual(moveOffDisplay({x:1500,y:100,width:3000,height:2000},pad,primary),null);
});

test('mirrored Wacom screens draw in the application window',()=>{const bounds={x:0,y:0,width:1440,height:900};const primary={id:1,internal:true,bounds};const pad={id:2,label:'Wacom',internal:false,bounds:{...bounds,width:1920,height:1080}};assert.equal(findPenDisplay([primary,pad],1),null);assert.equal(findPenDisplay([primary,{...pad,bounds:{...pad.bounds,x:1440}}],1).id,2);});
