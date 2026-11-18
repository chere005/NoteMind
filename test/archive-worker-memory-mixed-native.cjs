// Test-only isolate attribution around unchanged archive worker source.
require('./disable-native-pen.cjs');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto'),{Worker}=require('node:worker_threads');
const variant=process.env.NOTEMIND_PERF_VARIANT||'archive-worker-memory',target=path.resolve('test-results/performance-0.37','real-raster-'+variant+'.json'),nonce=crypto.randomUUID(),workers=[],seen=new WeakSet(),load=Module._load;
const sourceHash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
Module._load=function(name,parent,isMain){const value=load.call(this,name,parent,isMain);
 if(name==='./archive-codec.cjs'&&value?.workerFactory&&!seen.has(value)){seen.add(value);value.workerFactory=file=>{
  const row={file,sourceSHA:sourceHash(file),samples:[],actualExit:false};workers.push(row);
  const code='const {parentPort}=require("node:worker_threads"),v8=require("node:v8");const clock=setInterval(()=>parentPort.postMessage({__notemindHeapProbe:'+JSON.stringify(nonce)+',memory:process.memoryUsage(),heap:v8.getHeapStatistics(),spaces:v8.getHeapSpaceStatistics()}),250);clock.unref();require('+JSON.stringify(file)+');';
  const worker=new Worker(code,{eval:true});row.threadId=worker.threadId;worker.on('message',packet=>{if(packet?.__notemindHeapProbe===nonce&&row.samples.length<1024)row.samples.push({at:performance.now(),memory:packet.memory,heap:packet.heap,spaces:packet.spaces});});worker.once('exit',code=>{row.actualExit=true;row.exitCode=code;});return worker;
 };}return value;
};
const write=fs.writeFileSync;fs.writeFileSync=function(file,data,...args){if(path.resolve(String(file))===target){const report=JSON.parse(data);report.archiveWorkerHeapProbe={scope:'Test-only actual archive isolate heap/external attribution; no forceGC, limits or source algorithm changes',source:__filename,sourceSHA:sourceHash(__filename),workers};data=JSON.stringify(report,null,2);}return write.call(this,file,data,...args);};
require('./real-raster-index-completion.cjs');
