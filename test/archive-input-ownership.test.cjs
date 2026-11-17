const {test}=require('node:test'),assert=require('node:assert/strict'),{Worker,markAsUntransferable}=require('node:worker_threads'),{randomBytes,randomUUID}=require('node:crypto');
const {releaseArchiveInput}=require('../src/archive-input-ownership.cjs'),{ArchiveCodec}=require('../src/archive-codec.cjs'),format=require('../src/notepad-format.cjs');
test('completed archive snapshots retire only exact private read-operation inputs',()=>{
 for(const op of ['decode','decodeOwned','inspectOwned','inspectDrawingOwned','duplicateArchiveOwned','parseJson']){const bytes=new Uint8Array(32);assert.equal(releaseArchiveInput(op,[bytes]),32);assert.equal(bytes.byteLength,0);assert.equal(releaseArchiveInput(op,[bytes]),0);}
 for(const op of ['rawAppend','encodeDrawingOwned','encode','publishVersion']){const bytes=new Uint8Array(32);assert.equal(releaseArchiveInput(op,[bytes]),0);assert.equal(bytes.byteLength,32);}
 const offset=new Uint8Array(33).subarray(1),shared=new Uint8Array(new SharedArrayBuffer(32)),protectedBytes=new Uint8Array(32);markAsUntransferable(protectedBytes.buffer);
 for(const bytes of [offset,shared,protectedBytes]){assert.equal(releaseArchiveInput('decode',[bytes]),0);assert.equal(bytes.byteLength,32);}
});
test('real worker retires compressed input before replying while copied files and raw stored assets remain exact',async()=>{
 const observed=[],codec=new ArchiveCodec({workerFactory:file=>{const worker=new Worker(`const {parentPort}=require('node:worker_threads');let input;parentPort.on('message',packet=>{input=packet.args?.[0]});const send=parentPort.postMessage.bind(parentPort);parentPort.postMessage=(packet,transfers)=>send({...packet,fixtureInputBytes:input?.byteLength},transfers);require(${JSON.stringify(require.resolve('../src/archive-worker.cjs'))});`,{eval:true});worker.on('message',packet=>{if(packet.fixtureInputBytes!==undefined)observed.push(packet.fixtureInputBytes)});return worker;},idleMs:100000}),asset=randomBytes(512*1024),doc={text:'Exact private archive',assets:{'assets/random.bin':asset.toString('base64')}},encoded=format.encode(doc),before=Buffer.from(encoded);
 try{
  const full=await codec.decode(encoded,{files:true});assert.deepEqual(encoded,before);assert.deepEqual(full.files['assets/random.bin'],asset);assert.equal(full.assets['assets/random.bin'],doc.assets['assets/random.bin']);assert.equal(observed.at(-1),0);
  const owner=randomUUID(),lease=await codec.preflightRawAssets([],{owner});try{await lease.run(async()=>{const snapshot=Uint8Array.from(encoded),loaded=await codec.inspectOwned(snapshot,{files:'metadata'});assert.equal(snapshot.byteLength,0);assert.equal(observed.at(-1),0);assert.deepEqual(Buffer.from(await codec.readRawAsset(loaded.doc.assets['assets/random.bin'],{offset:0,length:asset.length})),asset);assert.equal(loaded.doc.text,doc.text);});}finally{await lease.release();await codec.releaseRawAssets(owner);}
  await assert.rejects(codec.decode(Buffer.from('invalid archive')),/Invalid archive/);assert.equal(observed.at(-1),0);
 }finally{await codec.dispose();}
});
