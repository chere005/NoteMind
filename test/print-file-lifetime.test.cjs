const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),{EventEmitter}=require('node:events');
const {PrintFileLeases}=require('../src/print-file-leases.cjs'),print=require('../src/print-asset-files.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve)),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};};
const owner=()=>Object.assign(new EventEmitter(),{isDestroyed:()=>false});
test('final print disposal joins pending creation and its cleanup and rejects later admission',async()=>{
 const creation=deferred(),cleanup=deferred();let removed=0,done=false;
 const leases=new PrintFileLeases({create:()=>creation.promise}),opening=leases.open(owner(),{}),rejected=assert.rejects(opening,/clos/);
 const closing=leases.dispose().then(()=>done=true);await tick();assert.equal(done,false);assert.equal(leases.pending,1);
 await assert.rejects(leases.open(owner(),{}),/clos/);creation.resolve({bytes:7,url:()=>'',release:async()=>{removed++;await cleanup.promise}});
 await tick();assert.equal(done,false);assert.equal(removed,1);assert.equal(leases.bytes,7);cleanup.resolve();await rejected;await closing;assert.equal(leases.pending,0);assert.equal(leases.entries.size,0);assert.equal(leases.bytes,0);
});
test('failed print removal retains its exact token and bytes until successful retry',async()=>{
 let attempts=0;const leases=new PrintFileLeases({create:async()=>({bytes:13,url:()=>'',release:async()=>{if(++attempts===1)throw Error('temporary cleanup failure')}})}),window=owner(),lease=await leases.open(window,{});
 await assert.rejects(leases.release(window,lease.token),/cleanup failure/);assert.equal(leases.entries.size,1);assert.equal(leases.bytes,13);await leases.release(window,lease.token);assert.equal(attempts,2);assert.equal(leases.entries.size,0);assert.equal(leases.bytes,0);await leases.dispose();
});
test('overlapping print release and final disposal share cleanup and preserve quota until its receipt',async()=>{
 const gate=deferred();let calls=0,done=false;const leases=new PrintFileLeases({create:async()=>({bytes:19,url:()=>'',release:async()=>{calls++;await gate.promise}})}),window=owner(),lease=await leases.open(window,{}),one=leases.release(window,lease.token),two=leases.dispose().then(()=>done=true);
 await tick();assert.equal(calls,1);assert.equal(done,false);assert.equal(leases.bytes,19);gate.resolve();await Promise.all([one,two]);assert.equal(leases.bytes,0);assert.equal(leases.entries.size,0);
});
test('print-file release joins concurrent removal and retries a transient filesystem failure',async()=>{
 let calls=0;const filesystem={...fs,rm:async(...args)=>{if(++calls===1)throw Error('transient remove failure');return fs.rm(...args)}},files=await print.createPrintFiles({text:'',assets:{}},{filesystem});
 await assert.rejects(files.release(),/transient remove/);assert.ok((await fs.stat(files.folder)).isDirectory());await Promise.all([files.release(),files.release()]);assert.equal(calls,2);await assert.rejects(fs.stat(files.folder),{code:'ENOENT'});
});
test('final print disposal waits for an active file-backed export consumer before retiring files',async()=>{
 const gate=deferred(),entered=deferred();let folder,done=false;const exporting=print.withPrintFiles({text:'',assets:{}},async files=>{folder=files.folder;entered.resolve();await gate.promise;assert.ok((await fs.stat(folder)).isDirectory());});await entered.promise;
 const leases=new PrintFileLeases(),closing=leases.dispose().then(()=>done=true);await tick();assert.equal(done,false);gate.resolve();await exporting;await closing;assert.equal(done,true);await assert.rejects(fs.stat(folder),{code:'ENOENT'});
});
test('owner cleanup failures are observed and keep the entry charged until automatic retry succeeds',async()=>{
 let attempts=0,allow=false;const leases=new PrintFileLeases({idleMs:10,create:async()=>({bytes:23,url:()=>'',release:async()=>{attempts++;if(!allow)throw Error('owner cleanup failed')}})}),window=owner();await leases.open(window,{});window.emit('destroyed');await tick();assert.equal(attempts,1);assert.equal(leases.entries.size,1);assert.equal(leases.bytes,23);allow=true;
 for(let n=0;n<30&&leases.entries.size;n++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(leases.entries.size,0);assert.equal(leases.bytes,0);await leases.dispose();
});
test('failed staging and failed removal retain private cleanup authority and quota for final retry',async()=>{
 let folder,blocked=true;const filesystem={...fs,mkdtemp:async prefix=>(folder=await fs.mkdtemp(prefix)),writeFile:async()=>{throw Error('staging write failed')},rm:async(...args)=>{if(blocked)throw Error('cleanup I/O failed');return fs.rm(...args)}},leases=new PrintFileLeases({create:doc=>print.createPrintFiles(doc,{filesystem})});
 await assert.rejects(leases.open(owner(),{text:'![Image](assets/a.png)',assets:{'assets/a.png':'AQID'}}),/cleanup/);assert.equal(leases.entries.size,1);assert.equal(leases.bytes,3);assert.equal(leases.pending,0);assert.ok((await fs.stat(folder)).isDirectory());
 await assert.rejects(leases.dispose(),/cleanup/);assert.equal(leases.entries.size,1);blocked=false;await leases.dispose();assert.equal(leases.entries.size,0);assert.equal(leases.bytes,0);await assert.rejects(fs.stat(folder),{code:'ENOENT'});
});
test('failed standalone staging cleanup remains reachable by final print disposal',async()=>{
 let folder,calls=0;const filesystem={...fs,mkdtemp:async prefix=>(folder=await fs.mkdtemp(prefix)),writeFile:async()=>{throw Error('write failed')},rm:async(...args)=>{if(++calls===1)throw Error('remove failed');return fs.rm(...args)}};
 await assert.rejects(print.withPrintFiles({text:'![Image](assets/a.png)',assets:{'assets/a.png':'AQID'}},()=>assert.fail('No failed staging consumer'),{filesystem}),/staged or removed/);assert.ok((await fs.stat(folder)).isDirectory());await new PrintFileLeases().dispose();assert.equal(calls,2);await assert.rejects(fs.stat(folder),{code:'ENOENT'});
});
