const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
const output=buildSync({entryPoints:['src/tablet/renderer/tabletBackdrop.ts'],bundle:true,format:'cjs',platform:'browser',write:false}).outputFiles[0].text;
function cache(){const instances=[],timers=new Map();let nextTimer=1;class Image{constructor(){this.listeners=new Map();this.naturalWidth=0;this.naturalHeight=0;instances.push(this);}addEventListener(name,fn){this.listeners.set(name,fn);}removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name);}finish(w=100,h=100){this.naturalWidth=w;this.naturalHeight=h;this.complete=true;this.listeners.get('load')?.();}fail(){this.listeners.get('error')?.();}}const m={exports:{}};vm.runInNewContext(output,{module:m,exports:m.exports,Image,setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});return{...m.exports,instances,timers};}
test('decoded backdrop LRU is bounded by pixels and preserves images held by exports',async()=>{
 const c=cache(),first=c.backdropReady('first');c.instances[0].finish(3000,3000);const held=await first;assert.equal(c.backdropImage('first',()=>{}),held);
 const second=c.backdropReady('second');c.instances[1].finish(3000,3000);await second;assert.equal(held.naturalWidth,3000);assert.equal(held.src,'first');assert.equal(c.backdropImage('second',()=>{}),c.instances[1]);assert.equal(c.backdropImage('first',()=>{}),null);assert.equal(c.instances.length,3);c.instances[2].finish();
});
test('loads share waiters without recursive lookups and completion survives immediate eviction',async()=>{
 const c=cache();let painted=0;const waiter=c.backdropReady('huge');c.backdropImage('huge',()=>painted++);c.backdropImage('huge',()=>painted++);assert.equal(c.instances.length,1);c.instances[0].finish(10000,10000);assert.equal(await waiter,c.instances[0]);assert.equal(painted,2);assert.equal(c.instances.length,1);assert.equal(c.timers.size,0);assert.equal(c.backdropImage('huge',()=>{}),null);c.instances[1].finish();
});
test('parallel decodes and queued requests are bounded, errors and timeouts settle all callers',async()=>{
 const c=cache(),waiters=Array.from({length:33},(_,i)=>c.backdropReady('image-'+i));assert.equal(c.instances.length,4);assert.equal(await waiters[32],null);c.instances[0].fail();assert.equal(await waiters[0],null);assert.equal(c.instances.length,5);const timeout=c.timers.values().next().value;timeout();assert.equal(await waiters[1],null);assert.equal(c.instances[1].src,'');
 while(c.timers.size){const fn=c.timers.values().next().value;fn();}assert.ok((await Promise.all(waiters)).every(value=>value===null));assert.equal(c.timers.size,0);
});
test('entry count LRU touches the most recently used background',async()=>{
 const c=cache();for(let i=0;i<8;i++){const pending=c.backdropReady('image-'+i);c.instances[i].finish();await pending;}const recent=c.backdropImage('image-0',()=>{});const pending=c.backdropReady('ninth');c.instances[8].finish();await pending;assert.equal(c.backdropImage('image-0',()=>{}),recent);assert.equal(c.backdropImage('image-1',()=>{}),null);c.instances[9].finish();
});
