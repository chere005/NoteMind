const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{atomic}=require('../src/notes-store.cjs');
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-store-durable-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
test('atomic library publication syncs its inode before rename and new directory hierarchy before ACK',async t=>{
 const directory=await fixture(t),file=path.join(directory,'new','nested','index.json'),events=[],open=fs.open,rename=fs.rename;
 t.mock.method(fs,'open',async(name,...args)=>{const handle=await open(name,...args);return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{events.push(['sync',name]);return target.sync();};const value=target[key];return typeof value==='function'?value.bind(target):value;}});});
 t.mock.method(fs,'rename',async(from,to)=>{events.push(['rename',to]);return rename(from,to);});await atomic(file,'complete');
 const publish=events.findIndex(event=>event[0]==='rename');assert.ok(publish>0);assert.ok(events.slice(0,publish).some(event=>event[0]==='sync'&&event[1].startsWith(file+'.')));assert.deepEqual(events.slice(publish+1).map(event=>event[1]),[path.dirname(file),path.dirname(path.dirname(file)),directory]);assert.equal(await fs.readFile(file,'utf8'),'complete');
});
test('failed inode sync preserves the previous library and cleans the unpublished temporary file',async t=>{
 const directory=await fixture(t),file=path.join(directory,'index.json');await fs.writeFile(file,'previous');const open=fs.open;
 t.mock.method(fs,'open',async(name,...args)=>{const handle=await open(name,...args);return new Proxy(handle,{get(target,key){if(key==='sync'&&name.startsWith(file+'.'))return async()=>{throw Error('Injected inode sync failure');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});});
 await assert.rejects(atomic(file,'new'),/inode sync/);assert.equal(await fs.readFile(file,'utf8'),'previous');assert.deepEqual(await fs.readdir(directory),['index.json']);
});
test('failed directory sync reports publication without an ACK and a retry confirms the exact new file',async t=>{
 const directory=await fixture(t),file=path.join(directory,'index.json'),open=fs.open;let fail=true;
 t.mock.method(fs,'open',async(name,...args)=>{const handle=await open(name,...args);return new Proxy(handle,{get(target,key){if(key==='sync'&&name===directory)return async()=>{if(fail)throw Error('Injected directory sync failure');return target.sync();};const value=target[key];return typeof value==='function'?value.bind(target):value;}});});
 await assert.rejects(atomic(file,'new'),error=>error.notemindFileCommitted===true&&/directory sync/.test(error.message));assert.equal(await fs.readFile(file,'utf8'),'new');fail=false;await atomic(file,'new');assert.deepEqual(await fs.readdir(directory),['index.json']);
});
