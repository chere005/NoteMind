// Independent expected pixels are the existing HTMLCanvas PNG converter decoded
// by the production Node PNG decoder. The candidate never encodes a PNG.
require('./disable-native-pen.cjs');
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createHostImageConverter}=require('../src/image-index-raster-client.cjs');
const source=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),root=path.resolve('src');
const out=path.resolve('test-results/performance/image-index-pixels-'+source.slice(0,7)+'.json'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-index-pixels-'));
const report={source,profile,scope:'All14 original image profiles: Node decodePng(old HTMLCanvas PNG) versus owned unencoded index RGBA',versions:process.versions,rows:[],memory:[],files:{},ok:false};
fs.mkdirSync(path.dirname(out),{recursive:true});
for(const file of ['image-index-raster-worker.js','image-index-raster-host.js','image-index-raster-client.cjs','document-byte-tools.js','document-worker-bytes.cjs','image-conversion-worker.js','ocr/png.ts'])report.files[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const code=require('esbuild').buildSync({entryPoints:[path.join(root,'ocr/png.ts')],platform:'node',format:'cjs',bundle:true,write:false}).outputFiles[0].text,moduleValue={exports:{}};
new Function('require','module','exports',code)(require,moduleValue,moduleValue.exports);
const {decodePng}=moduleValue.exports,hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const client=createHostImageConverter();let win,timer,deadline,finished=false;
app.setPath('userData',profile);app.dock?.hide();app.on('window-all-closed',()=>{});
for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
require('./native-failure-exit.cjs').installNativeFailureExit({app,report:out,telemetry:report});
function sample(){const processes=app.getAppMetrics().map(row=>({pid:row.pid,type:row.type,bytes:row.memory.workingSetSize*1024})),total=processes.reduce((sum,row)=>sum+row.bytes,0);report.memory.push({at:Date.now(),processes,total});if(total>1024*1024*1024)throw Error('Independent Node PNG pixel authority exceeded unchanged1GiB.');}
function finish(error){if(finished)return;finished=true;clearInterval(timer);clearTimeout(deadline);report.ok=!error;report.peak=Math.max(0,...report.memory.map(row=>row.total));if(error)report.error=error.stack||String(error);report.finished=new Date().toISOString();fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,rows:report.rows.length,peak:report.peak,error:report.error,artifact:out}));app.exit(error?1:0);}
const discard=bytes=>{if(bytes?.byteLength&&!bytes.byteOffset&&bytes.byteLength===bytes.buffer.byteLength)bytes.buffer.transfer(0);};
function privateBase64(value){const bytes=Buffer.allocUnsafeSlow(Buffer.byteLength(value,'base64'));if(bytes.write(value,'base64')!==bytes.length)throw Error('Oracle bytes changed.');return bytes;}
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:false,focusable:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'notemind-index-pixels-'+crypto.randomUUID()}});
 win.webContents.on('console-message',event=>{if(event.level>=2)(report.errors||=[]).push(event.message)});
 timer=setInterval(()=>{try{sample()}catch(error){finish(error)}},50);deadline=setTimeout(()=>finish(Error('Index pixel authority deadline.')),120000);
 await win.loadFile(path.join(root,'image-conversion-worker.html'));
 const cases=[['alpha',257,193,'image/png'],['png-resize',3000,2000,'image/png'],['jpeg-resize',3000,2000,'image/jpeg'],['tiny',7,13,'image/png'],['wide',3029,179,'image/jpeg'],['display-p3',257,193,'image/png'],...Array.from({length:8},(_,n)=>['exif-'+(n+1),120,80,'image/jpeg',n+1])];
 for(const item of cases){
  const began=performance.now(),packet=await win.webContents.executeJavaScript(`(async()=>{
   const [name,width,height,type,orientation]=${JSON.stringify(item)},canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d',name==='display-p3'?{colorSpace:'display-p3'}:undefined);
   for(let y=0;y<height;y+=17)for(let x=0;x<width;x+=23){context.fillStyle=name==='display-p3'?'color(display-p3 1 0.2 0.1)':'rgba('+x%256+','+y%256+','+(x+y)%256+','+((x+y)%11/10)+')';context.fillRect(x,y,23,17)}
   const blob=await canvas.convertToBlob({type,quality:.93});let source=new Uint8Array(await blob.arrayBuffer());canvas.width=canvas.height=0;
   const release=bytes=>{if(bytes?.byteLength)bytes.buffer.transfer(0)},encode=bytes=>{let text='';for(let at=0;at<bytes.length;at+=8192)text+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(text)};
   if(orientation){const exif=new Uint8Array(36),view=new DataView(exif.buffer);exif.set([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0]);view.setUint16(20,274,true);view.setUint16(22,3,true);view.setUint32(24,1,true);view.setUint16(28,orientation,true);const original=source;source=new Uint8Array(original.length+36);source.set(original.subarray(0,2));source.set(exif,2);source.set(original.subarray(2),38);release(original);release(exif)}
   const dimensions=orientation>=5?{width:height,height:width}:{width,height},binary=window.NoteMindDocumentBytes,session=binary.begin(source.byteLength),publish=binary.publish;let output;
   binary.publish=(_owner,bytes)=>{output=bytes;return{oracle:true}};
   try{for(let at=0;at<source.length;at+=196608)binary.write(session,at,encode(source.subarray(at,at+196608)));await window.documentTools.image({documentByteInput:session},type,false,2400,dimensions);return{source:encode(source),baseline:encode(output),dimensions};}
   finally{binary.publish=publish;binary.release(session);release(source);release(output)}
  })()`);
  let sourceBytes,baseline,expected,actual;
  try{
   sourceBytes=privateBase64(packet.source);baseline=privateBase64(packet.baseline);expected=decodePng(baseline);
   actual=await client.convertPixels(win.webContents,sourceBytes,item[3],{dimensions:packet.dimensions,maxDimension:2400});
   if(!actual?.pixels||actual.width!==expected.width||actual.height!==expected.height||actual.data.length!==expected.data.length)throw Error('Independent pixel geometry changed.');
   let differences=0,maxDifference=0;for(let at=0;at<expected.data.length;at++){const difference=Math.abs(expected.data[at]-actual.data[at]);if(difference){differences++;maxDifference=Math.max(maxDifference,difference)}}
   const row={name:item[0],sourceSHA:hash(sourceBytes),baselinePNGSHA:hash(baseline),authorityRGBA:hash(expected.data),actualRGBA:hash(actual.data),width:actual.width,height:actual.height,differences,maxDifference,wallMs:performance.now()-began,host:await client.stats()};
   report.rows.push(row);fs.writeFileSync(out,JSON.stringify({...report,inProgress:true},null,2)+'\n');sample();
   if(differences||row.authorityRGBA!==row.actualRGBA||row.host.bytes||row.host.sessions||row.host.active)throw Error('Unencoded pixels or retirement changed: '+JSON.stringify(row));
  }finally{discard(sourceBytes);discard(baseline);discard(expected?.data);discard(actual?.data);}
 }
 const pid=win.webContents.getOSProcessId();await require('../src/document-helper-lifetime.cjs').stopConverter(win,{pid});win=null;await client.dispose();sample();
 if(report.rows.length!==14||report.errors?.length)throw Error('The original14-profile pixel proof was incomplete or raised errors.');finish();
}).catch(finish);
