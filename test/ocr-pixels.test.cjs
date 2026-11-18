const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {TextReader}=require('../src/ocr.cjs'),{validatePixels,pixelKey}=require('../src/ocr-pixels.cjs');
const png=Buffer.from([137,80,78,71,13,10,26,10]),tick=()=>new Promise(setImmediate);
const image=()=>({width:3,height:2,data:new Uint8Array(24).fill(31)});
function fixture(options={}){const workers=[];class FakeWorker extends EventEmitter{
 constructor(){super();this.threadId=workers.length+1;workers.push(this)}
 postMessage(job,transfer){this.received=job;if(options.postFailure)throw Error('post failed');this.job=structuredClone(job,transfer?{transfer}:undefined)}
 terminate(){this.stopped=true;queueMicrotask(()=>{this.threadId=-1;if(this.job?.pixels?.data?.byteLength)this.job.pixels.data.buffer.transfer(0);this.emit('exit',0)});return Promise.resolve(0)}
 }return{workers,reader:new TextReader({idleMs:0,workerFactory:()=>new FakeWorker(),...options})};}
function answer(worker,{pixelsReleased=true}={}){if(worker.job.pixels)worker.job.pixels.data.buffer.transfer(0);worker.emit('message',{id:worker.job.id,pixelsReleased,lines:[{text:'exact',x:1,y:2,width:3,height:4}]});}
test('private RGBA uses one transferred owned backing and restores scalar queue accounting after ACK',async()=>{
 const {reader,workers}=fixture(),pixels=image(),source=pixels.data.buffer,run=reader.readPixels(pixels,{takeOwnership:true,id:'pixels'});
 assert.equal(source.byteLength,0);assert.equal(workers[0].received.pixels.data.byteLength,0);assert.deepEqual([...workers[0].job.pixels.data],Array(24).fill(31));assert.equal(reader.bytes,24);
 answer(workers[0]);assert.equal((await run).text,'exact');assert.equal(reader.bytes,0);assert.equal(reader.jobs.size,0);await reader.dispose();
});
test('private cache consumes the new owned input without starting a second model worker',async()=>{
 const {reader,workers}=fixture({idleMs:10000}),first=reader.readPixels(image(),{takeOwnership:true});answer(workers[0]);await first;const pixels=image(),backing=pixels.data.buffer,actual=await reader.readPixels(pixels,{takeOwnership:true});assert.equal(actual.text,'exact');assert.equal(backing.byteLength,0);assert.equal(workers.length,1);assert.equal(reader.bytes,0);await reader.dispose();
});
test('rejected ownership, malformed dimensions, shared or borrowed backing never consume caller pixels',async()=>{
 const {reader}=fixture(),unapproved=image();await assert.rejects(reader.readPixels(unapproved),/explicit ownership/);assert.equal(unapproved.data.byteLength,24);for(const pixels of [{...image(),width:4},{width:3,height:2,data:new Uint8Array(new ArrayBuffer(25),1,24)},{width:3,height:2,data:new Uint8Array(new SharedArrayBuffer(24))}]){const backing=pixels.data.buffer;await assert.rejects(reader.readPixels(pixels,{takeOwnership:true}));assert.ok(backing.byteLength>0);}
 const borrowed=image();await assert.rejects(reader.readPixels(borrowed,{priority:'background',takeOwnership:true}),/source owner/);assert.equal(borrowed.data.byteLength,24);await reader.dispose();
});
test('capacity rejection preserves input while cancellation retires an accepted queued pixel backing',async()=>{
 const {reader,workers}=fixture({maxPending:2,maxBytes:40}),active=reader.read(png,{id:'png'}),controller=new AbortController(),queued=image(),pending=reader.readPixels(queued,{id:'pixel',takeOwnership:true,signal:controller.signal});pending.catch(()=>{});assert.equal(queued.data.byteLength,0);const busy=image();await assert.rejects(reader.readPixels(busy,{takeOwnership:true}),/Too many/);assert.equal(busy.data.byteLength,24);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(reader.bytes,8);assert.equal(workers[0].stopped,undefined);answer(workers[0]);await active;await reader.dispose();
});
test('private foreground preemption aborts its exact source phase rather than requeuing detached pixels',async()=>{
 const {reader,workers}=fixture(),controller=new AbortController();let preempted=0;const background=reader.readPixels(image(),{id:'pixels',takeOwnership:true,priority:'background',signal:controller.signal,onPreempt:()=>{preempted++;controller.abort()}});background.catch(()=>{});const foreground=reader.read(png,{id:'foreground'});await assert.rejects(background,{name:'AbortError'});assert.equal(preempted,1);assert.equal(controller.signal.aborted,true);await tick();assert.equal(workers[1].job.requestId,'foreground');assert.equal(reader.jobs.has('pixels'),false);answer(workers[1]);await foreground;await reader.dispose();assert.equal(reader.bytes,0);
});
test('missing pixel-retirement ACK rejects and stops the model worker before idle reuse',async()=>{
 const {reader,workers}=fixture({idleMs:10000}),pending=reader.readPixels(image(),{takeOwnership:true});answer(workers[0],{pixelsReleased:false});await assert.rejects(pending,/retirement/);assert.equal(workers[0].stopped,true);await reader.awaitStopped();assert.equal(reader.workers.size,0);assert.equal(reader.bytes,0);await reader.dispose();
});
test('failed worker posting retires the admitted private backing and keeps scalar accounting exact',async()=>{
 const {reader,workers}=fixture({postFailure:true}),pixels=image();await assert.rejects(reader.readPixels(pixels,{takeOwnership:true}),/post failed/);assert.equal(pixels.data.byteLength,0);assert.equal(workers[0].received.pixels.data.byteLength,0);assert.equal(reader.bytes,0);await reader.dispose();
});
test('pixel cache fingerprints include every channel, dimensions and language without using PNG keys',()=>{
 const a=image(),b=image();assert.equal(pixelKey(a,'auto'),pixelKey(b,'auto'));b.data[23]++;assert.notEqual(pixelKey(a,'auto'),pixelKey(b,'auto'));assert.notEqual(pixelKey(a,'auto'),pixelKey({...a,width:2,height:3},'auto'));assert.notEqual(pixelKey(a,'auto'),pixelKey(a,'en'));assert.throws(()=>validatePixels({width:32769,height:1,data:new Uint8Array(4)}));
});
