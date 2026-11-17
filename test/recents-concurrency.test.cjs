const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),recents=require('../src/recents.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-recents-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,file:path.join(root,'recent.json')};}
test('independent recent-file instances preserve concurrent updates and leave no shared temporary files',async t=>{
 const {root,file}=await fixture(t),first=recents(file),second=recents(file),seen=[];first.onChange(value=>seen.push(value));
 await Promise.all(Array.from({length:10},(_,i)=>(i%2?first:second).remember(path.join(root,'note-'+i+'.nm'))));
 const result=await first.read();assert.equal(result.files.length,10);assert.equal(new Set(result.files.map(row=>row.path)).size,10);assert.equal(seen.length,5);assert.deepEqual(await fs.readdir(root),['recent.json']);
});
test('an abandoned owner lock is recovered without discarding existing recents',async t=>{
 const {root,file}=await fixture(t),store=recents(file);await store.remember(path.join(root,'before.nm'));await fs.writeFile(file+'.lock',JSON.stringify({pid:2147483647}));await store.remember(path.join(root,'after.nm'));assert.deepEqual((await store.read()).files.map(row=>path.basename(row.path)),['after.nm','before.nm']);
});
test('a live owner is never evicted because its lock timestamp is old',async t=>{
 const {root,file}=await fixture(t),store=recents(file);await fs.writeFile(file+'.lock',JSON.stringify({pid:process.pid}));const old=new Date(Date.now()-3600000);await fs.utimes(file+'.lock',old,old);
 let complete=false;const pending=store.remember(path.join(root,'new.nm')).then(()=>{complete=true;});await new Promise(resolve=>setTimeout(resolve,70));assert.equal(complete,false);await fs.unlink(file+'.lock');await pending;assert.equal((await store.read()).files.length,1);
});
