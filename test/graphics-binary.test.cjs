const {test}=require('node:test'),assert=require('node:assert/strict'),graphics=require('../src/graphics-pane.js');
const paper={kind:'dots',spacing:'medium',colour:'cream'},base={name:'Exact 日本語',aspect:.6494444444444445,paper,backdrop:null,extent:{x:-1,y:-1,width:3,height:3},strokes:[{colorHex:'#AbCdEf',width:2.125,points:[{x:-0,y:-.12345678901234568},{x:.9876543210987654,y:1.2345678901234567}],pressures:[.12345678901234567,.9999999999999999]},{colorHex:'#1122AA',width:1,points:[],pressures:[]},{colorHex:'#445566',width:3,points:[{x:.1,y:.2}]}]};
test('binary graphics retains exact doubles, colour spelling, metadata and mixed pressure strokes',()=>{
 const bytes=graphics.encodeBytes(base);assert.equal(graphics.isBinary(bytes),true);assert.equal(graphics.validateBinary(bytes),true);assert.deepEqual(graphics.decode(bytes),base);assert.equal(Object.is(graphics.decode(bytes).strokes[0].points[0].x,-0),true);
 assert.deepEqual(graphics.decodeBase64(Buffer.from(bytes).toString('base64')),base);
 const large={...base,strokes:[{colorHex:'#AbCdEf',width:2,points:Array.from({length:10000},(_,i)=>({x:i/10000,y:.5})),pressures:Array(10000).fill(.12345678901234567)}]};assert.equal(graphics.isBinary(Buffer.from(graphics.encodeBase64(large),'base64')),true);assert.deepEqual(graphics.decodeBase64(graphics.encodeBase64(large)),large);
});
test('new readers retain legacy UTF8 JSON sidecars and small writers keep their readable format',()=>{
 const legacy={name:'Legacy 日本語',aspect:1,strokes:[{colorHex:'#123456',width:2,points:[{x:.1,y:.2}]}]},text=graphics.encode(legacy);
 assert.equal(graphics.isBinary(Buffer.from(graphics.encodeBase64(legacy),'base64')),false);assert.deepEqual(graphics.decodeBase64(Buffer.from(text).toString('base64')),graphics.decode(text));assert.deepEqual(graphics.decode(Buffer.from(text)),graphics.decode(text));
});
test('binary graphics rejects corrupt headers, counts, flags, points, pressure and trailing bytes',()=>{
 const source=graphics.encodeBytes(base),offset=24+new DataView(source.buffer).getUint32(8,true),corrupt=fn=>{const bytes=source.slice(),v=new DataView(bytes.buffer);fn(bytes,v);assert.throws(()=>graphics.validateBinary(bytes));assert.throws(()=>graphics.decode(bytes));};
 corrupt(bytes=>bytes[0]=0);corrupt((_b,v)=>v.setUint32(20,1,true));corrupt((_b,v)=>v.setUint32(16,2000001,true));corrupt((_b,v)=>v.setUint32(8,source.length,true));corrupt(bytes=>bytes[offset+3]=128);corrupt((_b,v)=>v.setFloat64(offset+4,0,true));corrupt((_b,v)=>v.setFloat64(offset+16,NaN,true));corrupt((_b,v)=>v.setFloat64(offset+32,Infinity,true));
 assert.throws(()=>graphics.validateBinary(source.subarray(0,source.length-1)));assert.throws(()=>graphics.validateBinary(new Uint8Array([...source,0])));
});
test('archives validate binary drawing sidecars even below the ordinary entry limit',()=>{
 const format=require('../src/notepad-format.cjs'),valid=graphics.encodeBytes(base),bad=valid.slice();new DataView(bad.buffer).setUint32(20,1,true);
 assert.throws(()=>format.encode({text:'Drawing',assets:{'assets/drawing.json':Buffer.from(bad).toString('base64')}}),/too large/);
 assert.deepEqual(format.decode(format.encode({text:'Drawing',assets:{'assets/drawing.json':Buffer.from(valid).toString('base64')}})).assets,{'assets/drawing.json':Buffer.from(valid).toString('base64')});
});
