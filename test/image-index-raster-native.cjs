// Small native oracle only: no App residency or worker-exit acceptance claim.
require('./disable-native-pen.cjs');
const{app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),v8=require('node:v8');
const root=path.resolve('src'),out=path.resolve('test-results/performance/image-index-raster-native.json'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-index-raster-parity-')),report={source:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),profile,scope:'small default-2d HTMLCanvas authority versus persistent OffscreenCanvas worker; not full App or thread-exit proof',memory:[],results:[],versions:process.versions,mainHeapLimit:v8.getHeapStatistics().heap_size_limit,limits:{combinedRSS:1024*1024*1024},files:{}};
fs.mkdirSync(path.dirname(out),{recursive:true});for(const file of['image-conversion-worker.html','image-conversion-worker.js','image-index-raster-worker.js','document-byte-tools.js'])report.files[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
app.setPath('userData',profile);app.dock?.hide();for(const flag of['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
require('./native-failure-exit.cjs').installNativeFailureExit({app,report:out,telemetry:report});
let win,timer,deadline,done=false;
function finish(error){if(done)return;done=true;clearInterval(timer);clearTimeout(deadline);report.ok=report.passed=!error;if(error)report.error=error.stack||String(error);report.finished=new Date().toISOString();fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,results:report.results.length,peak:Math.max(0,...report.memory.map(row=>row.total)),error:report.error,artifact:out}));app.exit(error?1:0);}
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:false,focusable:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'notemind-index-parity-'+crypto.randomUUID()}});
 win.webContents.on('console-message',(_,level,message)=>{if(message.startsWith('__indexParityResult:'))report.results.push(JSON.parse(message.slice(20)));else if(level>=2)(report.errors||=[]).push(message)});
 timer=setInterval(()=>{if(done)return;const processes=app.getAppMetrics().map(row=>({pid:row.pid,type:row.type,bytes:row.memory.workingSetSize*1024})),total=processes.reduce((sum,row)=>sum+row.bytes,0);report.memory.push({at:Date.now(),processes,total});if(total>report.limits.combinedRSS)finish(Error('Combined native oracle owners exceeded 1GiB.'));},50);deadline=setTimeout(()=>finish(Error('Native image parity timed out.')),120000);
 await win.loadFile(path.join(root,'image-conversion-worker.html'));
 const workerURL=require('node:url').pathToFileURL(path.join(root,'image-index-raster-worker.js')).href;
 const result=await win.webContents.executeJavaScript(`(async()=>{
  const binary=window.NoteMindDocumentBytes,publish=binary.publish,worker=new Worker(${JSON.stringify(workerURL)});let output,id=0;
  binary.publish=(owner,bytes)=>{output=bytes;return{nativeOracle:true}};
  const pending=new Map();worker.onmessage=e=>{const item=pending.get(e.data.id);if(item){pending.delete(e.data.id);item.resolve(e.data)}};worker.onerror=e=>{for(const item of pending.values())item.reject(Error(e.message));pending.clear()};
  const raster=async bytes=>{const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const canvas=new OffscreenCanvas(image.width,image.height);try{canvas.getContext('2d').drawImage(image,0,0);const value=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);return{width:canvas.width,height:canvas.height,pixels:value.data}}finally{image.close();canvas.width=canvas.height=0}};
  const release=bytes=>{if(bytes?.buffer?.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0)};
  const results=[];try{
   const cases=[['alpha',257,193,'image/png'],['png-resize',3000,2000,'image/png'],['jpeg-resize',3000,2000,'image/jpeg'],['tiny',7,13,'image/png'],['wide',3029,179,'image/jpeg'],['display-p3',257,193,'image/png'],...Array.from({length:8},(_,n)=>['exif-'+(n+1),120,80,'image/jpeg',n+1])];
   for(const[name,width,height,type,orientation]of cases){
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',name==='display-p3'?{colorSpace:'display-p3'}:undefined);
    for(let y=0;y<height;y+=17)for(let x=0;x<width;x+=23){ctx.fillStyle=name==='display-p3'?'color(display-p3 1 0.2 0.1)': 'rgba('+x%256+','+y%256+','+(x+y)%256+','+((x+y)%11/10)+')';ctx.fillRect(x,y,23,17)}
    const blob=await canvas.convertToBlob({type,quality:.93});let source=new Uint8Array(await blob.arrayBuffer());canvas.width=canvas.height=0;if(orientation){const exif=new Uint8Array(36),view=new DataView(exif.buffer);exif.set([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0]);view.setUint16(20,274,true);view.setUint16(22,3,true);view.setUint32(24,1,true);view.setUint16(28,orientation,true);const original=source;source=new Uint8Array(original.length+exif.length);source.set(original.subarray(0,2));source.set(exif,2);source.set(original.subarray(2),38);release(original)}const dimensions=orientation>=5?{width:height,height:width}:{width,height};
    const session=binary.begin(source.byteLength);let baseline,actual;
    try{
     for(let at=0;at<source.length;at+=196608){const part=source.subarray(at,at+196608);let text='';for(let p=0;p<part.length;p+=8192)text+=String.fromCharCode(...part.subarray(p,p+8192));binary.write(session,at,btoa(text));}
     await window.documentTools.image({documentByteInput:session},type,false,2400,dimensions);baseline=await raster(output);release(output);output=null;
     const copy=source.slice().buffer,request=++id,answer=await new Promise((resolve,reject)=>{pending.set(request,{resolve,reject});worker.postMessage({id:request,bytes:copy,type,maxDimension:2400,dimensions},[copy])});
     if(answer.error)throw Error(answer.error.message);if(!answer.released||copy.byteLength)throw Error('Worker resource acknowledgement failed.');actual=await raster(new Uint8Array(answer.bytes));answer.bytes.transfer?.(0);
     let differences=0,maxDifference=0;for(let n=0;n<baseline.pixels.length;n++){const delta=Math.abs(baseline.pixels[n]-actual.pixels[n]);if(delta){differences++;maxDifference=Math.max(maxDifference,delta)}}
     const digest=async pixels=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),value=>value.toString(16).padStart(2,'0')).join('');
     results.push({name,width:baseline.width,height:baseline.height,actualWidth:actual.width,actualHeight:actual.height,differences,maxDifference,authoritySHA:await digest(baseline.pixels),workerSHA:await digest(actual.pixels)});console.log('__indexParityResult:'+JSON.stringify(results.at(-1)));
     if(baseline.width!==actual.width||baseline.height!==actual.height||differences)throw Error('Native image pixels differ: '+JSON.stringify(results.at(-1)));
    }finally{binary.release(session);release(source);release(output);output=null;release(baseline?.pixels);release(actual?.pixels)}
   }
   return{results,rendererHeapLimit:performance.memory?.jsHeapSizeLimit,workerLifetime:'persistent while compared; terminate below is not a native-thread exit acknowledgement'};
  }finally{binary.publish=publish;worker.terminate();for(const item of pending.values())item.reject(Error('Oracle closed'));pending.clear()}
 })()`);
 report.results=result.results;report.rendererHeapLimit=result.rendererHeapLimit;report.workerLifetime=result.workerLifetime;
 const pid=win.webContents.getOSProcessId();await require('../src/document-helper-lifetime.cjs').stopConverter(win,{pid});win=null;
 if(report.errors?.length)throw Error(report.errors.join('; '));finish();
}).catch(finish);
