const {test}=require('node:test'),assert=require('node:assert/strict');
const {CameraPictures,pictureRef}=require('../src/camera-pictures.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return {promise,resolve,reject};};
function png(width=100,height=100){const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]).copy(bytes);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return 'data:image/png;base64,'+bytes.toString('base64');}
function bitmap(ref){return {width:ref.width,height:ref.height,closed:0,close(){this.closed++;}};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('saved pictures validate bounded PNG dimensions without decoding',()=>{
 const ref=pictureRef(png(4000,3000));assert.equal(ref.width,4000);assert.equal(ref.height,3000);assert.equal(Object.isFrozen(ref),true);for(const value of [null,'data:text/plain;base64,eA==',png(0,100),png(32769,1),png(10000,10000),'data:image/png;base64,eA=='])assert.throws(()=>pictureRef(value));
});
test('100 immutable pictures remain encoded until a visible picture is leased',async()=>{
 let decodes=0;const pictures=new CameraPictures({decode:async ref=>{decodes++;return bitmap(ref);}}),refs=Array.from({length:100},()=>pictureRef(png(1000,1000)));assert.equal(decodes,0);const a=await pictures.acquire(refs[0]),b=await pictures.acquire(refs[0]);assert.equal(decodes,1);assert.equal(a.image,b.image);a.release();a.release();b.release();pictures.dispose();assert.equal(a.image.closed,1);assert.equal(pictures.stats().decodedBytes,0);
});
test('one decode is active and decoded budgets wait for protected leases before evicting',async()=>{
 const starts=[],images=[],pictures=new CameraPictures({maxBytes:40000,maxEntries:1,decode:async ref=>{starts.push(ref);const image=bitmap(ref);images.push(image);return image;}}),a=pictureRef(png()),b=pictureRef(png());const first=await pictures.acquire(a),pending=pictures.acquire(b);await tick();assert.equal(starts.length,1);assert.equal(first.image.closed,0);first.release();const second=await pending;assert.equal(starts.length,2);assert.equal(first.image.closed,1);assert.equal(pictures.stats().decodedBytes,40000);pictures.dispose();assert.equal(second.image.closed,0);second.release();assert.equal(second.image.closed,1);assert.equal(pictures.stats().decodedBytes,0);
});
test('cancelling one shared caller does not cancel another caller or leak listeners',async()=>{
 const work=deferred(),pictures=new CameraPictures({decode:()=>work.promise}),ref=pictureRef(png()),a=new AbortController(),b=new AbortController(),one=pictures.acquire(ref,{signal:a.signal}),two=pictures.acquire(ref,{signal:b.signal});a.abort();await assert.rejects(one,{name:'AbortError'});const image=bitmap(ref);work.resolve(image);const held=await two;assert.equal(held.image,image);b.abort();assert.equal(image.closed,0);held.release();pictures.dispose();assert.equal(image.closed,1);
});
test('superseded in-flight decode closes its result and permits the latest queued picture',async()=>{
 const work=deferred(),ref=pictureRef(png()),next=pictureRef(png(50,50));let count=0;const pictures=new CameraPictures({decode:item=>++count===1?work.promise:Promise.resolve(bitmap(item))}),controller=new AbortController(),old=pictures.acquire(ref,{signal:controller.signal});controller.abort();await assert.rejects(old,{name:'AbortError'});const latest=pictures.acquire(next),image=bitmap(ref);work.resolve(image);const held=await latest;assert.equal(image.closed,1);assert.equal(count,2);assert.equal(held.image.width,50);held.release();pictures.dispose();
});
test('new captures encode once, retry failures, and cannot publish after disposal',async()=>{
 let calls=0;const canvas={},pictures=new CameraPictures({encode:async()=>{calls++;return png();}});const first=pictures.capture(canvas),second=pictures.capture(canvas);assert.equal(first,second);assert.equal(await first,await second);assert.equal(calls,1);pictures.dispose();const work=deferred(),closing=new CameraPictures({encode:()=>work.promise}),pending=closing.capture({});await tick();closing.dispose();work.resolve(png());await assert.rejects(pending,{name:'AbortError'});let attempts=0;const retry=new CameraPictures({encode:()=>{if(++attempts===1)throw Error('encode failed');return png();}}),source={};await assert.rejects(retry.capture(source),/encode failed/);assert.equal((await retry.capture(source)).width,100);assert.equal(attempts,2);retry.dispose();
});
test('decode errors, dimension changes and malformed requests cannot wedge the queue',async()=>{
 let count=0;const pictures=new CameraPictures({decode:async ref=>{if(++count===1)throw Error('bad image');return bitmap(ref);}}),ref=pictureRef(png());await assert.rejects(pictures.acquire(ref),/bad image/);const image=await pictures.acquire(ref);image.release();pictures.dispose();for(const forged of [{source:'x',width:NaN,height:1},{source:'x',width:-1,height:1},{source:'x',width:1,height:Infinity}])await assert.rejects(new CameraPictures().acquire(forged),/budget/);
 const wrong={width:9,height:8,closed:0,close(){this.closed++;}},mismatch=new CameraPictures({decode:async()=>wrong});await assert.rejects(mismatch.acquire(ref),/reserved/);assert.equal(wrong.closed,1);assert.equal(mismatch.stats().decodedBytes,0);mismatch.dispose();
});
test('closing rejects queued callers and closes an abandoned active decode exactly once',async()=>{
 const work=deferred(),pictures=new CameraPictures({decode:()=>work.promise}),ref=pictureRef(png()),a=pictures.acquire(ref),b=pictures.acquire(pictureRef(png()));pictures.dispose();await assert.rejects(a,{name:'AbortError'});await assert.rejects(b,{name:'AbortError'});const image=bitmap(ref);work.resolve(image);await tick();assert.equal(image.closed,1);assert.equal(pictures.stats().pending,0);assert.equal(pictures.stats().decodedBytes,0);
});
