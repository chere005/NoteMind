const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{ArchiveCodec}=require('../src/archive-codec.cjs'),format=require('../src/notepad-format.cjs');
function fixture(options={}){const workers=[];class FakeWorker extends EventEmitter{constructor(){super();workers.push(this);this.messages=[];this.threadId=1}postMessage(value){this.messages.push(value)}ref(){}unref(){}terminate(){this.stopped=true;queueMicrotask(()=>{this.threadId=-1;this.emit('exit',0)});return Promise.resolve(0)}}return {workers,codec:new ArchiveCodec({workerFactory:()=>new FakeWorker(),idleMs:100000,...options})};}
const tick=()=>new Promise(resolve=>setImmediate(resolve)),answer=(worker,value)=>worker.emit('message',{id:worker.messages.at(-1).id,value});
test('idle worker telemetry and empty completion cannot enter a missing archive job',async t=>{
 const h=fixture();t.after(()=>h.codec.dispose());const first=h.codec.encode({text:'first'}),worker=h.workers[0];answer(worker,Uint8Array.from([1]));await first;
 for(const packet of [{fixtureWordInlineMemory:{phase:'released'}},{rawStats:{}},null,undefined])assert.doesNotThrow(()=>worker.emit('message',packet));
 assert.doesNotThrow(()=>h.codec.finish(null,null));assert.equal(h.codec.active,null);assert.equal(h.codec.bytes,0);
 const next=h.codec.encode({text:'next'});answer(worker,Uint8Array.from([2]));assert.deepEqual(await next,Buffer.from([2]));await h.codec.dispose();
});
test('uncorrelated and duplicate packets cannot consume the next valid archive job',async t=>{
 const h=fixture();t.after(()=>h.codec.dispose());const first=h.codec.encode({text:'first'}),second=h.codec.encode({text:'second'}),worker=h.workers[0],firstId=worker.messages[0].id;
 for(const packet of [null,undefined,{fixtureWordInlineMemory:{phase:'parse'}}])assert.doesNotThrow(()=>worker.emit('message',packet));
 answer(worker,Uint8Array.from([1]));await first;const current=h.codec.active;
 assert.doesNotThrow(()=>worker.emit('message',{id:firstId,error:{message:'stale failure'}}));assert.equal(h.codec.active,current);
 const rejected=assert.rejects(second,/real failure/);worker.emit('message',{id:current.id,error:{name:'Error',message:'real failure'}});await rejected;assert.equal(h.codec.bytes,0);await h.codec.dispose();
});
test('archive work is serialized, bounded and freezes queued document state',async()=>{
 const h=fixture({maxPending:2,maxBytes:1024}),doc={text:'first',assets:{},meta:{tags:['before']}},first=h.codec.encode(doc),second=h.codec.encode(doc);
 doc.text='changed';doc.meta.tags.push('later');doc.assets['assets/new']='AA==';await assert.rejects(h.codec.encode(doc),/busy/);
 assert.equal(h.workers.length,1);assert.equal(h.workers[0].messages.length,1);answer(h.workers[0],Uint8Array.from([1]));await first;
 const message=h.workers[0].messages[1],queued=message.args[0];assert.equal(queued.text,'first');assert.deepEqual(queued.meta.tags,['before']);assert.equal(queued.assets,undefined);assert.deepEqual({...message.assetPacket.refs},{});assert.deepEqual(message.assetPacket.added,{});
 answer(h.workers[0],Uint8Array.from([2]));assert.deepEqual(await second,Buffer.from([2]));assert.equal(h.codec.bytes,0);await h.codec.dispose();
});
test('a failed worker rejects only its active job, ignores late replies and recovers queued work',async()=>{
 const h=fixture(),a=h.codec.encode({text:'a'}),rejected=assert.rejects(a,/crashed/),b=h.codec.encode({text:'b'}),old=h.workers[0];old.emit('error',Error('crashed'));await rejected;for(let turn=0;h.workers.length<2&&turn<100;turn++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(h.workers.length,2);answer(old,Uint8Array.from([9]));answer(h.workers[1],Uint8Array.from([2]));assert.deepEqual(await b,Buffer.from([2]));await h.codec.dispose();
});
test('disposing archive work releases pending memory and rejects outstanding work',async()=>{
 const h=fixture(),a=h.codec.encode({text:'a'}).catch(e=>e.message),b=h.codec.encode({text:'b'}).catch(e=>e.message);await h.codec.dispose();assert.match(await a,/closing/);assert.match(await b,/closing/);assert.equal(h.codec.bytes,0);assert.equal(h.workers[0].stopped,true);await assert.rejects(h.codec.encode({text:'c'}),/closing/);
});
test('real worker archives remain compatible and metadata-only decode avoids returning duplicate asset buffers',async()=>{
 const codec=new ArchiveCodec({idleMs:100}),doc={id:'worker-test',text:'# hello',assets:{'assets/a.bin':Buffer.alloc(256*1024,7).toString('base64')},meta:{tags:['one']}};
 try{const bytes=await codec.encode(doc,{extra:{'recovery.json':{dirty:true}}});assert.deepEqual(format.decode(bytes).assets,doc.assets);const decoded=await codec.decode(bytes);assert.equal(decoded.text,doc.text);assert.deepEqual(decoded.assets,doc.assets);assert.deepEqual(Object.keys(decoded.files).sort(),['document.md','manifest.json','recovery.json']);assert.equal(JSON.parse(decoded.files['recovery.json']).dirty,true);const lean=await codec.decode(bytes,{files:false});assert.equal(lean.files,undefined);await assert.rejects(codec.decode(Buffer.from('bad')),/Invalid archive/);}finally{await codec.dispose();}
});
test('nested metadata, options and JSON data cannot bypass archive queue byte limits',async()=>{
 const h=fixture({maxBytes:4096});
 await assert.rejects(h.codec.encode({text:'small',meta:{nested:{text:'x'.repeat(3000)}}}),/busy/);
 await assert.rejects(h.codec.encode({text:'small'},{extra:{'recovery.json':{nested:{text:'x'.repeat(3000)}}}}),/busy/);
 await assert.rejects(h.codec.readSnapshot('/root','version',{nested:{text:'x'.repeat(3000)}}),/busy/);
 await assert.rejects(h.codec.stringifyJson({records:{note:{text:'x'.repeat(3000)}}}),/busy/);
 await assert.rejects(h.codec.parseJson(Buffer.alloc(5000)),/busy/);
 assert.equal(h.workers.length,0);assert.equal(h.codec.bytes,0);await h.codec.dispose();
});
test('queued JSON serialization freezes the initiating index instead of retaining mutable state',async()=>{
 const h=fixture(),first=h.codec.encode({text:'hold'}),index={records:{note:{text:'before',meta:{tags:['one']}}}},second=h.codec.stringifyJson(index);
 index.records.note.text='after';index.records.note.meta.tags.push('later');answer(h.workers[0],Uint8Array.from([1]));await first;
 const queued=h.workers[0].messages.at(-1);assert.equal(queued.op,'stringifyJson');assert.equal(queued.args[0].records.note.text,'before');assert.deepEqual(queued.args[0].records.note.meta.tags,['one']);answer(h.workers[0],Uint8Array.from(Buffer.from(JSON.stringify(queued.args[0]))));assert.equal(JSON.parse(await second).records.note.text,'before');await h.codec.dispose();
});
test('real worker JSON parse/stringify preserves Unicode and does not detach caller bytes',async()=>{
 const codec=new ArchiveCodec({idleMs:100}),index={records:{note:{text:'中文\n日本語\n🖊️',meta:{tags:['work']}}},deleted:[]};
 try{const bytes=await codec.stringifyJson(index);assert.equal(Buffer.isBuffer(bytes),true);const original=Buffer.from(bytes);assert.deepEqual(await codec.parseJson(bytes),index);assert.deepEqual(bytes,original);await assert.rejects(codec.parseJson(Buffer.from('{bad')),error=>error.name==='SyntaxError');assert.equal(codec.bytes,0);}finally{await codec.dispose();}
});
