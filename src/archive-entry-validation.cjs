// Large, exclusively owned archive entries may carry 70 MiB of JSON metadata.
// Release that temporary parse heap before the persistent codec builds its next ZIP.
const {Worker,parentPort,workerData}=require('node:worker_threads');
const {validateEntry}=require('./archive-limits.cjs');
if(workerData?.archiveEntryValidation){
 parentPort.once('message',({name,bytes})=>{
  try{validateEntry(name,Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength));parentPort.postMessage({bytes,heapBytes:require('node:v8').getHeapStatistics().heap_size_limit,memory:process.memoryUsage()},[bytes.buffer]);}
  catch(error){parentPort.postMessage({error:{name:error.name,message:error.message}});}
  finally{parentPort.close();}
 });
}
let active=false;const stats={runs:0,heapBytes:0,maxRss:0,maxHeapUsed:0};
function validateOwnedEntry(name,bytes,{workerFactory=()=>new Worker(__filename,{workerData:{archiveEntryValidation:true}}),timeoutMs=30000,metadataThreshold=1024*1024}={}){
 const binary=/^assets\/.*\.json$/i.test(name)&&require('./graphics-pane.js').isBinary(bytes);
 if(!binary||bytes.length<24||bytes.readUInt32LE(8)<=metadataThreshold){validateEntry(name,bytes);return Promise.resolve(bytes);}
 if(bytes.byteOffset!==0||bytes.byteLength!==bytes.buffer.byteLength)throw Error('Archive validation requires an exclusively owned entry.');
 if(active)throw Error('Archive entry validation is already active.');active=true;const expectedLength=bytes.length;
 return new Promise((resolve,reject)=>{
  let worker,value,error,timer;const finish=code=>{clearTimeout(timer);active=false;if(error)reject(error);else if(code!==0||!value)reject(Error('Archive entry validation stopped before completion.'));else resolve(value);};
  try{
   worker=workerFactory();worker.once('message',packet=>{if(packet.error){error=Object.assign(Error(packet.error.message),{name:packet.error.name});return;}const bytes=packet.bytes;if(!(bytes instanceof Uint8Array)||bytes.byteOffset!==0||bytes.byteLength!==bytes.buffer.byteLength||bytes.byteLength!==expectedLength){error=Error('Invalid owned archive validation result.');return;}value=Buffer.from(bytes.buffer);stats.runs++;stats.heapBytes=packet.heapBytes;stats.maxRss=Math.max(stats.maxRss,packet.memory?.rss||0);stats.maxHeapUsed=Math.max(stats.maxHeapUsed,packet.memory?.heapUsed||0);});worker.once('error',value=>{error ||= value;});worker.once('exit',finish);
   timer=setTimeout(()=>{error ||= Error('Archive entry validation timed out.');Promise.resolve().then(()=>worker.terminate()).catch(value=>{error ||= value;});},timeoutMs);timer.unref?.();worker.postMessage({name,bytes:new Uint8Array(bytes.buffer)},[bytes.buffer]);
  }catch(value){error=value;if(worker){Promise.resolve().then(()=>worker.terminate()).catch(()=>{});}else finish(1);}
 });
}
module.exports={validateOwnedEntry,validationStats:()=>({...stats,active})};
