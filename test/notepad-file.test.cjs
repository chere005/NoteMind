const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {writeNotepadFile}=require('../src/notepad-file.cjs'),format=require('../src/notepad-format.cjs'),{inspectArchiveFile}=require('../src/archive-file-inspection.cjs'),graphics=require('../src/graphics-pane.js');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function folder(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-stream-archive-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
test('streamed public archives preserve exact document, assets and recovery metadata through both readers',async t=>{
 const directory=await folder(t),geometry=graphics.encodeBytes({name:'Pressure',aspect:1.5,strokes:[{colorHex:'#123456',width:2.5,points:[{x:.25,y:.75},{x:.4,y:1.2}],pressures:[.01,.99]}]}),doc={id:'exact-stream',text:'# Exact 😀\n![Image](assets/image.jpg)',title:'Exact',created:'2026-01-01',meta:{tags:['full'],nested:{preserved:true}},assets:{'assets/image.jpg':Buffer.from([255,216,255,...Array.from({length:10000},(_,i)=>i%256)]).toString('base64'),'assets/drawing.svg.json':Buffer.from(geometry).toString('base64')}};
 for(const kind of ['notepad','drawing','workspace']){
  const extra={'recovery.json':{recoveryId:'generation',dirty:true,revision:'f'.repeat(64)},...(kind==='drawing'?{'drawing.json':{sheet:'assets/drawing.svg.json'}}:kind==='workspace'?{'workspace.json':{folders:['/exact']}}:{})},file=path.join(directory,kind+'.nm'),receipt=await writeNotepadFile(doc,{kind,extra},{file,expected:null});assert.equal(receipt.committed,true);const bytes=await fs.readFile(file);assert.equal(receipt.revision.sha256,sha(bytes));assert.equal(receipt.revision.bytes,bytes.length);
  const old=format.decode(bytes),bounded=(await inspectArchiveFile(file)).doc;for(const value of [old,bounded]){for(const key of ['id','text','title','created','meta'])assert.deepEqual(value[key],doc[key]);assert.deepEqual({...value.assets},doc.assets);assert.equal(value.kind,kind);assert.deepEqual(JSON.parse(value.files['recovery.json']),extra['recovery.json']);assert.deepEqual(graphics.decode(Buffer.from(value.assets['assets/drawing.svg.json'],'base64')),graphics.decode(geometry));}
 }
});
test('raw assets stay borrowed and resolve only when their bounded source is consumed',async()=>{
 const data=Buffer.allocUnsafeSlow(600003);data.fill(23);const descriptor={raw:true},doc={text:'Raw'.repeat(10000),assets:{'assets/raw.jpg':descriptor}},events=[];let metadata;
 const result=await writeNotepadFile(doc,{}, {file:'/unused/exact.nm',expected:null},{hooks:{assetInfo:()=>({bytes:data.length,sha256:sha(data)}),validateAsset:()=>true,assetBytes:()=>{events.push('resolve');return data;}},writer:async entries=>{assert.deepEqual(events,[]);metadata=entries.filter(entry=>entry.data).map(entry=>entry.data);const asset=entries.find(entry=>entry.name==='assets/raw.jpg'),chunks=[];for await(const chunk of asset.source()){assert.ok(chunk.length<=512*1024);chunks.push(Buffer.from(chunk));}assert.deepEqual(Buffer.concat(chunks),data);assert.deepEqual(events,['resolve']);return{committed:true};}});
 assert.equal(result.committed,true);assert.equal(data.length,600003);assert.equal(data[0],23);assert.ok(metadata.some(bytes=>bytes.byteLength===0),'the large owned text backing retires');
});
test('file-backed asset sources stream exact original bytes without whole-asset resolution',async t=>{
 const directory=await folder(t),file=path.join(directory,'Stream.nm'),original=Buffer.allocUnsafeSlow(1200003);original.fill(129);let calls=0,closed=false;const descriptor={private:true};
 const result=await writeNotepadFile({text:'File source',assets:{'assets/a.jpg':descriptor}},{},{file,expected:null},{hooks:{assetInfo:()=>({bytes:original.length,sha256:sha(original)}),validateAsset:()=>true,assetBytes:()=>{throw Error('whole asset resolution forbidden');},assetSource:async function*(){calls++;try{const scratch=Buffer.allocUnsafeSlow(32768);for(let at=0;at<original.length;at+=scratch.length){const count=Math.min(scratch.length,original.length-at);original.copy(scratch,0,at,at+count);yield scratch.subarray(0,count);}}finally{closed=true;}}}});
 assert.equal(result.committed,true);assert.equal(calls,1);assert.equal(closed,true);assert.deepEqual(Buffer.from(format.decode(await fs.readFile(file)).assets['assets/a.jpg'],'base64'),original);
});
test('invalid names, false digests and oversized raw claims cannot reach publication',async()=>{
 let writes=0;const writer=async()=>{writes++;};
 await assert.rejects(writeNotepadFile({text:'',assets:{'assets/../escape':'AA=='}},{},{file:'/unused/out',expected:null},{writer}),/Invalid image path/);
 await assert.rejects(writeNotepadFile({text:'',assets:{'assets/a.jpg':'AA=='}},{},{file:'/unused/out',expected:null},{hooks:{assetInfo:()=>({bytes:1,sha256:'0'.repeat(64)})},writer}),/digest/);
 await assert.rejects(writeNotepadFile({text:'',assets:{'assets/a.jpg':{}}},{},{file:'/unused/out',expected:null},{hooks:{assetInfo:()=>({bytes:51*1024*1024,sha256:'0'.repeat(64)}),validateAsset:()=>true},writer}),/digest/);assert.equal(writes,0);
});
test('mid-source cancellation and source digest changes leave the existing target intact',async t=>{
 const directory=await folder(t),file=path.join(directory,'Existing.nm'),old=Buffer.from('previous file');await fs.writeFile(file,old);const data=Buffer.allocUnsafeSlow(2*1024*1024);data.fill(71);let abort=false;
 for(const mode of ['cancel','changed']){
  const original=sha(data),expected={bytes:old.length,sha256:sha(old)};abort=false;
  await assert.rejects(writeNotepadFile({text:'New',assets:{'assets/raw.jpg':{}}},{},{file,expected},{check:()=>{if(abort)throw Error('cancelled');},hooks:{assetInfo:()=>({bytes:data.length,sha256:original}),validateAsset:()=>true,assetBytes:()=>{if(mode==='cancel')abort=true;else data[0]^=1;return data;}}}),mode==='cancel'?/cancelled/:/digest changed/);
  assert.deepEqual(await fs.readFile(file),old);assert.deepEqual(await fs.readdir(directory),['Existing.nm']);
 }
});
test('Notepad aggregate entry names retain the old reader-compatible range while the default Word ZIP budget stays unchanged',async t=>{
 const directory=await folder(t),file=path.join(directory,'Long names.nm'),assets=Object.fromEntries(Array.from({length:1100},(_,i)=>['assets/'+String(i).padStart(4,'0')+'-'+ 'a'.repeat(7890)+'.bin',''])),doc={text:'Names beyond the Word-specific budget',assets},legacy=format.encode(doc);assert.ok(Object.keys(assets).reduce((sum,name)=>sum+Buffer.byteLength(name),0)>8*1024*1024);assert.equal(Object.keys(format.decode(legacy).assets).length,1100);const entries=Object.keys(assets).map(name=>({name,data:new Uint8Array(0)}));await assert.rejects(require('../src/zip-stream.cjs').writeZipFile(entries,{file,expected:null}),/names.*large/);const receipt=await writeNotepadFile(doc,{},{file,expected:null});assert.equal(receipt.committed,true);const restored=format.decode(await fs.readFile(file));assert.deepEqual(Object.keys(restored.assets),Object.keys(assets));assert.equal(restored.text,doc.text);
});
