const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {TextReader}=require('../src/ocr.cjs');
const png=Buffer.from([137,80,78,71,13,10,26,10]),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){const workers=[];class FakeWorker extends EventEmitter{constructor(_file,options){super();this.options=options;workers.push(this)}postMessage(job){this.job=job}terminate(){this.stopped=true;return Promise.resolve(0)}}return {workers,reader:new TextReader({idleMs:0,workerFactory:(...args)=>new FakeWorker(...args),...options})};}
const answer=worker=>worker.emit('message',{id:worker.job.id,lines:[{text:worker.job.requestId,x:0,y:0,width:1,height:1}]});
test('disposing OCR cancels active and queued work without launching more workers',async()=>{
 const {reader,workers}=fixture(),jobs=Array.from({length:4},(_,i)=>reader.read(png,{id:String(i)}).catch(error=>error.name));assert.equal(workers.length,1);reader.dispose();assert.deepEqual(await Promise.all(jobs),Array(4).fill('AbortError'));await tick();assert.equal(workers.length,1);assert.equal(reader.workers.size,0);assert.equal(reader.bytes,0);await assert.rejects(reader.read(png),/closing/);
});
test('foreground OCR preempts background work and ignores the terminated worker results',async()=>{
 const {reader,workers}=fixture(),background=reader.read(png,{id:'background',priority:'background'}),foreground=reader.read(png,{id:'foreground'});assert.equal(workers[0].stopped,true);await tick();assert.equal(workers[1].job.requestId,'foreground');assert.ok(workers[1].options.workerData.threads<=2);answer(workers[0]);assert.equal(reader.jobs.has('background'),true);answer(workers[1]);assert.equal((await foreground).text,'foreground');await tick();assert.equal(workers[2].job.requestId,'background');answer(workers[2]);assert.equal((await background).text,'background');reader.dispose();await tick();
});
test('OCR queue memory is bounded and cancellation releases its accounting',async()=>{
 const {reader}=fixture({maxPending:2,maxBytes:16}),a=reader.read(png,{id:'a'}).catch(error=>error.name),b=reader.read(png,{id:'b'}).catch(error=>error.name);await assert.rejects(reader.read(png,{id:'c'}),/Too many images/);reader.dispose();await Promise.all([a,b]);assert.equal(reader.bytes,0);await tick();
});
test('background jobs leave queue capacity for an explicit reading',async()=>{
 const {reader,workers}=fixture({maxPending:2,maxBytes:32}),background=reader.read(png,{id:'background',priority:'background'}).catch(error=>error.name);await assert.rejects(reader.read(png,{id:'other-background',priority:'background'}),/Too many images/);const foreground=reader.read(png,{id:'foreground'});await tick();assert.equal(workers[1].job.requestId,'foreground');answer(workers[1]);assert.equal((await foreground).text,'foreground');reader.dispose();await background;await tick();
});
test('aborting a queued reading does not stop the active reading',async()=>{
 const {reader,workers}=fixture(),controller=new AbortController(),a=reader.read(png,{id:'a'}),b=reader.read(png,{id:'b',signal:controller.signal}).catch(error=>error.name);controller.abort();assert.equal(await b,'AbortError');assert.equal(workers[0].stopped,undefined);answer(workers[0]);assert.equal((await a).text,'a');reader.dispose();await tick();
});
test('a failed worker creation or progress callback cannot leave OCR jobs stuck',async()=>{
 const {reader,workers}=fixture();let first=true;const factory=reader.workerFactory;reader.workerFactory=(...args)=>{if(first){first=false;throw Error('worker unavailable')}return factory(...args)};await assert.rejects(reader.read(png,{id:'failed'}),/unavailable/);assert.equal(reader.jobs.size,0);const pending=reader.read(png,{id:'next',onProgress:()=>{throw Error('closed sender')}});answer(workers[0]);assert.equal((await pending).text,'next');reader.dispose();await tick();
});
