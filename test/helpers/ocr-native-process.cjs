// Test-only process-contained OCR transport. This module never loads a binding.
const {EventEmitter}=require('node:events'),{fork}=require('node:child_process'),crypto=require('node:crypto');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const png=bytes=>bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
function privateInput(packet,transferList){
 if(!Number.isSafeInteger(packet?.id)||packet.id<1||packet.admit)throw Error('Invalid OCR input wire ID.');
 const pixels=packet.pixels,bytes=pixels?.data||packet.bytes,owned=pixels?packet.ownedPixels===true:packet.ownedPNG===true;
 if(!(bytes instanceof Uint8Array))throw Error('OCR transport needs binary input.');
 if(pixels){if(!owned||!Number.isSafeInteger(pixels.width)||pixels.width<1||pixels.width>32768||!Number.isSafeInteger(pixels.height)||pixels.height<1||pixels.height>32768||pixels.width*pixels.height>16000000||bytes.byteLength!==pixels.width*pixels.height*4)throw Error('Invalid exact OCR RGBA input.');}
 else if(bytes.byteLength>40*1024*1024||!png(bytes))throw Error('Invalid OCR PNG transport input.');
 if(owned&&(!Array.isArray(transferList)||transferList.length!==1||transferList[0]!==bytes.buffer||!(bytes.buffer instanceof ArrayBuffer)||bytes.byteOffset||bytes.byteLength!==bytes.buffer.byteLength))throw Error('OCR private transport requires exclusive backing transfer.');
 if(!owned&&transferList?.length)throw Error('Borrowed PNG must not be transferred.');
 const count=bytes.byteLength,sha256=digest(bytes),buffer=owned?structuredClone(bytes.buffer,{transfer:transferList}):Uint8Array.from(bytes).buffer;
 const control={id:packet.id,requestId:packet.requestId,japanese:packet.japanese,...(pixels?{ownedPixels:true}:{ownedPNG:owned,phaseAdmission:!!packet.phaseAdmission})};
 return{buffer,input:{kind:pixels?'rgba':'png',bytes:count,sha256,...(pixels?{width:pixels.width,height:pixels.height}:{})},control,borrowed:!owned};
}
function decodeInput(frame,generation){
 if(frame?.type!=='read'||frame.generation!==generation||!Number.isSafeInteger(frame.sequence)||frame.sequence<1||!Number.isSafeInteger(frame.control?.id)||frame.control.id<1||!(frame.buffer instanceof ArrayBuffer)||frame.buffer.byteLength!==frame.input?.bytes)throw Error('Invalid OCR process frame.');
 const input=frame.input,bytes=new Uint8Array(frame.buffer),control=frame.control;
 if(input.kind==='rgba'){if(control.ownedPixels!==true||!Number.isSafeInteger(input.width)||input.width<1||input.width>32768||!Number.isSafeInteger(input.height)||input.height<1||input.height>32768||input.width*input.height>16000000||bytes.byteLength!==input.width*input.height*4)throw Error('Invalid received exact RGBA backing.');}
 else if(input.kind!=='png'||bytes.byteLength>40*1024*1024||!png(bytes)||typeof control.ownedPNG!=='boolean')throw Error('Invalid received PNG backing.');
 if(digest(bytes)!==input.sha256)throw Error('OCR process input SHA mismatch.');
 return{packet:{...control,...(input.kind==='rgba'?{pixels:{width:input.width,height:input.height,data:bytes}}:{bytes})},ack:{type:'received',generation,sequence:frame.sequence,id:control.id,...input,exclusive:true}};
}
class NativeProcessWorker extends EventEmitter{
 constructor({entry,receiptFile,workerData,spawn=fork,execPath=process.execPath,expectedWorkerSHA,phaseJournal,startupMs=30000,killMs=5000,env=process.env}={}){
  super();if(workerData?.threads!==2||typeof workerData.folder!=='string')throw Error('Native process preserves exact two-thread model configuration.');
  this.expectedWorkerSHA=expectedWorkerSHA;this.generation=crypto.randomBytes(16).toString('hex');this.sequence=0;this.ledger=null;this.ready=false;this.stopping=false;this.exited=false;this.stderr='';this.transport={received:0,sent:0,peakSenderBytes:0,actualExit:false};
  this.exitPromise=new Promise(resolve=>this.resolveExit=resolve);
  this.child=spawn(entry,[receiptFile],{execPath,execArgv:[],serialization:'advanced',env:{...env,ELECTRON_RUN_AS_NODE:'1',NOTEMIND_NATIVE_PROCESS_GENERATION:this.generation,NOTEMIND_NATIVE_PROCESS_WORKER_DATA:JSON.stringify(workerData),...(phaseJournal?{NOTEMIND_NATIVE_PROCESS_PHASE_JOURNAL:phaseJournal}:{})},stdio:['ignore','pipe','pipe','ipc']});this.threadId=this.child.pid;this.pid=this.child.pid;
  this.child.stdout?.on('data',()=>{});this.child.stderr?.on('data',bytes=>{this.stderr=(this.stderr+bytes.toString()).slice(-8192);});
  this.child.on('message',message=>this.receive(message));this.child.once('error',error=>{this.spawnError=error;this.fail(error);});this.child.once('exit',(code,signal)=>this.actualExit(code,signal));this.child.once('close',()=>{if(!this.pid&&this.spawnError&&!this.exited){this.transport.spawnNeverCreated=true;this.actualExit(1,null);}});
  this.startupTimer=setTimeout(()=>this.fail(Error('OCR process startup timed out.')),startupMs);this.startupTimer.unref?.();this.killMs=killMs;
 }
 fail(error){if(this.exited||this.failed)return;this.failed=error;queueMicrotask(()=>{if(this.listenerCount('error'))this.emit('error',error);});void this.terminate().catch(()=>{});}
 send(frame){try{this.child.send(frame,error=>{if(error&&!this.stopping&&!this.exited)this.fail(error);});}catch(error){this.fail(error);}}
 postMessage(packet,transferList){
  if(this.stopping||this.exited)throw Error('OCR process is stopping.');
  if(packet?.admit){if(!this.ledger||!this.ledger.received||packet.id!==this.ledger.control.id||!this.ledger.decoded)throw Error('Stale OCR PNG admission.');this.ledger.decoded=false;this.send({type:'admit',generation:this.generation,sequence:this.ledger.sequence,id:packet.id});return;}
  if(this.ledger)throw Error('OCR process already owns an input.');
  const input=privateInput(packet,transferList);this.ledger={...input,sequence:++this.sequence,received:false};this.transport.peakSenderBytes=Math.max(this.transport.peakSenderBytes,input.buffer.byteLength);if(this.ready)this.sendInput();
 }
 sendInput(){if(!this.ledger||this.ledger.sent||this.stopping)return;this.ledger.sent=true;this.transport.sent++;const {buffer,input,control,sequence}=this.ledger;this.send({type:'read',generation:this.generation,sequence,input,control,buffer});}
 retireSender(){const ledger=this.ledger;if(ledger?.buffer?.byteLength)ledger.buffer.transfer(0);}
 receive(message){
  if(this.stopping||this.exited)return;
  if(message?.generation!==this.generation)return this.fail(Error('OCR process generation mismatch.'));
  if(message.type==='ready'){if(this.ready||this.expectedWorkerSHA&&message.workerSHA!==this.expectedWorkerSHA)return this.fail(Error('Duplicate or mismatched OCR process readiness.'));this.ready=true;this.transport.readyWorkerSHA=message.workerSHA;clearTimeout(this.startupTimer);this.emit('ready',message);this.sendInput();return;}
  if(message.type==='failure')return this.fail(Error(message.error||'OCR helper failed.'));
  const ledger=this.ledger;if(!ledger||message.sequence!==ledger.sequence||message.id!==ledger.control.id)return this.fail(Error('Stale OCR process reply.'));
  if(message.type==='native-phase'){if(!this.ready||!ledger.sent||!ledger.received)return this.fail(Error('Native phase preceded ownership ACK.'));this.emit('native-phase',message);return;}
  if(message.type==='received'){
   if(!this.ready||!ledger.sent||ledger.received||message.exclusive!==true||['kind','bytes','sha256','width','height'].some(key=>message[key]!==ledger.input[key]))return this.fail(Error('OCR process ownership ACK mismatch.'));
   ledger.received=true;this.transport.received++;this.retireSender();this.emit('received',{...message});return;
  }
  if(message.type!=='result'||!ledger.received||message.packet?.id!==ledger.control.id)return this.fail(Error('OCR process result preceded ownership ACK.'));
  if(message.packet.phase==='decoded'){if(!ledger.control.ownedPNG||!ledger.control.phaseAdmission||ledger.decodedSeen)return this.fail(Error('Unexpected OCR decoded phase.'));ledger.decoded=ledger.decodedSeen=true;}else this.ledger=null;
  this.emit('message',message.packet);
 }
 actualExit(code,signal){if(this.exited)return;this.exited=true;clearTimeout(this.startupTimer);clearTimeout(this.killTimer);this.retireSender();this.ledger=null;Object.assign(this.transport,{actualExit:true,exitCode:code,signal});this.emit('exit',code??1);this.resolveExit(code??1);}
 terminate(){
  if(this.exited)return this.exitPromise;if(this.stopping)return this.exitPromise;this.stopping=true;clearTimeout(this.startupTimer);
  this.killTimer=setTimeout(()=>{if(!this.exited)try{this.child.kill('SIGKILL');}catch(error){this.transport.killError=error.message;}},this.killMs);this.killTimer.unref?.();
  try{this.child.kill('SIGTERM');}catch(error){this.transport.killError=error.message;return Promise.reject(error);}return this.exitPromise;
 }
 snapshot(){return{pid:this.pid,generation:this.generation,ready:this.ready,stopping:this.stopping,senderBytes:this.ledger?.buffer?.byteLength||0,transport:{...this.transport},stderr:this.stderr};}
}
module.exports={NativeProcessWorker,privateInput,decodeInput};
