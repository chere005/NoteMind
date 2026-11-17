const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),zlib=require('node:zlib');
const {createRequire}=require('node:module'),{randomBytes,createHash}=require('node:crypto'),{markAsUntransferable,isMarkedAsUntransferable}=require('node:worker_threads');
const zip=require('../src/zip.cjs'),guard=require('../src/guarded-write.cjs'),sourceFile=require.resolve('../src/zip-stream.cjs'),relative=createRequire(sourceFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-zip-owned-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return{directory,file:path.join(directory,'Exact.docx')};}
async function instrument({borrowed=[],encoderFault=false,makeEncoder=options=>zlib.createDeflateRaw(options)}={}){
 const inputs=[],outputs=[],views=new Set();let active=0,maxActive=0,closed=false;
 const factory=options=>{
  const encoder=makeEncoder(options),write=encoder.write.bind(encoder),iterator=encoder[Symbol.asyncIterator].bind(encoder);
  encoder.once('close',()=>{closed=true;for(const record of outputs)if(!record.full)record.aliveAtClose=record.backing.byteLength>0;});
  encoder.write=(bytes,callback)=>{
   assert.equal(bytes.byteOffset,0);assert.equal(bytes.byteLength,bytes.buffer.byteLength);assert.ok(borrowed.every(value=>value.buffer!==bytes.buffer));
   const record={bytes,backing:bytes.buffer,length:bytes.byteLength};inputs.push(record);maxActive=Math.max(maxActive,++active);
   const result=write(bytes,error=>{assert.equal(bytes.byteLength,record.length,'native-owned input is intact at consumption callback');callback(error);active--;if(!error)assert.equal(bytes.byteLength,0,'private input retires at successful consumption callback');});
   if(encoderFault){encoderFault=false;encoder.destroy(Error('injected encoder failure'));}return result;
  };
  encoder[Symbol.asyncIterator]=()=>{const actual=iterator();return{[Symbol.asyncIterator](){return this;},async next(...args){const result=await actual.next(...args);if(!result.done){const bytes=result.value;views.add(bytes);outputs.push({bytes,backing:bytes.buffer,length:bytes.length,full:bytes.byteOffset===0&&bytes.length===bytes.buffer.byteLength});}return result;},return:(...args)=>actual.return(...args),throw:(...args)=>actual.throw(...args)};};
  return encoder;
 };
 const module={exports:{}};vm.runInNewContext(await fs.readFile(sourceFile,'utf8'),{module,Buffer,ArrayBuffer,Uint8Array,require:name=>name==='node:zlib'?{...zlib,createDeflateRaw:factory}:relative(name)},{filename:sourceFile});
 return{writer:module.exports.writeZipFile,inputs,outputs,views,get closed(){return closed;},get maxActive(){return maxActive;}};
}
function assertRetired(probe){assert.equal(probe.closed,true);assert.ok(probe.inputs.length);for(const input of probe.inputs)assert.equal(input.backing.byteLength,0);for(const output of probe.outputs)if(!isMarkedAsUntransferable(output.backing))assert.equal(output.backing.byteLength,0);}
function outputIO(probe,observe){return{...fs,open:async(...args)=>{const handle=await fs.open(...args);if(args[1]!=='wx')return handle;return{stat:(...args)=>handle.stat(...args),sync:()=>handle.sync(),close:()=>handle.close(),write:async(bytes,...args)=>{if(!probe.views.has(bytes))return handle.write(bytes,...args);const length=bytes.length;assert.ok(length);await observe?.(bytes);const answer=await handle.write(bytes,...args);await delay(1);assert.equal(bytes.length,length,'encoder output stays alive until the awaited file write completes');return answer;}};}};}
test('actual zlib input copies retire after consumption and output backing waits for the file write or actual close',async t=>{
 const h=await fixture(t),entropy=randomBytes(2*1024*1024+123),pooled=Buffer.from('small pooled borrowed tail'),marked=Uint8Array.from(randomBytes(70001));markAsUntransferable(marked.buffer);const chunks=[entropy,pooled,marked],expected=Buffer.concat(chunks),probe=await instrument({borrowed:chunks});
 const receipt=await probe.writer([{name:'word/document.xml',bytes:expected.length,sha256:hash(expected),source:async function*(){for(const chunk of chunks)yield chunk;}}],{file:h.file,expected:null},{fs:outputIO(probe)});
 assert.equal(probe.maxActive,1);assertRetired(probe);assert.ok(probe.outputs.some(value=>value.full));assert.ok(probe.outputs.some(value=>!value.full));for(const output of probe.outputs)if(output.aliveAtClose!==undefined)assert.equal(output.aliveAtClose,true,'partial native output remains alive through close');assert.deepEqual(Buffer.concat(chunks),expected);const bytes=await fs.readFile(h.file);assert.deepEqual(zip.unpack(bytes)['word/document.xml'],expected);assert.deepEqual({...receipt.revision},{bytes:bytes.length,sha256:hash(bytes)});
});
test('encoder, source, file-write and cancellation failures join real encoder close and asynchronous source return',async t=>{
 for(const mode of ['encoder','source','output','cancel']){
  const h=await fixture(t),data=randomBytes(128*1024),original=Buffer.from(data);await fs.writeFile(h.file,'previous');const expected=await guard.fingerprintFile(h.file),probe=await instrument({borrowed:[data],encoderFault:mode==='encoder'});let canceled=false,returned=false,failed=false;
  const source=async function*(){try{yield data;if(mode==='source')throw Error('injected source failure');await delay(5);yield data;}finally{await delay(15);returned=true;}};
  const io=outputIO(probe,async()=>{if(!failed){failed=true;if(mode==='output')throw Error('injected output failure');if(mode==='cancel')canceled=true;}});
  await assert.rejects(probe.writer([{name:'xml',bytes:data.length*2,source}],{file:h.file,expected,check:()=>{if(canceled)throw Object.assign(Error('injected cancellation'),{name:'AbortError'});}},{fs:io}),/injected/);
  assertRetired(probe);assert.equal(returned,true);assert.deepEqual(data,original);assert.equal(await fs.readFile(h.file,'utf8'),'previous');assert.deepEqual(await fs.readdir(h.directory),['Exact.docx']);
 }
});

test('an unacknowledged failed input stays alive until asynchronous encoder close completes',async t=>{
 const {Transform}=require('node:stream'),h=await fixture(t),data=Buffer.alloc(65536,37);let consumed,closing=false,returned=false;
 const probe=await instrument({borrowed:[data],makeEncoder:()=>new Transform({transform(bytes,_encoding,_callback){consumed=bytes;setTimeout(()=>this.emit('error',Error('delayed codec failure')),0);},destroy(error,callback){closing=true;setTimeout(()=>{assert.ok(consumed.byteLength,'unacknowledged native input must survive pending close');callback(error);},30);}})});
 const source=async function*(){try{yield data;}finally{await delay(10);returned=true;}};
 const pending=probe.writer([{name:'xml',bytes:data.length,source}],{file:h.file,expected:null});await assert.rejects(pending,/delayed codec failure/);assert.equal(closing,true);assert.equal(returned,true);assertRetired(probe);assert.equal(data.byteLength,65536);assert.deepEqual(await fs.readdir(h.directory),[]);
});
