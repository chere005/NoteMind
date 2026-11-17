const test=require('node:test'),assert=require('node:assert/strict'),{load}=require('./helpers/tablet-surface.cjs');
const view={size:{width:10,height:20},shown:{x:0,y:0,width:10,height:20},zoom:null},canvas=()=>({width:10,height:20});
const deferred=()=>{let resolve;const promise=new Promise(next=>resolve=next);return {promise,resolve}};
function moduleFor(bitmap){return load('src/tablet/renderer/cameraProcessing.ts',{Blob,Buffer,TextEncoder,TextDecoder,AbortController,structuredClone,Uint8Array,ArrayBuffer,DataView,setTimeout,clearTimeout,setImmediate,createImageBitmap:bitmap})}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(test){for(let i=0;i<50;i++){if(test())return;await tick()}throw Error('Capture stage did not start');}

test('camera worker receives independent binary ink and owns the transferred bitmap only once',async()=>{
 let closed=0,terminated=0,packet;const bitmap={close(){closed++}},blob=new Blob(['fixture'],{type:'image/png'}),{CameraProcessing}=moduleFor(async()=>bitmap);
 const worker={postMessage(value,transfer){packet=value;assert.equal(transfer[0],bitmap);assert.equal(transfer[1],value.bytes.buffer);bitmap.close();queueMicrotask(()=>worker.onmessage({data:{blob}}));},terminate(){terminated++}};
 const owner=new CameraProcessing(()=>worker),stroke={colorHex:'#123456',width:2,points:[{x:.1,y:.2}]},points=stroke.points,source=canvas();
 assert.equal(await owner.run(source,{strokes:[stroke],view}),blob);assert.equal(closed,1);assert.equal(terminated,1);assert.equal(stroke.points,points);assert.equal(stroke.width,2);assert.equal(source.width,10);assert.ok(packet.bytes.byteLength>24);
});
test('disposing while a bitmap opens closes its late result and prevents worker publication',async()=>{
 const opening=deferred();let started=false,closed=0,factories=0;const {CameraProcessing}=moduleFor(()=>{started=true;return opening.promise}),owner=new CameraProcessing(()=>{factories++;throw Error('A cancelled capture must not create a worker')});
 const pending=owner.run(canvas(),{view});await until(()=>started);owner.dispose();await assert.rejects(pending,{name:'AbortError'});opening.resolve({close(){closed++}});await tick();assert.equal(closed,1);assert.equal(factories,0);await assert.rejects(owner.run(canvas(),{view}),{name:'AbortError'});
});
test('capture failures release ownership and a later job can retry; overlapping jobs are rejected',async()=>{
 let attempts=0,closed=0,terminated=0;const {CameraProcessing}=moduleFor(async()=>({close(){closed++}})),gate=deferred();
 const owner=new CameraProcessing(()=>{if(!attempts++)throw Error('Worker creation failed');const worker={postMessage(packet){packet.bitmap.close();void gate.promise.then(()=>worker.onmessage({data:{blob:new Blob(['ok'],{type:'image/png'})}}))},terminate(){terminated++}};return worker});
 await assert.rejects(owner.run(canvas(),{view}),/Worker creation failed/);assert.equal(closed,1);
 const pending=owner.run(canvas(),{view});await until(()=>attempts===2);await assert.rejects(owner.run(canvas(),{view}),/already finishing/);gate.resolve();await pending;assert.equal(terminated,1);assert.equal(closed,2);
});

test('compact preparation captures its settings before yielding and preserves unowned caller buffers',async()=>{
 let packet;const {CameraProcessing}=moduleFor(()=>assert.fail('Compact capture must not open a UI bitmap')),
 worker={postMessage(value,transfers){packet=value;assert.equal(transfers.length,2);assert.equal(transfers[0],value.bytes.buffer);assert.equal(transfers[1],value.backdropBytes.buffer);queueMicrotask(()=>worker.onmessage({data:{blob:new Blob(['png'],{type:'image/png'}),thumbnail:new Blob(['thumb'],{type:'image/png'})}}));},terminate(){}},processor=new CameraProcessing(()=>worker),bytes=new Uint8Array(65537).fill(17),backdropBytes=new Uint8Array([1,2,3]),metadata={name:'Original',camera:{rotation:90,inkRotation:0,inkAspect:'free',aspect:'free'}};
 const pending=processor.runCompact({bytes,backdropBytes,metadata},{thumbnail:true});metadata.name='Later';metadata.camera.rotation=180;const result=await pending;
 assert.equal(packet.metadata.name,'Original');assert.equal(packet.metadata.camera.rotation,90);assert.notEqual(packet.bytes.buffer,bytes.buffer);assert.notEqual(packet.backdropBytes.buffer,backdropBytes.buffer);assert.equal(bytes[0],17);assert.deepEqual([...backdropBytes],[1,2,3]);assert.ok(result.thumbnail.size);
});

test('compact worker rejects corrupt saved camera settings before opening any image',async()=>{
 const {processCompactCameraPage}=load('src/camera-worker.ts',{TextDecoder,AbortController,setTimeout,clearTimeout,setImmediate}),bytes=new Uint8Array(24),backdropBytes=new Uint8Array([1]);
 await assert.rejects(processCompactCameraPage({bytes,backdropBytes,metadata:{name:'Corrupt',camera:{rotation:45,aspect:'NaN'}}}),/Invalid saved camera page settings/);
});
test('PNG encoding cancellation aborts its FileReader and never starts an already-cancelled read',async()=>{
 const readers=[],controller=new AbortController(),{pngBlobDataURL}=load('src/tablet/renderer/cameraProcessing.ts',{Blob,AbortController,FileReader:class{constructor(){readers.push(this)}readAsDataURL(){this.started=true}abort(){this.aborted=true;this.onabort()}}});
 const pending=pngBlobDataURL(new Blob(['png']),{signal:controller.signal});assert.equal(readers[0].started,true);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(readers[0].aborted,true);await assert.rejects(pngBlobDataURL(new Blob(['png']),{signal:controller.signal}),{name:'AbortError'});assert.equal(readers.length,1);
 const success=new AbortController(),encoded=pngBlobDataURL(new Blob(['png']),{signal:success.signal});readers[1].result='data:image/png;base64,eA==';readers[1].onload();assert.equal(await encoded,'data:image/png;base64,eA==');success.abort();assert.equal(readers[1].aborted,undefined);
});
