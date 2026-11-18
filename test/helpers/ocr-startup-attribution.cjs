const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{MessageChannel}=require('node:worker_threads'),{createHash}=require('node:crypto');
const KEY='__notemindOCRStartupDiagnostic',FIELD='__notemindOCRStartupDiagnosticPort';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function replaceOne(source,expression,replace,label){const matches=[...source.matchAll(expression)];if(matches.length!==1)throw Error('Compiled OCR diagnostic boundary changed: '+label+' ('+matches.length+')');return source.replace(expression,replace);}
function instrumentOCRSource(source){
 const ident='[A-Za-z_$][\\w$]*',boundaries={messageHandler:1,sessionCreate:1,detectorPreparation:1,detectorRun:1};let code=source;
 code=replaceOne(code,new RegExp('('+ident+'\\.on\\("message",async '+ident+'=>\\{)','g'),prefix=>prefix+'globalThis.'+KEY+'.firstJob();','job handler');
 code=replaceOne(code,new RegExp('await ('+ident+')\\.InferenceSession\\.create\\(('+ident+'),\\{graphOptimizationLevel:"all"\\}\\)','g'),(_,ort,bytes)=>'await globalThis.'+KEY+'.promise("session-create",()=>'+ort+'.InferenceSession.create('+bytes+',{graphOptimizationLevel:"all"}))','session create');
 code=replaceOne(code,new RegExp('('+ident+'\\('+ident+','+ident+','+ident+'\\.releaseOwnedData\\))(?=,'+ident+','+ident+','+ident+';try\\{'+ident+'='+ident+'\\.tensor\\()','g'),call=>'globalThis.'+KEY+'.sync("detector-preparation",()=>'+call+')','detector preparation');
 code=replaceOne(code,new RegExp('await ('+ident+')\\.det\\.run\\(\\{\\[\\1\\.det\\.inputNames\\[0\\]\\]:('+ident+')\\}\\)','g'),(_,engine,tensor)=>'await globalThis.'+KEY+'.promise("detector-run",()=>'+engine+'.det.run({['+engine+'.det.inputNames[0]]:'+tensor+'}))','detector run');
 return{code,boundaries,sourceSHA:hash(source),instrumentedSHA:hash(code)};
}

// Serialized into a test-only bootstrap, before the exact compiled worker is
// imported. Hooks return the original value/promise and never retain operands,
// tensors, lines or model bytes. All records contain numbers/short labels only.
function installStartupDiagnostic({fs,promises,path,parentPort,workerData,v8,key,field,maxRows}){
 const port=workerData[field],post=port.postMessage.bind(port);let count=0,dropped=0,sampler=null,sampleCount=0,finished=false,started=false;
 const emit=(label,extra={})=>{if(count>=maxRows){dropped++;return;}const m=process.memoryUsage(),h=v8.getHeapStatistics();post({kind:'ocr-startup',sequence:++count,label,at:performance.now(),rss:m.rss,heapTotal:m.heapTotal,heapUsed:m.heapUsed,external:m.external,arrayBuffers:m.arrayBuffers,heapLimit:h.heap_size_limit,...extra});};
 const promise=(label,run,extra={})=>{emit(label+':begin',extra);let result;try{result=run();}catch(error){emit(label+':throw',extra);throw error;}if(result&&typeof result.then==='function')void result.then(()=>emit(label+':end',extra),()=>emit(label+':reject',extra));else emit(label+':end',extra);return result;};
 const sync=(label,run)=>{emit(label+':begin');try{return run();}finally{emit(label+':end');}};
 const firstJob=()=>{if(started)return;started=true;emit('first-job');sampler=setInterval(()=>{if(++sampleCount>120){clearInterval(sampler);emit('sample-deadline');return;}emit('sample');},25);sampler.unref?.();};
 Object.defineProperty(globalThis,key,{value:Object.freeze({promise,sync,firstJob}),configurable:false});
 for(const name of['compile','compileStreaming','instantiate','instantiateStreaming']){const original=WebAssembly[name];if(typeof original!=='function')continue;WebAssembly[name]=function(...args){return promise('wasm-'+name,()=>Reflect.apply(original,this,args));};}
 const filename=value=>{try{return path.basename(value instanceof URL?value.pathname:String(value));}catch{return'';}};
 const watched=value=>/\.(onnx|wasm)$/.test(filename(value));
 for(const [owner,name]of[[fs,'readFileSync'],[promises,'readFile']]){const original=owner[name];owner[name]=function(...args){return watched(args[0])?promise('file-'+name,()=>Reflect.apply(original,this,args),{file:filename(args[0])}):Reflect.apply(original,this,args);};}
 const stop=()=>{if(finished)return;finished=true;clearInterval(sampler);emit('first-reply',{dropped});};
 const originalPost=parentPort.postMessage;parentPort.postMessage=function(packet,...rest){if(packet&&typeof packet.id==='number'&&(Array.isArray(packet.lines)||typeof packet.error==='string'))stop();return Reflect.apply(originalPost,this,[packet,...rest]);};
 emit('bootstrap');
 return{emit,stop};
}

function createOCRStartupAttribution({directory,phase=()=>null,maxRows=512,onRow=()=>{}}={}){
 if(typeof directory!=='string'||!Number.isSafeInteger(maxRows)||maxRows<16||maxRows>2048)throw Error('Invalid OCR startup diagnostic options.');
 const rows=[],workers=[],ports=new Set();let wrapped=false,dropped=0;
 function wrap(factory){return function(file,options={}){if(wrapped)return factory(file,options);wrapped=true;
  const original=fs.readFileSync(file,'utf8'),instrumented=instrumentOCRSource(original);fs.mkdirSync(directory,{recursive:true});const owned=fs.mkdtempSync(path.join(directory,'ocr-startup-')),copy=path.join(owned,'worker-instrumented.mjs'),entry=path.join(owned,'bootstrap.mjs'),channel=new MessageChannel();
  fs.writeFileSync(copy,instrumented.code,{flag:'wx'});
  const bootstrap='import fs,{promises} from "node:fs";import path from "node:path";import {parentPort,workerData} from "node:worker_threads";import v8 from "node:v8";\nconst diagnostic=('+installStartupDiagnostic.toString()+')({fs,promises,path,parentPort,workerData,v8,key:'+JSON.stringify(KEY)+',field:'+JSON.stringify(FIELD)+',maxRows:'+maxRows+'});\ndiagnostic.emit("module-import:begin");try{await import('+JSON.stringify(pathToFileURL(copy).href)+');diagnostic.emit("module-import:end");}catch(error){diagnostic.emit("module-import:reject");throw error;}\n';
  fs.writeFileSync(entry,bootstrap,{flag:'wx'});const receipt={original:path.resolve(file),entry,copy,sourceSHA:instrumented.sourceSHA,instrumentedSHA:instrumented.instrumentedSHA,bootstrapSHA:hash(bootstrap),boundaries:instrumented.boundaries,threadId:null,exited:false};workers.push(receipt);ports.add(channel.port1);
  channel.port1.on('message',row=>{if(!row||row.kind!=='ocr-startup')return;const label=typeof row.label==='string'?row.label.slice(0,80):null;if(!label)return;const current=phase(),scalar={phase:typeof current==='string'?current.slice(0,120):null,threadId:receipt.threadId,label};for(const name of['sequence','at','rss','heapTotal','heapUsed','external','arrayBuffers','heapLimit','dropped'])if(typeof row[name]==='number'&&Number.isFinite(row[name]))scalar[name]=row[name];if(typeof row.file==='string')scalar.file=row.file.slice(0,100);if(rows.length<maxRows){rows.push(scalar);onRow({...scalar});}else dropped++;});
  let worker;try{worker=factory(entry,{...options,workerData:{...options.workerData,[FIELD]:channel.port2},transferList:[...(options.transferList||[]),channel.port2]});}catch(error){channel.port1.close();channel.port2.close();ports.delete(channel.port1);throw error;}
  receipt.threadId=worker.threadId;worker.once('exit',code=>{receipt.exited=true;receipt.exitCode=code;channel.port1.close();ports.delete(channel.port1);});return worker;
 };}
 return{wrap,snapshot:()=>({scope:'Read-only scalar instrumentation; original compiled worker/model/math/source workload, diagnostic overhead is inside the unchanged guard. Not release acceptance.',maxRows,dropped,rows:rows.map(row=>({...row})),workers:workers.map(worker=>({...worker,boundaries:{...worker.boundaries}}))}),close:()=>{for(const port of ports)port.close();ports.clear();}};
}
function extendStartupDriver(code){
 const once=(needle,replacement)=>{if(code.indexOf(needle)<0||code.indexOf(needle)!==code.lastIndexOf(needle))throw Error('Mixed startup diagnostic boundary changed: '+needle);code=code.replace(needle,replacement);};
 once('const instrumentedCodecs=',`const startupDiagnostic=require('./helpers/ocr-startup-attribution.cjs').createOCRStartupAttribution({directory:path.join(profile,'startup-diagnostic'),phase:()=>currentPhase,onRow:row=>{if(!['sample','file-readFile:begin','file-readFile:end'].includes(row.label))console.log(JSON.stringify({kind:'ocr-startup-phase',...row}));}});const instrumentedCodecs=`);
 once('indexObserver.attach(this);','indexObserver.attach(this);this.workerFactory=startupDiagnostic.wrap(this.workerFactory);');
 once('report.ocrLifecycle=indexObserver.snapshot();','report.ocrLifecycle=indexObserver.snapshot();report.startupDiagnostic=startupDiagnostic.snapshot();');
 return code;
}
module.exports={instrumentOCRSource,installStartupDiagnostic,createOCRStartupAttribution,extendStartupDriver};
