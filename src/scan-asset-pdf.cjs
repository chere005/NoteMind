const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto'),{Worker}=require('node:worker_threads');
const limits=require('./scan-limits.js');
const WORKING_BYTES=256*1024*1024,MAX_THUMB=512*1024;
const abortError=()=>Object.assign(Error('Scan preparation cancelled.'),{name:'AbortError'}),check=signal=>{if(signal?.aborted)throw abortError();};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function scanPages(doc){
 const pages=doc?.meta?.scanPages;limits.assertPageCount(pages?.length,{allowEmpty:false});if(!Array.isArray(pages)||!doc.assets||typeof doc.assets!=='object')throw Error('Invalid scan pages.');let chars=0,textBytes=0;
 const output=pages.map(page=>{if(!page||typeof page.asset!=='string'||!Object.hasOwn(doc.assets,page.asset)||!/\.(?:png|jpe?g)$/i.test(page.asset)||page.text!==undefined&&typeof page.text!=='string')throw Error('Invalid scan page asset.');const data=doc.assets[page.asset],bytes=typeof data==='string'?data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0):data?.bytes,mime=/\.png$/i.test(page.asset)?'image/png':'image/jpeg';chars+=limits.imageDataURLChars(bytes,mime);if(chars>limits.MAX_DATA_URL_CHARS)throw Error('This scan is too large. Use fewer pages.');textBytes+=Buffer.byteLength(page.text||'');if(textBytes>limits.ENTRY_BYTES-4096)throw Error('The scan text is too large.');return{asset:page.asset,text:page.text||'',mime};});return output;
}
async function spoolAsset(codec,data,file,mime,signal){
 check(signal);
 if(typeof data!=='string')return codec.withRawAssetBytes(data,async bytes=>{check(signal);const info=await limits.validateBytes(bytes,{signal});if(info.mime!==mime)throw Error('Scan image type does not match its asset.');await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});check(signal);return info;});
 // Legacy callers retain their original input strings. Normal DocSync sends
 // large images through raw uploads; never build another full decoded buffer.
 const info=await limits.validateImage('data:'+mime+';base64,'+data,{signal}),handle=await fs.open(file,'wx',0o600);
 try{for(let at=0;at<data.length;at+=262144){check(signal);const bytes=Buffer.from(data.slice(at,at+262144),'base64');let offset=0;while(offset<bytes.length){const written=await handle.write(bytes,offset,bytes.length-offset);if(!written.bytesWritten)throw Error('Scan image write stopped.');offset+=written.bytesWritten;}await tick();}check(signal);return info;}finally{await handle.close();}
}
function runWriter(packet,signal,{WorkerClass=Worker}={}){
 check(signal);const cancel=new SharedArrayBuffer(4),flag=new Int32Array(cancel),worker=new WorkerClass(path.join(__dirname,'scan-pdf-worker.cjs'),{workerData:{...packet,cancel},resourceLimits:{maxOldGenerationSizeMb:128}});
 return new Promise((resolve,reject)=>{let result,error,settled=false;const abort=()=>{Atomics.store(flag,0,1);error=abortError();void worker.terminate().catch(failure=>{error=failure;});};const finish=code=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(error)reject(error);else if(!result||code!==0)reject(Error('Scan PDF worker stopped before finishing.'));else resolve(result);};worker.on('message',message=>{if(message?.error)error=Object.assign(Error(message.error.message),{name:message.error.name});else if(message?.result)result=message.result;});worker.on('error',failure=>{error=failure});worker.once('exit',finish);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
}
async function inspectNative(pages,directory,signal,{createWindow}={}){
 // Bitmap ownership is explicit: no HTMLImage cache or all-page raster graph.
 const needed=pages.filter((page,index)=>index===0||page.mime==='image/jpeg');if(!needed.length)return null;
 const BrowserWindow=createWindow?null:require('electron').BrowserWindow,w=createWindow?createWindow():new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,partition:'scan-'+randomUUID()}}),html=path.join(directory,'inspect.html');
 const abort=()=>{if(!w.isDestroyed())w.destroy()};signal?.addEventListener('abort',abort,{once:true});
 try{await fs.writeFile(html,'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src file:; script-src \'none\'">',{flag:'wx',mode:0o600});check(signal);await w.loadFile(html);let thumbnail=null;
  for(const page of needed){check(signal);const first=page===pages[0],url=pathToFileURL(page.file).href,bytes=await w.webContents.executeJavaScript(`(async()=>{let bitmap,canvas;try{const response=await fetch(${JSON.stringify(url)});if(!response.ok)throw Error('Scan image could not be read.');const blob=await response.blob();bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});if(!bitmap.width||!bitmap.height||bitmap.width>32768||bitmap.height>32768||bitmap.width*bitmap.height>16777216)throw Error('Scan image dimensions exceed the 16 Mi pixel limit.');if(!${first})return null;const scale=Math.min(1,320/bitmap.width,320/bitmap.height);canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);const preview=await canvas.convertToBlob({type:'image/png'});if(preview.size>524288)throw Error('Scan thumbnail is too large.');return await preview.arrayBuffer();}finally{bitmap?.close();if(canvas){canvas.width=canvas.height=0;}}})()`);check(signal);if(first){if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>MAX_THUMB)throw Error('Invalid scan thumbnail.');thumbnail=Buffer.from(bytes);}}
  return thumbnail;
 }finally{signal?.removeEventListener('abort',abort);if(!w.isDestroyed())w.destroy();}
}
async function scanAssetPdf(doc,options={},services={}){
 const codec=services.codec||require('./archive-codec.cjs'),pages=scanPages(doc),controller=new AbortController(),links=[],link=signal=>{if(!signal)return;const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});links.push(()=>signal.removeEventListener('abort',abort));if(signal.aborted)abort();};link(options.signal);
 const signal=controller.signal,base=services.tempPath||require('electron').app.getPath('temp');check(signal);const directory=await fs.mkdtemp(path.join(base,'notemind-scan-'));let release=null;
 try{
  const staged=new Map();
  for(let index=0;index<pages.length;index++){check(signal);const page=pages[index],data=doc.assets[page.asset],key=typeof data==='string'?'name:'+page.asset:'raw:'+data?.rawAssetToken,prior=staged.get(key);if(prior){if(prior.mime!==page.mime)throw Error('Scan image type does not match its asset.');page.file=prior.file;continue;}page.file=path.join(directory,index+(page.mime==='image/png'?'.png':'.jpg'));await spoolAsset(codec,data,page.file,page.mime,signal);staged.set(key,page);if(typeof data!=='string')await codec.unpinScopedRawAssets([data]);check(signal);}
  release=await codec.acquireScopedRawWorking(WORKING_BYTES);link(release.signal);check(signal);
  const thumbnail=await (services.inspectNative||inspectNative)(pages,directory,signal,services);check(signal);const output=path.join(directory,'Scan.pdf'),result=await (services.runWriter||runWriter)({pages:pages.map(({file,mime})=>({file,mime})),output},signal,services);check(signal);limits.assertPDFSize(result.bytes);const stat=await fs.stat(output);if(stat.size!==result.bytes)throw Error('The scan PDF changed before import.');
  const thumbFile=path.join(directory,'preview.png');if(!(thumbnail instanceof Uint8Array)||!thumbnail.byteLength||thumbnail.byteLength>MAX_THUMB)throw Error('Invalid scan thumbnail.');const thumbInfo=await limits.validateBytes(thumbnail,{signal});if(thumbInfo.mime!=='image/png'||thumbInfo.width>320||thumbInfo.height>320)throw Error('Invalid scan thumbnail.');await fs.writeFile(thumbFile,thumbnail,{flag:'wx',mode:0o600});
  await release();release=null;check(signal);const name='assets/scan-'+randomUUID()+'.pdf',thumb=name+'.preview.png',importFile=services.importFile||((file,name)=>codec.importRawAssetFile(file,{name,root:directory}));let pdf,preview;
  try{pdf=await importFile(output,name);check(signal);preview=await importFile(thumbFile,thumb);check(signal);}catch(error){if(pdf&&typeof pdf!=='string')await codec.releaseScopedRawAssets([pdf]).catch(()=>{});if(preview&&typeof preview!=='string')await codec.releaseScopedRawAssets([preview]).catch(()=>{});throw error;}
  return {text:'',name,assets:{[name]:pdf,[thumb]:preview},info:{title:'Scan.pdf',pages:pages.length,bytes:result.bytes,thumbnail:thumb,text:pages.map(page=>page.text).join('\n\n')}};
 }finally{controller.abort();for(const off of links)off();await release?.();await fs.rm(directory,{recursive:true,force:true});}
}
async function legacyScanPdf(pages,options={},services={}){
 await limits.validatePages(pages,{signal:options.signal});const codec=services.codec||require('./archive-codec.cjs'),owner=randomUUID(),doc={text:'',assets:{},meta:{scanPages:[]}};
 for(let i=0;i<pages.length;i++){const page=pages[i],info=limits.inspectImage(page.data),asset='assets/page-'+i+(info.mime==='image/png'?'.png':'.jpg');doc.assets[asset]=page.data.slice(page.data.indexOf(',')+1);doc.meta.scanPages.push({asset,text:page.text||''});}
 const lease=await codec.preflightRawAssets([],{owner});try{return await lease.run(()=>scanAssetPdf(doc,options,{...services,codec,importFile:async(file)=>{const bytes=await fs.readFile(file);limits.assertPDFSize(bytes.length);return bytes.toString('base64');}}));}finally{await lease.release();await codec.releaseRawAssets(owner);}
}
module.exports={scanAssetPdf,legacyScanPdf,scanPages,runWriter,inspectNative,WORKING_BYTES};
