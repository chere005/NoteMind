const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {ArchiveCodec}=require('../src/archive-codec.cjs'),format=require('../src/notepad-format.cjs'),graphics=require('../src/graphics-pane.js');
const sheet={name:'Exact 日本語',aspect:1,strokes:[{colorHex:'#AbCdEf',width:2.25,points:[{x:-0,y:.2},{x:.7,y:.8}],pressures:[.12345678901234568,.9]}]};
function archive(sidecar){return format.encode({text:'![Drawing](assets/drawing.svg)',assets:{'assets/drawing.svg':Buffer.from('<svg/>').toString('base64'),'assets/drawing.svg.json':Buffer.from(sidecar).toString('base64')}},{kind:'drawing',extra:{'drawing.json':{sheet:'assets/drawing.svg.json',image:'assets/drawing.svg'}}});}
for(const binary of [false,true])test('drawing inspection transfers only exact '+(binary?'binary':'legacy UTF8')+' sidecar bytes without asset base64 allocations',async t=>{
 const codec=new ArchiveCodec();t.after(()=>codec.dispose());const sidecar=binary?graphics.encodeBytes(sheet):Buffer.from(graphics.encode(sheet)),original=archive(sidecar),input=Uint8Array.from(original),result=await codec.inspectDrawingOwned(input);
 assert.equal(input.byteLength,0);assert.deepEqual(Buffer.from(result.encodedSheet),Buffer.from(sidecar));assert.equal(result.encodedSheet.byteOffset,0);assert.equal(result.encodedSheet.byteLength,result.encodedSheet.buffer.byteLength);
 assert.equal(result.fileRevision.bytes,original.length);assert.equal(result.fileRevision.sha256,createHash('sha256').update(original).digest('hex'));assert.equal(result.assets,undefined);assert.equal(codec.assetStats().bytes,0);assert.equal(codec.assetStats().worker.bytes,0);
 assert.equal(graphics.decode(result.encodedSheet).strokes[0].points.length,2);
});
test('drawing inspection rejects missing editable sheets and corrupted archives',async t=>{
 const codec=new ArchiveCodec();t.after(()=>codec.dispose());await assert.rejects(codec.inspectDrawingOwned(Uint8Array.from(format.encode({text:'Ordinary note',assets:{}}))),/editable drawing/);
 const corrupt=Uint8Array.from(archive(graphics.encodeBytes(sheet)));corrupt[50]^=255;await assert.rejects(codec.inspectDrawingOwned(corrupt));
});
