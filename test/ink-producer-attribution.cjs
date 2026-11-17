const attributionFailure={passed:false,phase:'attribution-bootstrap',pid:process.pid};require('./native-failure-exit.cjs').installNativeFailureExit({app:require('electron').app,report:'test-results/performance/ink-attribution-fatal-'+process.pid+'.json',telemetry:attributionFailure});
// Manual producer probe with observation-only worker source instrumentation.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const originalLoad=Module._load,electron=originalLoad('electron',module,false),esbuild=originalLoad('esbuild',module,false);
const sessions=new Map();let observedWindow=null;
class AttributedWindow extends electron.BrowserWindow{
 constructor(...args){
  super(...args);observedWindow=this;this.webContents.debugger.attach('1.3');
  this.webContents.debugger.on('message',(_event,method,params)=>{
   if(method==='Target.attachedToTarget')sessions.set(params.sessionId,{sessionId:params.sessionId,...params.targetInfo});
   if(method==='Target.detachedFromTarget')sessions.delete(params.sessionId);
  });
  void this.webContents.debugger.sendCommand('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
 }
}
async function heaps(){
 const result={workers:[]};if(!observedWindow||observedWindow.isDestroyed())return result;
 try{result.renderer=await observedWindow.webContents.debugger.sendCommand('Runtime.getHeapUsage')}catch(error){result.error=String(error)}
 for(const worker of sessions.values())try{result.workers.push({...worker,heap:await observedWindow.webContents.debugger.sendCommand('Runtime.getHeapUsage',{},worker.sessionId)})}catch(error){result.workers.push({...worker,error:String(error)})}
 return result;
}
const ipc=new Proxy(electron.ipcMain,{get(target,key){
 if(key!=='handle')return Reflect.get(target,key);
 return(channel,callback)=>target.handle(channel,channel==='fixture:phase'?async(event,name,stats)=>{
  if(stats)stats={...stats,attribution:await heaps()};return callback(event,name,stats);
 }:callback);
}});
const nativeElectron=new Proxy(electron,{get(target,key){if(key==='BrowserWindow')return AttributedWindow;if(key==='ipcMain')return ipc;return Reflect.get(target,key)}});
function copyWorkerSources(options){
 const directory=path.dirname(options.outfile),recordsFile=path.join(directory,'ink-records-observed.ts'),rasterFile=path.join(directory,'ink-raster-observed.ts');
 let records=fs.readFileSync('src/tablet/renderer/inkRecords.ts','utf8');
 for(const name of ['graphics-pane.js','binary-drawing.js','ink-identity.cjs','affine-ink-identity.cjs','ink-order.cjs'])records=records.replaceAll("'../../"+name+"'",JSON.stringify(path.resolve('src',name)));
 records="const memoryTrace=(name:string,stats:any={})=>(globalThis as any).__NoteMindInkStage?.(name,stats);\n"+records;
 records=records.replace('const parsed=await inspectBinaryDrawing(bytes,','memoryTrace(\'batch-start\',{binaryBytes:bytes.byteLength,identityBytes:rawIds?.byteLength||0});const parsed=await inspectBinaryDrawing(bytes,');
 records=records.replace("if(parsed.count!==idsView.byteLength/8)","memoryTrace('inspect-complete',{count:parsed.count,offsetScratch:parsed.offsets.byteLength});if(parsed.count!==idsView.byteLength/8)");
 records=records.replace('return batch',"memoryTrace('batch-complete',{count:batch.count,offsetBytes:batch.offsets?.byteLength||0,idBytes:batch.ids?.byteLength||0,boxBytes:batch.boxes?.byteLength||0,boxIndexBytes:(batch.boxBits?.byteLength||0)+(batch.boxRanks?.byteLength||0)});return batch");
 records=records.replace('added=addedBatch.ids?null:createAffineInkIdentity',"memoryTrace('identity-start',{rows:addedValues.length,stagingBytes:addedValues.byteLength});added=addedBatch.ids?null:createAffineInkIdentity");
 records=records.replace('added ||= await PersistentInkIdentity.build(rows(addedValues,next),{yieldControl:pause})',"added ||= await PersistentInkIdentity.build(rows(addedValues,next),{yieldControl:pause});memoryTrace('identity-complete',{rows:addedValues.length,...added.stats})");
 records=records.replace('next.order=await PersistentInkOrder.build(values,options())',"memoryTrace('order-start',{stagingBytes:values.byteLength,lookupBytes:next.lookup.stats.typedBytes});next.order=await PersistentInkOrder.build(values,options());memoryTrace('order-complete',{typedBytes:next.typedBytes})");
 fs.writeFileSync(recordsFile,records);
 let raster=fs.readFileSync('src/tablet/renderer/inkRaster.ts','utf8').replace("'../../graphics-pane.js'",JSON.stringify(path.resolve('src/graphics-pane.js'))).replace("'./tabletPaper'",JSON.stringify(path.resolve('src/tablet/renderer/tabletPaper.ts'))).replace("'./inkRecords'",JSON.stringify(recordsFile));fs.writeFileSync(rasterFile,raster);
 const source="self.__NoteMindInkStage=(name,stats)=>self.postMessage({__NoteMindInkStage:{name,stats}});\n"+options.stdin.contents.replace("'./tablet/renderer/inkRaster'",JSON.stringify(rasterFile));
 return{...options,stdin:{...options.stdin,contents:source}};
}
const tracedEsbuild=new Proxy(esbuild,{get(target,key){
 if(key!=='buildSync')return Reflect.get(target,key);
 return options=>{
  if(path.basename(options.outfile||'')==='drawing-worker.js')options=copyWorkerSources(options);
  else if(options.stdin?.contents?.includes('window.Perf='))options={...options,stdin:{...options.stdin,contents:options.stdin.contents+";const NativeWorker=Worker;globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',event=>{const trace=event.data?.__NoteMindInkStage;if(trace)void fixture.phase('worker-stage:'+trace.name,trace.stats)})}};"}};
  return target.buildSync(options);
 };
}});
Module._load=function(name,parent,isMain){if(name==='electron')return nativeElectron;if(name==='esbuild')return tracedEsbuild;return originalLoad.call(this,name,parent,isMain)};
process.env.NOTEMIND_PRODUCER_ATTEMPT||='worker-attribution';
require('./ink-producer-native.cjs');
