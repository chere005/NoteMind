const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const sourceRoot=process.env.NOTEMIND_INDEX_SCHEDULER_TEST_SOURCE_ROOT||path.resolve(__dirname,'../src'),{createIndexer}=require(path.join(sourceRoot,'index-images.cjs'));
const settle=async()=>{for(let count=0;count<40;count++)await Promise.resolve();};
async function fixture(t){
 let clock=0,reads=0,completed=false;const timers=[];
 const index=createIndexer({store:{ocrCache:async()=>({}),indexText:async()=>true},documentIO:{convertImageFile:async()=>({bytes:new Uint8Array([1,2,3])}),reader:{read:async()=>{reads++;return{text:'exact text'}},awaitStopped:async()=>{}}},send(){},storage:{},prepare:async()=>({rows:[{name:'assets/a.png',hash:'a',source:{file:'owned-fixture'},type:'image/png'}],cleanup:async()=>{}}),now:()=>clock,activityMs:1000,setTimer:(run,delay)=>{const timer={run,delay,cleared:false,unref(){}};timers.push(timer);return timer;},clearTimer:timer=>{if(timer)timer.cleared=true;}});
 t.after(()=>index.dispose());
 index.activity();const pending=index(null,{id:'deadline-fixture',assets:{'assets/a.png':'YWJj'}});pending.then(()=>{completed=true},()=>{});await settle();
 assert.equal(index.stats().queued,1);
 return{index,timers,pending,now:value=>{clock=value},reads:()=>reads,completed:()=>completed};
}
test('an early activity wake rearms the remaining deadline and dispatches one image read',async t=>{
 const f=await fixture(t);f.now(999);f.timers[0].run();await settle();assert.equal(f.reads(),0);assert.equal(f.completed(),false);assert.equal(f.timers.length,2);assert.equal(f.timers[1].delay,1);
 f.now(1000);f.timers[1].run();await settle();assert.equal(f.reads(),1);assert.equal(f.completed(),true);assert.deepEqual(await f.pending,{count:1,errors:[]});
});
test('an exact deadline wake dispatches without adding a retry timer',async t=>{
 const f=await fixture(t);f.now(1000);f.timers[0].run();await settle();assert.equal(f.reads(),1);assert.equal(f.timers.length,1);assert.equal(f.completed(),true);
});
test('repeated activity owns its new deadline and stale callbacks cannot erase that timer',async t=>{
 const f=await fixture(t);const old=f.timers[0];f.now(200);f.index.activity();const second=f.timers[1];assert.equal(old.cleared,true);
 f.now(999);old.run();await settle();f.now(1000);f.index.activity();assert.equal(second.cleared,true);assert.equal(f.reads(),0);
 f.now(2000);f.timers.at(-1).run();await settle();assert.equal(f.reads(),1);assert.equal(f.completed(),true);
});
test('a canceled old callback cannot wake work even after the current deadline expires',async t=>{
 const f=await fixture(t);const old=f.timers[0];f.now(200);f.index.activity();const current=f.timers[1];f.now(2000);old.run();await settle();assert.equal(f.reads(),0);assert.equal(f.completed(),false);
 current.run();await settle();assert.equal(f.reads(),1);assert.equal(f.completed(),true);
});
test('backward and repeated early clock observations retain a bounded positive wake',async t=>{
 const f=await fixture(t);f.now(-1000000);f.timers[0].run();await settle();assert.equal(f.timers[1].delay,1000);assert.equal(f.reads(),0);
 f.now(999);f.timers[1].run();await settle();assert.equal(f.timers[2].delay,1);f.now(1000);f.timers[2].run();await settle();assert.equal(f.reads(),1);assert.equal(f.completed(),true);
});
test('foreground work retains priority when the activity deadline expires',async t=>{
 const f=await fixture(t);let release;const gate=new Promise(resolve=>release=resolve),foreground=f.index.foreground(()=>gate);await settle();assert.equal(f.index.stats().foreground,1);
 f.now(1000);f.timers.at(-1).run();await settle();assert.equal(f.reads(),0);release();await foreground;await settle();assert.equal(f.reads(),1);assert.equal(f.completed(),true);
});
test('disposal cancels the current deadline and stale callbacks never restart the reader',async t=>{
 const f=await fixture(t);const current=f.timers[0];await f.index.dispose();await assert.rejects(f.pending,{name:'AbortError'});assert.equal(current.cleared,true);f.now(5000);current.run();f.index.activity();await settle();assert.equal(f.reads(),0);assert.equal(f.timers.length,1);assert.equal(f.index.stats().pending,0);
});
