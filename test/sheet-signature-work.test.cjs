const {test}=require('node:test'),assert=require('node:assert/strict'),{hashJsonAsync,hashTextAsync}=require('../src/sheet-signature-work.cjs'),{fingerprint,hashText}=require('../src/stroke-signature.js');
test('streamed JSON hashing matches native JSON semantics without normalizing imported field ordering',async()=>{
 const values=[null,true,false,0,-0,NaN,Infinity,'頁😀\ud800',[,undefined,()=>{},Symbol('x'),NaN],{b:2,a:1,missing:undefined,s:Symbol()},new Number(2),new String('x'),new Boolean(false),new Date('2026-01-01T00:00:00Z'),{toJSON(key){return{key,b:2,a:1}}},Object.assign(Object.create({ignored:1}),{'20':'twenty','3':'three',a:[{y:-0,x:.2}]})];
 for(const value of values)assert.equal(await hashJsonAsync(value),hashText(JSON.stringify(value)));
 for(let i=0;i<100;i++){const value={width:i/7,points:Array.from({length:i},(_,p)=>({y:Math.sin(p),x:p/97})),colorHex:'#12aBcD',pressures:Array.from({length:i},(_,p)=>p/(i||1))};assert.equal(await hashJsonAsync(value),fingerprint(value));}
 const cyclic={};cyclic.self=cyclic;await assert.rejects(hashJsonAsync(cyclic),/circular/);await assert.rejects(hashJsonAsync({value:1n}),/BigInt/);
});
test('large exact hashes yield, honor cancellation after a yield and propagate scheduler failures',async()=>{
 const value={points:Array.from({length:30000},(_,i)=>({x:i/30000,y:i/60000})),pressures:Array.from({length:30000},()=>.5)},controller=new AbortController();let pauses=0;
 assert.equal(await hashJsonAsync(value,{yieldControl:async()=>{pauses++}}),fingerprint(value));assert.ok(pauses>1);
 await assert.rejects(hashJsonAsync(value,{signal:controller.signal,yieldControl:async()=>controller.abort()}),{name:'AbortError'});
 await assert.rejects(hashJsonAsync(value,{yieldControl:async()=>{throw Error('scheduler failed')}}),/scheduler failed/);
 const text='x😀\ud800'.repeat(50000);pauses=0;assert.equal(await hashTextAsync(text,{yieldControl:async()=>{pauses++}}),hashText(text));assert.ok(pauses>1);
});
