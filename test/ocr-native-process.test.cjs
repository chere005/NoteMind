// Protocol checks only: fake children and a tiny system-Node IPC echo, no ONNX.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{fork}=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const {NativeProcessWorker,privateInput,decodeInput}=require('./helpers/ocr-native-process.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const rgba=(id=1)=>({id,requestId:'request-'+id,japanese:true,ownedPixels:true,pixels:{width:2,height:2,data:Uint8Array.from({length:16},(_,i)=>i+id)}});
const png=(id=1,owned=true)=>({id,ownedPNG:owned,phaseAdmission:true,bytes:Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4])});
let nextPid=91000;
class FakeChild extends EventEmitter{
 constructor(options={}){super();this.pid=Object.hasOwn(options,'pid')?options.pid:++nextPid;this.stdout=new EventEmitter();this.stderr=new EventEmitter();this.messages=[];this.callbacks=[];this.signals=[];this.sendReturn=true;this.killReturn=true;}
 send(frame,callback){if(this.sendThrow)throw this.sendThrow;this.messages.push(frame);this.callbacks.push(callback);return this.sendReturn;}
 kill(signal){this.signals.push(signal);if(this.killThrow)throw this.killThrow;return this.killReturn;}
 flush(error=null){const callback=this.callbacks.shift();assert.equal(typeof callback,'function');callback(error);}
 exit(code=0,signal=null){this.emit('exit',code,signal);}
}
function setup(t,options={}){
 const child=options.child||new FakeChild(),calls=[],errors=[],exits=[],messages=[],phases=[];
 const worker=new NativeProcessWorker({entry:'/test-only/process-entry.cjs',receiptFile:'/test-only/receipt.json',workerData:{folder:'/test-only/models',threads:2},startupMs:60000,killMs:60000,...options,spawn:(...args)=>{calls.push(args);return child;}});
 worker.on('error',error=>errors.push(error));worker.on('exit',code=>exits.push(code));worker.on('message',packet=>messages.push(packet));worker.on('native-phase',packet=>phases.push(packet));
 t.after(()=>{if(!worker.exited)child.exit(0);});
 return{worker,child,calls,errors,exits,messages,phases};
}
function ready(value){value.child.emit('message',{type:'ready',generation:value.worker.generation,workerSHA:'worker-authority'});}
function sendRGBA(value,id=1){const packet=rgba(id),backing=packet.pixels.data.buffer;value.worker.postMessage(packet,[backing]);assert.equal(backing.byteLength,0);return packet;}
function ack(value,changes={}){const ledger=value.worker.ledger;return{type:'received',generation:value.worker.generation,sequence:ledger.sequence,id:ledger.control.id,...ledger.input,exclusive:true,...changes};}
function result(value,packet={},changes={}){const ledger=value.worker.ledger;return{type:'result',generation:value.worker.generation,sequence:ledger.sequence,id:ledger.control.id,packet:{id:ledger.control.id,lines:[],pixelsReleased:true,...packet},...changes};}

test('private RGBA transfer is synchronous and retains only the exact raw backing',()=>{
 const packet=rgba(),view=packet.pixels.data,expected=Array.from(view),backing=view.buffer,input=privateInput(packet,[backing]);
 assert.equal(view.byteLength,0);assert.equal(backing.byteLength,0);assert.equal(input.buffer.byteLength,16);assert.equal(input.buffer instanceof ArrayBuffer,true);assert.equal('pixels' in input.control,false);assert.equal('data' in input,false);assert.deepEqual(Array.from(new Uint8Array(input.buffer)),expected);assert.equal(input.input.sha256,hash(Uint8Array.from(expected)));assert.equal(input.borrowed,false);
 input.buffer.transfer(0);
});
test('borrowed pooled PNG remains intact and transports an independent exact copy',()=>{
 const source=Buffer.allocUnsafe(40),borrowed=source.subarray(7,19);borrowed.set(png().bytes);const saved=Buffer.from(source),input=privateInput({id:1,bytes:borrowed});
 assert.deepEqual(source,saved);assert.equal(borrowed.byteLength,12);assert.equal(input.borrowed,true);assert.equal(input.buffer.byteLength,12);assert.equal(input.control.ownedPNG,false);new Uint8Array(input.buffer)[0]=0;assert.equal(borrowed[0],137);input.buffer.transfer(0);assert.deepEqual(source,saved);
 assert.throws(()=>privateInput({id:1,bytes:borrowed},[borrowed.buffer]),/Borrowed PNG/);assert.deepEqual(source,saved);
});
test('invalid private ownership is rejected before any sender detachment',()=>{
 for(const transfers of [()=>[],b=>[b,b],()=>[new ArrayBuffer(16)]]){const packet=rgba(),backing=packet.pixels.data.buffer;assert.throws(()=>privateInput(packet,transfers(backing)),/exclusive/);assert.equal(backing.byteLength,16);}
 const backing=new ArrayBuffer(24),packet=rgba();packet.pixels.data=new Uint8Array(backing,4,16);assert.throws(()=>privateInput(packet,[backing]),/exclusive/);assert.equal(backing.byteLength,24);
 const invalid=rgba();invalid.pixels.width=3;assert.throws(()=>privateInput(invalid,[invalid.pixels.data.buffer]),/RGBA/);assert.equal(invalid.pixels.data.byteLength,16);
 const shared=rgba();shared.pixels.data=new Uint8Array(new SharedArrayBuffer(16));assert.throws(()=>privateInput(shared,[shared.pixels.data.buffer]),/exclusive/);
});
test('receiver reconstructs exact RGBA ownership and ACK identity from raw ArrayBuffer',()=>{
 const packet=rgba(7),owned=privateInput(packet,[packet.pixels.data.buffer]),frame={type:'read',generation:'generation',sequence:2,...owned};
 const decoded=decodeInput(frame,'generation');assert.equal(decoded.packet.pixels.data.buffer,owned.buffer);assert.equal(decoded.packet.pixels.data.byteOffset,0);assert.equal(decoded.packet.pixels.data.byteLength,owned.buffer.byteLength);assert.equal(decoded.packet.requestId,'request-7');assert.deepEqual(decoded.ack,{type:'received',generation:'generation',sequence:2,id:7,...owned.input,exclusive:true});owned.buffer.transfer(0);
});
test('receiver rejects malformed/stale/hash-mismatched ownership before ACK',()=>{
 const packet=rgba(),owned=privateInput(packet,[packet.pixels.data.buffer]),frame={type:'read',generation:'generation',sequence:1,...owned};
 const bad=[{generation:'stale'},{sequence:0},{control:{...frame.control,id:0}},{buffer:new Uint8Array(16)},{buffer:new SharedArrayBuffer(16)},{input:{...frame.input,bytes:15}},{input:{...frame.input,sha256:'0'.repeat(64)}},{input:{...frame.input,width:3}},{control:{...frame.control,ownedPixels:false}},{input:{...frame.input,kind:'unknown'}}];
 for(const patch of bad)assert.throws(()=>decodeInput({...frame,...patch},'generation'));assert.equal(frame.buffer.byteLength,16);frame.buffer.transfer(0);
});
test('constructor pins binary IPC, exact threads and isolated Electron launch environment',t=>{
 const value=setup(t,{execPath:'/pinned/Electron',env:{EXAMPLE:'kept'},expectedWorkerSHA:'worker-authority'}),options=value.calls[0][2];
 assert.deepEqual(value.calls[0].slice(0,2),['/test-only/process-entry.cjs',['/test-only/receipt.json']]);assert.equal(options.execPath,'/pinned/Electron');assert.deepEqual(options.execArgv,[]);assert.equal(options.serialization,'advanced');assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(options.env.NOTEMIND_NATIVE_PROCESS_GENERATION,value.worker.generation);assert.deepEqual(JSON.parse(options.env.NOTEMIND_NATIVE_PROCESS_WORKER_DATA),{folder:'/test-only/models',threads:2});assert.equal(options.env.EXAMPLE,'kept');assert.deepEqual(options.stdio,['ignore','pipe','pipe','ipc']);assert.equal(value.worker.threadId,value.child.pid);
 assert.throws(()=>new NativeProcessWorker({workerData:{folder:'/test-only',threads:1},spawn:()=>{throw Error('must not spawn');}}),/two-thread/);
});
test('input waits for readiness and exact ACK rather than send callback or backpressure',async t=>{
 const value=setup(t);value.child.sendReturn=false;sendRGBA(value);const held=value.worker.ledger.buffer;assert.equal(value.child.messages.length,0);assert.equal(value.worker.snapshot().senderBytes,16);
 ready(value);assert.equal(value.child.messages.length,1);assert.equal(value.child.messages[0].buffer,held);assert.equal(value.child.messages[0].buffer instanceof ArrayBuffer,true);assert.equal(value.worker.transport.sent,1);value.child.flush();await tick();assert.equal(held.byteLength,16);assert.equal(value.child.messages.length,1);
 value.child.emit('message',ack(value));assert.equal(held.byteLength,0);assert.equal(value.worker.transport.received,1);value.child.emit('message',result(value));assert.equal(value.messages.length,1);assert.equal(value.worker.ledger,null);assert.equal(value.errors.length,0);
});
test('cancellation before readiness retains sender ownership until actual child exit',async t=>{
 const value=setup(t);sendRGBA(value);const held=value.worker.ledger.buffer,pending=value.worker.terminate();assert.equal(pending,value.worker.terminate());let settled=false;pending.then(()=>settled=true);await tick();assert.equal(settled,false);assert.equal(held.byteLength,16);assert.equal(value.worker.snapshot().transport.actualExit,false);assert.deepEqual(value.child.signals,['SIGTERM']);
 value.child.emit('close',null,'SIGTERM');await tick();assert.equal(settled,false);assert.equal(held.byteLength,16);ready(value);assert.equal(value.child.messages.length,0);
 value.child.exit(null,'SIGTERM');assert.equal(await pending,1);assert.equal(held.byteLength,0);assert.equal(value.worker.snapshot().transport.actualExit,true);assert.equal(value.worker.snapshot().transport.signal,'SIGTERM');assert.deepEqual(value.exits,[1]);value.child.exit(2);assert.deepEqual(value.exits,[1]);assert.throws(()=>value.worker.postMessage(rgba(2)),/stopping/);
});
test('missing readiness fails bounded startup without inventing actual exit',async t=>{
 const value=setup(t,{startupMs:5});sendRGBA(value);const held=value.worker.ledger.buffer;await new Promise(resolve=>setTimeout(resolve,15));assert.match(value.errors[0]?.message||'',/startup timed out/);assert.equal(value.worker.stopping,true);assert.equal(value.worker.exited,false);assert.equal(held.byteLength,16);value.child.exit(1);assert.equal(held.byteLength,0);
});
test('stale, duplicate, premature and malformed ACKs cannot release current backing',async t=>{
 const patches=[{generation:'stale'},{sequence:2},{id:2},{bytes:15},{sha256:'0'.repeat(64)},{width:1},{height:1},{kind:'png'},{exclusive:false}];
 for(const patch of patches){const value=setup(t);sendRGBA(value);ready(value);const held=value.worker.ledger.buffer;value.child.emit('message',ack(value,patch));await tick();assert.equal(value.worker.failed instanceof Error,true);assert.equal(held.byteLength,16);assert.equal(value.worker.transport.received,0);value.child.exit(1);assert.equal(held.byteLength,0);}
 const early=setup(t);sendRGBA(early);const held=early.worker.ledger.buffer;early.child.emit('message',ack(early));await tick();assert.equal(early.worker.ready,false);assert.equal(held.byteLength,16);assert.equal(early.worker.failed instanceof Error,true);
 const duplicate=setup(t);sendRGBA(duplicate);ready(duplicate);const receipt=ack(duplicate);duplicate.child.emit('message',receipt);duplicate.child.emit('message',receipt);await tick();assert.match(duplicate.errors[0]?.message||'',/ACK mismatch/);assert.equal(duplicate.worker.transport.received,1);
});
test('results before ACK or with a stale payload ID never reach TextReader',async t=>{
 for(const beforeACK of [true,false]){const value=setup(t);sendRGBA(value);ready(value);const held=value.worker.ledger.buffer;if(!beforeACK)value.child.emit('message',ack(value));value.child.emit('message',result(value,beforeACK?{}:{id:2}));await tick();assert.equal(value.messages.length,0);assert.equal(value.worker.failed instanceof Error,true);assert.equal(held.byteLength,beforeACK?16:0);}
});
test('PNG decoded/admit handshake preserves one wire and consumes admission once',t=>{
 const value=setup(t),packet=png(),original=packet.bytes.buffer;value.worker.postMessage(packet,[original]);ready(value);value.child.emit('message',ack(value));assert.throws(()=>value.worker.postMessage({id:1,admit:true}),/Stale/);
 value.child.emit('message',result(value,{phase:'decoded',encodedReleased:true,width:2,height:2}));assert.equal(value.messages.length,1);assert.throws(()=>value.worker.postMessage({id:2,admit:true}),/Stale/);value.worker.postMessage({id:1,admit:true});assert.deepEqual(value.child.messages[1],{type:'admit',generation:value.worker.generation,sequence:1,id:1});assert.equal(value.worker.transport.sent,1);assert.throws(()=>value.worker.postMessage({id:1,admit:true}),/Stale/);value.child.emit('message',result(value,{encodedReleased:true}));assert.equal(value.messages.length,2);assert.equal(value.worker.ledger,null);
});
test('unexpected or duplicate decoded phases and stale native markers are rejected',async t=>{
 const wrong=setup(t);sendRGBA(wrong);ready(wrong);wrong.child.emit('message',ack(wrong));wrong.child.emit('message',result(wrong,{phase:'decoded'}));await tick();assert.match(wrong.errors[0]?.message||'',/Unexpected OCR decoded/);assert.equal(wrong.messages.length,0);
 const duplicate=setup(t),packet=png();duplicate.worker.postMessage(packet,[packet.bytes.buffer]);ready(duplicate);duplicate.child.emit('message',ack(duplicate));const decoded=result(duplicate,{phase:'decoded',encodedReleased:true});duplicate.child.emit('message',decoded);duplicate.child.emit('message',decoded);await tick();assert.equal(duplicate.messages.length,1);assert.equal(duplicate.worker.failed instanceof Error,true);
 const phase=setup(t);sendRGBA(phase);ready(phase);phase.child.emit('message',{type:'native-phase',generation:phase.worker.generation,sequence:1,id:1,phase:'enter'});await tick();assert.equal(phase.phases.length,0);assert.match(phase.errors[0]?.message||'',/preceded ownership/);
 const stale=setup(t);sendRGBA(stale);ready(stale);stale.child.emit('message',ack(stale));stale.child.emit('message',{type:'native-phase',generation:stale.worker.generation,sequence:2,id:1,phase:'enter'});await tick();assert.equal(stale.phases.length,0);assert.match(stale.errors[0]?.message||'',/Stale/);
});
test('unexpected second jobs and duplicate/mismatched ready messages fail without detaching rejected input',async t=>{
 const value=setup(t);sendRGBA(value);const rejected=rgba(2);assert.throws(()=>value.worker.postMessage(rejected,[rejected.pixels.data.buffer]),/already owns/);assert.equal(rejected.pixels.data.byteLength,16);ready(value);ready(value);await tick();assert.equal(value.worker.failed instanceof Error,true);
 const mismatch=setup(t,{expectedWorkerSHA:'expected'});ready(mismatch);await tick();assert.equal(mismatch.worker.ready,false);assert.match(mismatch.errors[0]?.message||'',/mismatched/);
});
test('send failures retain pending input until actual exit and never retry a frame',async t=>{
 for(const synchronous of [true,false]){const value=setup(t);if(synchronous)value.child.sendThrow=Error('transport throw');sendRGBA(value);const held=value.worker.ledger.buffer;ready(value);if(!synchronous)value.child.flush(Error('transport callback'));await tick();assert.match(value.errors[0]?.message||'',/transport/);assert.equal(value.worker.exited,false);assert.equal(held.byteLength,16);assert.equal(value.worker.transport.sent,1);assert.equal(value.child.messages.length,synchronous?0:1);value.child.exit(1);assert.equal(held.byteLength,0);}
});
test('false or throwing kill cannot claim cleanup and escalation targets the captured child',async t=>{
 const value=setup(t,{killMs:5});value.child.killReturn=false;sendRGBA(value);const held=value.worker.ledger.buffer,pending=value.worker.terminate();let settled=false;pending.then(()=>settled=true);await new Promise(resolve=>setTimeout(resolve,15));assert.deepEqual(value.child.signals,['SIGTERM','SIGKILL']);assert.equal(settled,false);assert.equal(held.byteLength,16);assert.equal(value.worker.transport.actualExit,false);value.child.exit(null,'SIGKILL');await pending;assert.equal(held.byteLength,0);
 const throwing=setup(t);throwing.child.killThrow=Error('cannot signal');sendRGBA(throwing);const retained=throwing.worker.ledger.buffer;await assert.rejects(throwing.worker.terminate(),/cannot signal/);assert.equal(throwing.worker.transport.actualExit,false);assert.equal(retained.byteLength,16);assert.equal(throwing.worker.snapshot().transport.killError,'cannot signal');throwing.child.exit(1);assert.equal(retained.byteLength,0);
});
test('spawn error without a PID drains only after close and is distinguished from a live child error',async t=>{
 const absent=setup(t,{child:new FakeChild({pid:undefined})});absent.child.emit('error',Error('spawn denied'));await tick();assert.equal(absent.worker.exited,false);absent.child.emit('close');assert.equal(absent.worker.exited,true);assert.equal(absent.worker.transport.spawnNeverCreated,true);assert.deepEqual(absent.exits,[1]);
 const live=setup(t);sendRGBA(live);const held=live.worker.ledger.buffer;live.child.emit('error',Error('live pipe error'));live.child.emit('close');await tick();assert.equal(live.worker.exited,false);assert.equal(held.byteLength,16);live.child.exit(1);assert.equal(held.byteLength,0);
});
test('TextReader cancellation waits for the former child actual exit before pumping its replacement',async t=>{
 const {TextReader}=require('../src/ocr.cjs'),owned=[],reader=new TextReader({threads:2,workerFactory:(_file,{workerData})=>{const child=new FakeChild(),worker=new NativeProcessWorker({entry:'/test-only',receiptFile:'/test-only',workerData,spawn:()=>child,startupMs:60000,killMs:60000});owned.push({child,worker});return worker;}});
 t.after(async()=>{const pending=reader.dispose();for(const value of owned)if(!value.worker.exited)value.child.exit(0);await pending;});
 const abort=new AbortController(),one=rgba(),two=rgba(2),first=reader.readPixels(one.pixels,{id:'first',takeOwnership:true,signal:abort.signal}).then(()=>({resolved:true}),error=>({error}));
 const second=reader.readPixels(two.pixels,{id:'second',takeOwnership:true});abort.abort();assert.equal((await first).error.name,'AbortError');assert.equal(owned.length,1);assert.equal(owned[0].worker.exited,false);owned[0].child.emit('close');await tick();assert.equal(owned.length,1);owned[0].child.exit(null,'SIGTERM');assert.equal(owned.length,2);
 const current=owned[1];ready(current);current.child.emit('message',ack(current));current.child.emit('message',result(current,{lines:[]}));assert.equal((await second).text,'');assert.equal(reader.jobs.size,0);
});
test('system Node advanced IPC round-trips raw ArrayBuffer as exact exclusive receiver backing',async t=>{
 const packet=rgba(6),input=privateInput(packet,[packet.pixels.data.buffer]),frame={type:'read',generation:'system-node-only',sequence:1,...input};
 const child=fork(path.join(__dirname,'helpers/ocr-process-ipc-echo.cjs'),[],{execPath:process.execPath,execArgv:[],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc']});let actualExit=false;
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{actualExit=true;resolve({code,signal});});});t.after(async()=>{if(!actualExit)child.kill('SIGKILL');await exited;});
 const reply=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('system Node IPC echo timed out')),5000);child.once('error',reject);child.once('message',value=>{clearTimeout(timer);resolve(value);});child.send(frame,error=>{if(error){clearTimeout(timer);reject(error);}});});
 assert.equal(packet.pixels.data.byteLength,0);assert.equal(input.buffer.byteLength,16);assert.equal(reply.nodeOnly,true);assert.equal(reply.electron,false);assert.equal(reply.error,undefined);assert.equal(reply.byteOffset,0);assert.equal(reply.byteLength,16);assert.equal(reply.backingLength,16);assert.deepEqual(reply.ack,{type:'received',generation:frame.generation,sequence:1,id:6,...input.input,exclusive:true});input.buffer.transfer(0);assert.deepEqual(await exited,{code:0,signal:null});assert.equal(actualExit,true);
});
