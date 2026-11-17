const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),native=require('node:fs'),os=require('node:os'),path=require('node:path'),{readLimited}=require('../src/read-limited.cjs');
const CHUNK=64*1024,transferable=typeof ArrayBuffer.prototype.transfer==='function',realOpen=fs.open,realAllocate=Buffer.allocUnsafeSlow;
async function fixture(t,data=Buffer.alloc(CHUNK*2+7,23)){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-input-limit-')),file=path.join(root,'input');await fs.writeFile(file,data);t.after(()=>fs.rm(root,{recursive:true,force:true}));return{root,file,data};}
function opened(t,{read,stat,close,afterOpen}={}){
 const records=[];fs.open=async(...args)=>{const handle=await realOpen(...args),record={handle,closed:0,reads:[],stats:0};records.push(record);const wrapper={
  read:async(buffer,offset,length,position)=>{const entry={buffer,offset,length,position};record.reads.push(entry);const run=()=>handle.read(buffer,offset,length,position);return read?read(record,entry,run):run();},
  stat:async options=>{record.stats++;const run=()=>handle.stat(options);return stat?stat(record,run):run();},
  close:async()=>{record.closed++;const run=()=>handle.close();return close?close(record,run):run();}
 };await afterOpen?.(record);return wrapper;};t.after(()=>fs.open=realOpen);return records;
}
function allocations(t){const values=[];Buffer.allocUnsafeSlow=size=>{const bytes=realAllocate(size);values.push({size,bytes});return bytes;};t.after(()=>Buffer.allocUnsafeSlow=realAllocate);return values;}
const retired=values=>{if(transferable)for(const value of values)assert.equal(value.bytes.byteLength,0);};
test('oversized opened files reject before content allocation; exact limits and empty files return exact owned bytes',async t=>{
 const f=await fixture(t),records=opened(t),values=allocations(t);await assert.rejects(readLimited(f.file,1,'Too large'),/Too large/);assert.equal(values.length,0);assert.equal(records[0].closed,1);
 const result=await readLimited(f.file,f.data.length,'Too large');assert.deepEqual(result,f.data);assert.equal(result.byteOffset,0);assert.equal(result.byteLength,result.buffer.byteLength);assert.equal(records[1].closed,1);
 await fs.writeFile(f.file,Buffer.alloc(0));assert.equal((await readLimited(f.file,0,'Too large')).length,0);assert.equal(records[2].closed,1);
});
test('unchanged files fill one allocation directly in bounded asynchronous FD reads without stream or path-stat copies',async t=>{
 const f=await fixture(t,Buffer.alloc(CHUNK*5+13,37)),records=opened(t),values=allocations(t),stream=native.createReadStream,stat=fs.stat;native.createReadStream=()=>assert.fail('A stream must not allocate copying chunks');fs.stat=()=>assert.fail('The opened descriptor owns size checks');t.after(()=>{native.createReadStream=stream;fs.stat=stat;});
 let yielded=false;setImmediate(()=>yielded=true);const result=await readLimited(f.file,f.data.length,'Too large');assert.deepEqual(result,f.data);assert.equal(yielded,true);const buffers=values.filter(value=>value.size>1);assert.equal(buffers.length,1);assert.equal(buffers[0].bytes,result);assert.ok(records[0].reads.every(read=>read.length<=CHUNK));assert.ok(records[0].reads.filter(read=>read.length>1).every(read=>read.buffer===result));assert.equal(records[0].closed,1);retired(values.filter(value=>value.size===1));
});
test('pathname replacement cannot replace bytes from the already opened input',async t=>{
 const f=await fixture(t);let replaced=false;const records=opened(t,{read:async(_record,_entry,run)=>{const result=await run();if(!replaced){replaced=true;await fs.rename(f.file,f.file+'.original');await fs.writeFile(f.file,'foreign');}return result;}});assert.deepEqual(await readLimited(f.file,f.data.length,'Too large'),f.data);assert.equal(await fs.readFile(f.file,'utf8'),'foreign');assert.equal(records[0].closed,1);
});
test('growth within the limit preserves exact bytes and retires superseded growth and shrink allocations',async t=>{
 const f=await fixture(t,Buffer.alloc(CHUNK,11)),extra=Buffer.alloc(123,29);let grew=false;const records=opened(t,{read:async(_record,_entry,run)=>{const result=await run();if(!grew){grew=true;await fs.appendFile(f.file,extra);}return result;}}),values=allocations(t),result=await readLimited(f.file,CHUNK*3,'Too large');assert.deepEqual(result,Buffer.concat([f.data,extra]));assert.equal(result.byteLength,result.buffer.byteLength);assert.equal(records[0].closed,1);assert.ok(values.filter(value=>value.size>1).length>=3);retired(values.filter(value=>value.bytes!==result));
});
test('a one-byte EOF probe catches growth after the capacity stat and enforces the actual byte limit',async t=>{
 for(const allowed of [false,true]){const f=await fixture(t,Buffer.alloc(CHUNK,19)),records=opened(t,{stat:async(record,run)=>{const result=await run();if(record.stats===2)await fs.appendFile(f.file,Buffer.from([53]));return result;}}),values=allocations(t);if(allowed){const result=await readLimited(f.file,CHUNK+1,'Grew too large');assert.equal(result.length,CHUNK+1);assert.equal(result.at(-1),53);retired(values.filter(value=>value.bytes!==result));}else{await assert.rejects(readLimited(f.file,CHUNK,'Grew too large'),/Grew too large/);retired(values);}assert.equal(records[0].closed,1);}
});
test('growth above the cap rejects without allocating above the configured limit',async t=>{
 const f=await fixture(t,Buffer.alloc(CHUNK));let grew=false;const records=opened(t,{read:async(_record,_entry,run)=>{const result=await run();if(!grew){grew=true;await fs.appendFile(f.file,Buffer.alloc(CHUNK*2));}return result;}}),values=allocations(t);await assert.rejects(readLimited(f.file,CHUNK*2,'Grew too large'),/Grew too large/);assert.ok(values.every(value=>value.size<=CHUNK*2));retired(values);assert.equal(records[0].closed,1);
});
test('a shrinking file returns only read bytes and retires its oversized private allocation',async t=>{
 const f=await fixture(t),records=opened(t,{stat:async(record,run)=>{const result=await run();if(record.stats===1)await fs.truncate(f.file,17);return result;}}),values=allocations(t),result=await readLimited(f.file,f.data.length,'Too large');assert.deepEqual(result,f.data.subarray(0,17));assert.equal(result.buffer.byteLength,17);assert.equal(records[0].closed,1);retired(values.filter(value=>value.bytes!==result));
});
test('pre-aborted work opens nothing; aborts during open, reads, and final close discard private bytes and close once',async t=>{
 for(const phase of ['before','open','read','close']){const f=await fixture(t),controller=new AbortController(),records=opened(t,{afterOpen:()=>{if(phase==='open')controller.abort();},read:async(_record,_entry,run)=>{const value=await run();if(phase==='read')controller.abort();return value;},close:async(_record,run)=>{await run();if(phase==='close')controller.abort();}}),values=allocations(t);if(phase==='before')controller.abort();await assert.rejects(readLimited(f.file,f.data.length,'Too large',{signal:controller.signal}),{name:'AbortError'});assert.equal(records.length,phase==='before'?0:1);if(records.length)assert.equal(records[0].closed,1);retired(values);}
});
test('cancellation during growth copying discards both the old and candidate buffers',async t=>{
 const f=await fixture(t,Buffer.alloc(CHUNK)),controller=new AbortController();let grew=false;const records=opened(t,{read:async(_record,_entry,run)=>{const value=await run();if(!grew){grew=true;await fs.appendFile(f.file,Buffer.alloc(CHUNK));}return value;},stat:async(record,run)=>{const value=await run();if(record.stats===2)setImmediate(()=>controller.abort());return value;}}),values=allocations(t);await assert.rejects(readLimited(f.file,CHUNK*2,'Too large',{signal:controller.signal}),{name:'AbortError'});assert.ok(values.filter(value=>value.size>1).length>=2);retired(values);assert.equal(records[0].closed,1);
});
test('stat/read/close failures preserve their error, close the FD, and retire unreturned allocations',async t=>{
 for(const phase of ['stat','read','close']){const f=await fixture(t),error=Object.assign(Error(phase+' failed'),{code:'EIO'}),records=opened(t,{stat:(_record,run)=>phase==='stat'?Promise.reject(error):run(),read:(_record,_entry,run)=>phase==='read'?Promise.reject(error):run(),close:async(_record,run)=>{await run();if(phase==='close')throw error;}}),values=allocations(t);await assert.rejects(readLimited(f.file,f.data.length,'Too large'),value=>value===error);assert.equal(records[0].closed,1);retired(values);}
});
test('a false-valued abort reason still retires the private buffer and keeps its reason over a close failure',async t=>{
 const f=await fixture(t),controller=new AbortController(),records=opened(t,{read:async(_record,_entry,run)=>{const result=await run();controller.abort(0);return result;},close:async(_record,run)=>{await run();throw Error('Secondary close failure');}}),values=allocations(t);let rejected=false;await readLimited(f.file,f.data.length,'Too large',{signal:controller.signal}).then(()=>assert.fail('Canceled read published bytes'),reason=>{rejected=true;assert.equal(reason,0);});assert.equal(rejected,true);assert.equal(records[0].closed,1);retired(values);
});
