const {test}=require('node:test'),assert=require('node:assert/strict'),{Worker}=require('node:worker_threads'),{EventEmitter}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
const {ArchiveCodec}=require('../src/archive-codec.cjs'),{ArchiveAssetClient,ArchiveAssetWorker}=require('../src/archive-assets.cjs'),format=require('../src/notepad-format.cjs');
const tick=()=>new Promise(setImmediate),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const doc=()=>({id:'asset-test',title:'Assets',text:'![a](assets/a.bin)',created:'2026-01-01',meta:{tags:['before']},assets:{'assets/a.bin':Buffer.alloc(32*1024,7).toString('base64')}});
function real(options={}){
 const sent=[],received=[];const codec=new ArchiveCodec({idleMs:100000,...options,workerFactory:file=>{
  const worker=new Worker(file),post=worker.postMessage.bind(worker);worker.postMessage=(packet,transfers)=>{sent.push({op:packet.op,added:Object.keys(packet.assetPacket?.added||{}),refs:{...packet.assetPacket?.refs},known:packet.knownAssets?.length});post(packet,transfers);};
  worker.on('message',packet=>received.push({id:packet.id,missing:packet.missingAssets,outputAdded:Object.keys(packet.assetResult?.output?.added||{}).length,stats:packet.assetStats}));return worker;
 }});return {codec,sent,received};
}
function fake(options={}){
 const workers=[];class FakeWorker extends EventEmitter{constructor(){super();this.messages=[];workers.push(this);}postMessage(packet){this.messages.push(packet);}ref(){}unref(){}terminate(){return Promise.resolve(0);}}
 const codec=new ArchiveCodec({workerFactory:()=>new FakeWorker(),idleMs:100000,...options});return {codec,workers};
}
function answer(worker,value=Uint8Array.from([1])){const packet=worker.messages.at(-1),accepted={};for(const token of Object.values(packet.assetPacket?.refs||{}))accepted[token]=token.startsWith('upload:')?randomUUID():token;worker.emit('message',{id:packet.id,value,assetResult:{accepted}});}

test('warm archive jobs upload unchanged assets once and verified decode returns references',async t=>{
 const h=real();t.after(()=>h.codec.dispose());const original=doc(),first=await h.codec.encode(original);await h.codec.encode({...original,text:'Edited'});await h.codec.prepareSnapshot(original,{knownHashes:[hash(Buffer.alloc(32*1024,7))]});
 const decoded=await h.codec.decode(first,{files:false});assert.deepEqual(decoded.assets,original.assets);assert.equal(h.sent[0].added.length,1);assert.equal(h.sent[1].added.length,0);assert.equal(h.sent[2].added.length,0);assert.equal(h.received.at(-1).outputAdded,0);assert.ok(h.received.at(-1).stats.decodeReuses>=1);assert.equal(h.codec.assetStats().uploads,1);
});

test('owned decode and inspection detach only expressly relinquished exact buffers',async t=>{
 const h=real();t.after(()=>h.codec.dispose());const original=doc(),archive=format.encode(original),first=Uint8Array.from(archive),decoding=h.codec.decodeOwned(first,{files:false});assert.equal(first.byteLength,0);assert.deepEqual((await decoding).assets,original.assets);
 const second=Uint8Array.from(archive),length=second.length,inspection=h.codec.inspectOwned(second,{files:false});assert.equal(second.byteLength,0);const result=await inspection;assert.equal(result.bytes,length);assert.equal(result.revision,hash(archive));assert.equal(result.doc.text,original.text);assert.equal(result.doc.files,undefined);assert.equal(h.received.at(-1).outputAdded,0);assert.ok(h.received.at(-1).stats.decodeReuses>=1);
 const buffer=Uint8Array.from(archive).buffer,pending=h.codec.decodeOwned(buffer,{files:false});assert.equal(buffer.byteLength,0);assert.equal((await pending).text,original.text);
});

test('legacy decode preserves caller bytes and owned decode rejects shared or partial ownership',async t=>{
 const h=real();t.after(()=>h.codec.dispose());const archive=format.encode(doc()),before=Buffer.from(archive);await h.codec.decode(archive,{files:false});assert.deepEqual(archive,before);
 const backing=new Uint8Array(100),partial=backing.subarray(1,20);await assert.rejects(h.codec.decodeOwned(partial),/exact, transferable/);assert.equal(backing.byteLength,100);assert.equal(partial.byteLength,19);
 const pooled=Buffer.from('pool');await assert.rejects(h.codec.decodeOwned(pooled),/exact, transferable/);assert.equal(pooled.toString(),'pool');
 const shared=new SharedArrayBuffer(100);await assert.rejects(h.codec.decodeOwned(shared),/exact, transferable/);assert.equal(shared.byteLength,100);
 const owned=new Uint8Array(100);await assert.rejects(h.codec.decodeOwned(owned,{bad(){}}));assert.equal(owned.byteLength,100);
});

test('queue rejection does not take ownership of bytes it cannot accept',async()=>{
 const h=fake({maxPending:1}),active=h.codec.encode({text:'hold'}).catch(error=>error.message),bytes=new Uint8Array(100);
 await assert.rejects(h.codec.decodeOwned(bytes),/busy/);assert.equal(bytes.byteLength,100);await h.codec.dispose();assert.match(await active,/closing/);assert.equal(h.codec.bytes,0);
});

test('encoded digest is computed on the transferred bytes and remains compatible',async t=>{
 const h=real();t.after(()=>h.codec.dispose());const value=await h.codec.encodeWithDigest(doc(),{extra:{'recovery.json':{dirty:true}}});assert.equal(Buffer.isBuffer(value.bytes),true);assert.equal(value.revision,hash(value.bytes));assert.equal(format.decode(value.bytes).text,doc().text);assert.equal(JSON.parse(format.decode(value.bytes).files['recovery.json']).dirty,true);
});

test('queued asset maps and metadata retain their initiating values',async()=>{
 const h=fake(),first=h.codec.encode({text:'hold'}),original=doc(),second=h.codec.encode(original);original.assets['assets/a.bin']='CHANGED';original.meta.tags.push('later');answer(h.workers[0]);await first;
 const packet=h.workers[0].messages.at(-1);assert.equal(packet.args[0].assets,undefined);assert.deepEqual(packet.args[0].meta.tags,['before']);assert.equal(Object.values(packet.assetPacket.added)[0],doc().assets['assets/a.bin']);answer(h.workers[0]);await second;await h.codec.dispose();
});

test('worker reset reuploads immutable values in a fresh epoch without rebinding old references',async()=>{
 const h=fake(),original=doc(),first=h.codec.encode(original);answer(h.workers[0]);await first;const old=h.workers[0],second=h.codec.encode(original),failed=assert.rejects(second,/crashed/),third=h.codec.encode(original);assert.equal(Object.keys(old.messages.at(-1).assetPacket.added).length,0);
 old.emit('error',Error('crashed'));await failed;await tick();assert.equal(h.workers.length,2);const packet=h.workers[1].messages[0];assert.equal(Object.keys(packet.assetPacket.added).length,1);assert.ok(Object.values(packet.assetPacket.refs)[0].startsWith('upload:'));answer(h.workers[1]);await third;assert.equal(h.codec.assetStats().epoch,2);await h.codec.dispose();
});

test('evicted worker references retry once with a fresh upload before the operation starts',async()=>{
 const h=fake(),original=doc(),first=h.codec.encode(original);answer(h.workers[0]);await first;const worker=h.workers[0],second=h.codec.encode(original),before=worker.messages.at(-1),token=Object.values(before.assetPacket.refs)[0];assert.equal(Object.keys(before.assetPacket.added).length,0);
 worker.emit('message',{id:before.id,missingAssets:[token]});const retry=worker.messages.at(-1),fresh=Object.values(retry.assetPacket.refs)[0];assert.notEqual(fresh,token);assert.ok(fresh.startsWith('upload:'));assert.equal(retry.assetPacket.added[fresh],original.assets['assets/a.bin']);answer(worker);await second;await h.codec.dispose();
});

test('repeated missing-reference responses are bounded and release the queue budget',async()=>{
 const h=fake(),pending=h.codec.encode(doc()),rejected=assert.rejects(pending,/expired repeatedly/),worker=h.workers[0];for(let n=0;n<3;n++){const packet=worker.messages.at(-1);worker.emit('message',{id:packet.id,missingAssets:Object.values(packet.assetPacket.refs)});}await rejected;assert.equal(worker.messages.length,3);assert.equal(h.codec.bytes,0);await h.codec.dispose();
});

test('canonical references cannot be rebound after cache eviction or by a malformed acknowledgement',()=>{
 const worker=new ArchiveAssetWorker({maxBytes:4}),input='upload:'+randomUUID(),received=worker.receive({document:{text:'x'},refs:{'assets/a':input},added:{[input]:'QUFBQUFB'}}),token=received.accepted[input];worker.trim();assert.equal(worker.stats().entries,0);
 assert.throws(()=>worker.receive({document:{text:'x'},refs:{'assets/a':token},added:{[token]:'QkJCQkJC'}}),/cannot be uploaded or rebound/);assert.deepEqual(worker.receive({document:{text:'x'},refs:{'assets/a':token},added:{}}),{missing:[token]});
 const client=new ArchiveAssetClient();client.remember(token,'AAAA',1);assert.throws(()=>client.remember(token,'BBBB',1),/cannot be changed/);assert.equal(client.entries.get(token).data,'AAAA');
});

test('a document larger than the retained asset cache still succeeds and trims afterward',async t=>{
 const h=real({maxAssetBytes:8});t.after(()=>h.codec.dispose());const original=doc(),first=await h.codec.encode(original);assert.equal(format.decode(first).assets['assets/a.bin'],original.assets['assets/a.bin']);assert.equal(h.codec.assetStats().entries,0);assert.equal(h.codec.assetStats().worker.entries,0);await h.codec.encode(original);assert.equal(h.sent[1].added.length,1);
 const blocked=fake({maxBytes:4096});await assert.rejects(blocked.codec.encode(original),/busy/);assert.equal(blocked.workers.length,0);await blocked.codec.dispose();
});

test('worker memory rollover and idle stop reset epoch acknowledgements',async t=>{
 const h=real({maxWorkerBytes:1});t.after(()=>h.codec.dispose());await h.codec.encode(doc());await h.codec.encode(doc());assert.equal(h.codec.assetStats().rollovers,2);assert.equal(h.codec.assetStats().epoch,2);assert.equal(h.sent[0].added.length,1);assert.equal(h.sent[1].added.length,1);
 const idle=real({idleMs:5});t.after(()=>idle.codec.dispose());await idle.codec.encode(doc());await new Promise(resolve=>setTimeout(resolve,20));await idle.codec.encode(doc());assert.equal(idle.codec.assetStats().epoch,2);assert.equal(idle.sent[1].added.length,1);
});

test('failed worker termination never overlaps a replacement and releases queued ownership',async()=>{
 const workers=[];class StopWorker extends EventEmitter{constructor(){super();this.messages=[];this.threadId=7;workers.push(this);}postMessage(packet){this.messages.push(packet);}ref(){}unref(){}terminate(){return workers.indexOf(this)===0?Promise.reject(Error('Still alive')):Promise.resolve(0);}}
 const codec=new ArchiveCodec({workerFactory:()=>new StopWorker(),maxWorkerBytes:1}),first=codec.encode(doc()),second=codec.encode(doc()),rejected=assert.rejects(second,/could not stop/),old=workers[0],packet=old.messages[0],accepted={};for(const token of Object.values(packet.assetPacket.refs))accepted[token]=randomUUID();old.emit('message',{id:packet.id,value:Uint8Array.from([1]),assetResult:{accepted},workerBytes:2});await first;await rejected;await tick();assert.equal(workers.length,1);assert.equal(codec.bytes,0);await assert.rejects(codec.encode(doc()),/could not stop/);
 old.threadId=-1;old.emit('exit',0);await tick();const recovered=codec.encode(doc());assert.equal(workers.length,2);answer(workers[1]);await recovered;await codec.dispose();assert.equal(codec.assetStats().entries,0);
});

test('digest reuse preserves normalized legacy base64 semantics',async t=>{
 const h=real();t.after(()=>h.codec.dispose());for(const data of ['YQ','YR==',' YQ==']){const bytes=await h.codec.encode({text:'legacy',assets:{'assets/a.bin':data}}),decoded=await h.codec.decode(bytes,{files:false});assert.equal(decoded.assets['assets/a.bin'],'YQ==');}
});
