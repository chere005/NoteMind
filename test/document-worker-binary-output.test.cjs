const{test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{randomUUID}=require('node:crypto'),factory=require('../src/document-byte-tools.js'),{executeBytes,CHUNK}=require('../src/document-worker-bytes.cjs');
const task=()=>new Promise(setImmediate);
function fixture({readFault,ackFault,releaseFault,mutate,signal}={}){
 const bytes=factory({consumeOwned:true,uuid:randomUUID,decode:text=>Uint8Array.from(Buffer.from(text,'base64'))}),sender=[],receiver=[],receipts=[];
 const context={window:{NoteMindDocumentBytes:bytes,documentTools:{image:async input=>{const taken=bytes.take(input);return{data:bytes.publishOwned(taken.owner,taken.bytes.buffer),width:4,height:3}}}}};
 let pending,reads=0,acks=0,releases=0;
 return{bytes,sender,receiver,receipts,get pending(){return pending},execute:async code=>{
  if(code.includes('["ackBinary"]')){acks++;assert.equal(receiver.at(-1).data.byteLength,0,'Main consumes its clone before sender ACK');if(ackFault===true||ackFault==='once'&&acks===1)throw Error('ACK reply lost');}
  if(code.includes('["release"]')){releases++;if(releaseFault==='once'&&releases===1)throw Error('release reply lost');}
  const value=await vm.runInNewContext(code,context);
  if(code.includes('["release"]')&&releaseFault==='after-once'&&releases===1)throw Error('release reply lost after dispatch');
  if(code.includes('["readBinary"]')){reads++;sender.push(value);pending={id:JSON.parse(code.slice(code.indexOf('](')+2).split(',')[0]),chunk:value.chunk};signal?.abort();if(readFault===true||readFault==='once'&&reads===1)throw Error('read reply lost');const copy=structuredClone(value);receiver.push(copy);mutate?.(copy);return copy;}
  if(code.includes('["ackBinary"]')){assert.equal(sender.at(-1).data.byteLength,0);receipts.push(value);if(ackFault==='after-once'&&acks===1)throw Error('ACK reply lost after dispatch');}
  return value;
 }};
}
test('private binary output uses complete bounded copies and consumes receiver before the exact sender ACK',async()=>{
 const h=fixture(),input=Buffer.alloc(2*CHUNK+77,153),before=Buffer.from(input),out=await executeBytes(h.execute,'image',[input],{binaryOutput:true});
 assert.deepEqual(out.data,input);assert.deepEqual(input,before);assert.equal(h.sender.length,3);assert.ok(h.sender.every(part=>part.data.byteLength===0));assert.ok(h.receiver.every(part=>part.data.byteLength===0));assert.deepEqual(h.receipts,[true,true,true]);assert.equal(h.bytes.stats().pendingBinaryChunks,0);assert.equal(h.bytes.stats().sessions,0);out.data.buffer.transfer(0);
});
test('pending chunk release remains charged until matching ACK, rejects foreign ACKs and preserves synchronous idle release',async()=>{
 const bytes=factory({consumeOwned:true,uuid:randomUUID}),id=bytes.begin(0),borrowed=new Uint8Array(CHUNK+5).fill(7),token=bytes.publish(id,borrowed),first=bytes.readBinary(id,token.documentByteOutput,0);
 assert.equal(first.data.byteOffset,0);assert.equal(first.data.buffer.byteLength,CHUNK);assert.notEqual(first.data.buffer,borrowed.buffer);assert.throws(()=>bytes.readBinary(id,token.documentByteOutput,CHUNK),/offset|pending/);
 assert.throws(()=>bytes.ackBinary(id,first.chunk+1),/Foreign/);assert.equal(first.data.byteLength,CHUNK);
 let done=false;const closing=bytes.release(id).then(()=>done=true);await task();assert.equal(done,false);assert.equal(bytes.stats().bytes,borrowed.length);assert.throws(()=>bytes.publish(id,borrowed),/unavailable/);
 assert.equal(bytes.ackBinary(id,first.chunk),true);await closing;assert.equal(done,true);assert.equal(first.data.byteLength,0);assert.equal(borrowed.byteLength,CHUNK+5);assert.equal(bytes.stats().bytes,0);
 const empty=bytes.begin(0);assert.equal(bytes.release(empty),undefined);
});
test('cancellation after receiving a chunk still consumes and acknowledges both copies without publishing',async()=>{
 const controller=new AbortController(),h=fixture({signal:controller}),input=Buffer.alloc(CHUNK+9,23);
 await assert.rejects(executeBytes(h.execute,'image',[input],{binaryOutput:true,signal:controller.signal}),{name:'AbortError'});
 assert.equal(h.receiver[0].data.byteLength,0);assert.equal(h.sender[0].data.byteLength,0);assert.equal(h.bytes.stats().bytes,0);assert.equal(input.byteLength,CHUNK+9);
});
test('malformed offset is rejected after exact received backing and sender ownership are both retired',async()=>{
 const h=fixture({mutate:part=>part.offset++});await assert.rejects(executeBytes(h.execute,'image',[Buffer.alloc(100)],{binaryOutput:true}),/interrupted/);assert.equal(h.receiver[0].data.byteLength,0);assert.equal(h.sender[0].data.byteLength,0);assert.equal(h.bytes.stats().bytes,0);
});
test('transient read, ACK and release rejection recover autonomously with the same token and no external ACK',async()=>{
 for(const options of[{readFault:'once'},{ackFault:'once'},{ackFault:'after-once'},{releaseFault:'once'},{releaseFault:'after-once'}]){
  const h=fixture(options),input=Buffer.alloc(100,27),out=await executeBytes(h.execute,'image',[input],{binaryOutput:true});assert.deepEqual(out.data,input);assert.equal(h.bytes.stats().bytes,0);assert.equal(h.bytes.stats().pendingBinaryChunks,0);assert.ok(h.sender.every(part=>part.data.byteLength===0));assert.ok(h.receiver.every(part=>part.data.byteLength===0));
  if(options.readFault){assert.equal(h.sender.length,2);assert.equal(h.sender[0].data.buffer,h.sender[1].data.buffer,'read retry reuses one exact sender backing');assert.equal(h.receiver.length,1);}
  out.data.buffer.transfer(0);
 }
});
test('cancel during the lost first read reconciles and drains autonomously without publishing',async()=>{
 const controller=new AbortController(),h=fixture({readFault:'once',signal:controller});await assert.rejects(executeBytes(h.execute,'image',[Buffer.alloc(100)],{binaryOutput:true,signal:controller.signal}),{name:'AbortError'});assert.equal(h.bytes.stats().bytes,0);assert.ok(h.sender.every(part=>part.data.byteLength===0));assert.equal(h.receiver[0].data.byteLength,0);
});
test('permanently lost binary response returns an explicit unconfirmed owner without freeing its sender',async()=>{
 for(const fault of['readFault','ackFault']){const h=fixture({[fault]:true});await assert.rejects(executeBytes(h.execute,'image',[Buffer.alloc(100)],{binaryOutput:true}),error=>error.resourcesReleased===false&&error.code==='DOCUMENT_BYTES_RELEASE_UNCONFIRMED');assert.equal(h.bytes.stats().pendingBinaryChunks,1);assert.ok(h.bytes.stats().bytes>0);if(fault==='ackFault')assert.equal(h.receiver[0].data.byteLength,0);h.bytes.ackBinary(h.pending.id,h.pending.chunk);h.bytes.release(h.pending.id);assert.equal(h.bytes.stats().bytes,0);}
});
test('binary output is opt-in and cannot consume a borrowed factory or a partial/shared receiver',async()=>{
 const generic=factory({uuid:randomUUID}),id=generic.begin(0),borrowed=Uint8Array.of(1,2);generic.publish(id,borrowed);assert.throws(()=>generic.readBinary(id,'1',0),/unavailable/);assert.equal(generic.release(id),undefined);assert.deepEqual([...borrowed],[1,2]);
 for(const shared of[false,true]){
  const backing=shared?new SharedArrayBuffer(100):new ArrayBuffer(101),view=new Uint8Array(backing,shared?0:1,100),h=fixture({mutate:part=>part.data=view});
  await assert.rejects(executeBytes(h.execute,'image',[Buffer.alloc(100)],{binaryOutput:true}),error=>error.resourcesReleased===false&&/receiver backing/.test(error.message));assert.equal(view.byteLength,100);assert.equal(h.bytes.stats().pendingBinaryChunks,1);h.bytes.ackBinary(h.pending.id,h.pending.chunk);h.bytes.release(h.pending.id);assert.equal(view.byteLength,100);
 }
});
test('chunk acknowledgement namespaces cannot cross concurrent transfers or reclaim another pending sender',()=>{
 const bytes=factory({consumeOwned:true,uuid:randomUUID}),a=bytes.begin(0),b=bytes.begin(0),source=Uint8Array.of(3,4),ta=bytes.publish(a,source),tb=bytes.publish(b,source),ca=bytes.readBinary(a,ta.documentByteOutput,0),cb=bytes.readBinary(b,tb.documentByteOutput,0);
 assert.throws(()=>bytes.ackBinary(b,ca.chunk),/acknowledgement/);assert.equal(cb.data.byteLength,2);assert.equal(ca.data.byteLength,2);bytes.ackBinary(a,ca.chunk);assert.equal(bytes.ackBinary(a,ca.chunk),true);assert.equal(cb.data.byteLength,2);bytes.ackBinary(b,cb.chunk);bytes.release(a);bytes.release(b);assert.deepEqual([...source],[3,4]);
});
test('a failed sender detach keeps its session and charge until an explicit successful cleanup retry',()=>{
 const bytes=factory({consumeOwned:true,uuid:randomUUID}),id=bytes.begin(0),output=Uint8Array.of(7,8);bytes.publishOwned(id,output.buffer);Object.defineProperty(output.buffer,'transfer',{configurable:true,value(){throw Error('detach failed')}});
 assert.throws(()=>bytes.release(id),/could not be released/);assert.equal(bytes.stats().sessions,1);assert.equal(bytes.stats().bytes,2);assert.equal(output.byteLength,2);delete output.buffer.transfer;assert.equal(bytes.release(id),undefined);assert.equal(output.byteLength,0);assert.equal(bytes.stats().bytes,0);
});
test('a failed Main receiver detach keeps the sender charged until receiver cleanup really finishes',async()=>{
 let receiver,restore;const h=fixture({mutate:part=>{receiver=part.data;const original=receiver.buffer.transfer;Object.defineProperty(receiver.buffer,'transfer',{configurable:true,value(){throw Error('receiver detach failed')}});restore=()=>Object.defineProperty(receiver.buffer,'transfer',{configurable:true,value:original});}});
 let done=false;const work=executeBytes(h.execute,'image',[Buffer.alloc(100)],{binaryOutput:true}).finally(()=>done=true);work.catch(()=>{});
 for(let at=0;at<20&&!receiver;at++)await task();await task();assert.equal(done,false);assert.equal(receiver.byteLength,100);assert.equal(h.bytes.stats().pendingBinaryChunks,1);assert.ok(h.bytes.stats().bytes>0);
 restore();await assert.rejects(work,/required a retry/);assert.equal(receiver.byteLength,0);assert.equal(h.sender[0].data.byteLength,0);assert.equal(h.bytes.stats().bytes,0);
});
test('failed sender chunk detach preserves the exact pending token through cancelled release and ACK retry',async()=>{
 const bytes=factory({consumeOwned:true,uuid:randomUUID}),id=bytes.begin(0),borrowed=Uint8Array.of(5,6,7),token=bytes.publish(id,borrowed),chunk=bytes.readBinary(id,token.documentByteOutput,0),transfer=chunk.data.buffer.transfer;
 Object.defineProperty(chunk.data.buffer,'transfer',{configurable:true,value(){throw Error('sender detach failed')}});
 let done=false;const closing=bytes.release(id).then(()=>done=true);assert.throws(()=>bytes.ackBinary(id,chunk.chunk),/could not be released/);await task();assert.equal(done,false);assert.equal(bytes.stats().pendingBinaryChunks,1);assert.equal(bytes.stats().bytes,3);assert.equal(chunk.data.byteLength,3);assert.throws(()=>bytes.readBinary(id,token.documentByteOutput,0),/unavailable/,'cancelled owner cannot issue another chunk');
 Object.defineProperty(chunk.data.buffer,'transfer',{value:transfer});assert.equal(bytes.ackBinary(id,chunk.chunk),true);await closing;assert.equal(done,true);assert.equal(chunk.data.byteLength,0);assert.equal(bytes.stats().bytes,0);assert.deepEqual([...borrowed],[5,6,7]);
});
test('expiry contains detach failure and retries exact owned cleanup without an uncaught timer error',()=>{
 const timers=[],make=vm.runInNewContext('('+factory.toString()+')',{ArrayBuffer,Uint8Array,setTimeout:run=>{const timer={run,unref(){}};timers.push(timer);return timer;},clearTimeout(){}}),bytes=make({consumeOwned:true,uuid:randomUUID}),id=bytes.begin(0),output=Uint8Array.of(1,2);bytes.publishOwned(id,output.buffer);
 Object.defineProperty(output.buffer,'transfer',{configurable:true,value(){throw Error('expiry detach failed')}});assert.doesNotThrow(()=>timers.at(-1).run());assert.equal(bytes.stats().sessions,1);assert.equal(bytes.stats().cleanupFailures,1);assert.equal(output.byteLength,2);
 delete output.buffer.transfer;assert.doesNotThrow(()=>timers.at(-1).run());assert.equal(bytes.stats().sessions,0);assert.equal(output.byteLength,0);
});
