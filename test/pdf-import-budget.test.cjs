const {test}=require('node:test'),assert=require('node:assert/strict'),{utf8Bytes,spliceBytes}=require('../src/pdf-import-budget.cjs');
const turn=()=>new Promise(setImmediate),expected=value=>Buffer.byteLength(value,'utf8');
test('bounded UTF8 counting matches exact encoding for Unicode, paired and lone surrogates across every scheduler boundary',async()=>{
 const corpus=['','ASCII\0\r\n','中文 Ω','A😀B','\ud800','\udc00','\ud800\ud800\udc00\udc00','x\ud800z\udc00y','_\\*😀\r\n'].concat(Array.from({length:40},(_,i)=>String.fromCharCode(0xd7f0+i)+String.fromCharCode(0xdbf0+i)));
 for(const value of corpus)for(const chunkUnits of [1,2,3,7,65536])assert.equal(await utf8Bytes(value,{yieldTask:turn,chunkUnits}),expected(value));
});
test('splice byte changes include surrogate pairing across removed and inserted boundaries without counting the whole note',async()=>{
 const corpus=['a😀b','\ud800X\udc00','\ud800\udc00😀','ASCII','中文'];for(const text of corpus)for(let start=0;start<=text.length;start++)for(let end=start;end<=text.length;end++)for(const insert of ['','x','😀','\ud800','\udc00'])assert.equal(await spliceBytes(text,start,end,insert,{yieldTask:turn,chunkUnits:2}),expected(text.slice(0,start)+insert+text.slice(end))-expected(text));
});
test('large foreign edits count without an encoded allocation and cancel on the next bounded yield',async()=>{
 const value='😀中x'.repeat(70000);let yields=0;const controller=new AbortController();await assert.rejects(utf8Bytes(value,{signal:controller.signal,yieldTask:async()=>{yields++;controller.abort();}}),{name:'AbortError'});assert.equal(yields,1);assert.equal(await utf8Bytes(value,{yieldTask:turn}),expected(value));await assert.rejects(utf8Bytes(value,{signal:controller.signal}),{name:'AbortError'});
});
