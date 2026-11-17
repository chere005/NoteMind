const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),raw=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function load(file,io){const module={exports:{}},relative=createRequire(require.resolve(file));vm.runInNewContext(raw.readFileSync(require.resolve(file),'utf8'),{module,exports:module.exports,process,Buffer,setTimeout,clearTimeout,require:name=>name==='node:fs/promises'?io:name==='./native-file-lock.cjs'?{runWithNativeLock:(_file,run)=>run()}:relative(name)});return module.exports;}
async function fixture(t,kind,io=fs){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-lock-ownership-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'library'));if(kind==='file'){const api=load('../src/guarded-write.cjs',io),file=path.join(root,'note.nm');return {lock:file+'.notemind-lock',run:(_,fn)=>api.withFileLock(file,fn)};}const {NotesStore}=load('../src/notes-store.cjs',io),stores=[new NotesStore(path.join(root,'library')),new NotesStore(path.join(root,'library'))];return {lock:path.join(root,'library','.lock'),run:(slot,fn)=>stores[slot].transaction(fn)};}

for(const kind of ['file','library']){
 test(kind+' stale owner reads cannot remove a newer live lock',async t=>{
  let lock,readCount=0,allRead,firstAcquired,releaseFirst,acquired=0,active=0,overlap=false;
  const readsGate=new Promise(resolve=>allRead=resolve),acquiredGate=new Promise(resolve=>firstAcquired=resolve),runGate=new Promise(resolve=>releaseFirst=resolve);
  const io={...fs,readFile:async(file,...args)=>{const value=await fs.readFile(file,...args);if(file===lock&&readCount<2){const n=++readCount;if(n===2)allRead();if(n===1)await readsGate;else await acquiredGate;}return value;},link:async(from,to)=>{await fs.link(from,to);if(to===lock&&++acquired===1)firstAcquired();}};
  const f=await fixture(t,kind,io);lock=f.lock;await fs.writeFile(lock,JSON.stringify({pid:2147483647}));
  const run=async()=>{active++;if(active>1)overlap=true;if(acquired===1)await runGate;active--;};const first=f.run(0,run),second=f.run(1,run);
  try{await acquiredGate;await pause(100);assert.equal(overlap,false);assert.equal(acquired,1);releaseFirst();await Promise.all([first,second]);assert.equal(acquired,2);assert.equal(overlap,false);}finally{allRead();firstAcquired();releaseFirst();await Promise.allSettled([first,second]);}
 });

 test(kind+' lock release preserves another owner\'s replacement',async t=>{
  const f=await fixture(t,kind);let replacement;
  await f.run(0,async()=>{await fs.unlink(f.lock);await fs.writeFile(f.lock,JSON.stringify({pid:process.pid,replacement:true}));replacement=await fs.stat(f.lock);});
  const current=await fs.stat(f.lock);assert.equal(current.ino,replacement.ino);assert.equal(current.dev,replacement.dev);assert.equal(JSON.parse(await fs.readFile(f.lock,'utf8')).replacement,true);
 });

 test(kind+' live owners are not evicted when their lock timestamp is old',async t=>{
  const f=await fixture(t,kind);await fs.writeFile(f.lock,JSON.stringify({pid:process.pid}));const old=new Date(Date.now()-3600000);await fs.utimes(f.lock,old,old);let entered=false;const pending=f.run(0,async()=>{entered=true;});
  try{await pause(80);assert.equal(entered,false);}finally{await fs.unlink(f.lock).catch(()=>{});await pending;}
  assert.equal(entered,true);
 });
}
