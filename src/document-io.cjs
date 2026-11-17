const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),crypto=require('node:crypto');
const {TextReader,available}=require('./ocr.cjs');
const {importWord,exportWord,printHtml}=require('./documents.cjs');
const {mime,render,imageDimensions}=require('./document-renderer.cjs');
const {executeBytes,withInput,base64}=require('./document-worker-bytes.cjs');
const {isRawAsset}=require('./document-asset-sessions.cjs');
const codec=require('./archive-codec.cjs');
const printLeases=new(require('./print-file-leases.cjs').PrintFileLeases)();
const reader=new TextReader();let helper=null,pendingHelper=null,disposed=false;const conversions=new Map();let helperQueue=Promise.resolve();
const abortError=()=>Object.assign(Error('Conversion cancelled.'),{name:'AbortError'});
const checkAbort=signal=>{if(signal?.aborted)throw abortError();};
const expression=(name,args)=>'window.documentTools['+JSON.stringify(name)+']('+args.map(value=>JSON.stringify(value)??'undefined').join(',')+')';
async function createWorker(signal){
 checkAbort(signal);const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'notemind-document-'+crypto.randomUUID()}}),abort=()=>{if(!w.isDestroyed())w.destroy();};signal?.addEventListener('abort',abort,{once:true});
 try{await w.loadFile(path.join(__dirname,'document-worker.html'));await w.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.documentTools){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(Error("Converter could not load"))}},50)})');checkAbort(signal);return w;}catch(error){if(!w.isDestroyed())w.destroy();if(signal?.aborted)throw abortError();throw error;}finally{signal?.removeEventListener('abort',abort);}
}
async function worker(){if(disposed)throw Error('Document tools are closing.');if(helper&&!helper.isDestroyed())return helper;if(pendingHelper)return pendingHelper;pendingHelper=(async()=>{try{const w=await createWorker();if(disposed){w.destroy();throw Error('Document tools are closing.');}helper=w;return w;}finally{pendingHelper=null;}})();return pendingHelper;}
async function invokeWorker(w,name,args,signal){return withInput(args[0],data=>{const values=[data,...args.slice(1)];if(name==='image'&&ArrayBuffer.isView(data)&&values[4]===undefined)values[4]=imageDimensions(Buffer.from(data.buffer,data.byteOffset,Math.min(data.byteLength,65536)));return executeBytes(code=>w.webContents.executeJavaScript(code),name,values,{signal})})}
function call(name,...args){const next=helperQueue.catch(()=>{}).then(async()=>invokeWorker(await worker(),name,args));helperQueue=next;return next;}
async function callCancelable(name,args,signal,{maxRSSBytes,timeoutMs}={}){
 if(!signal&&!maxRSSBytes&&!timeoutMs)return call(name,...args);checkAbort(signal);const w=await createWorker(signal),abort=()=>{if(!w.isDestroyed())w.destroy();};let failure,timer,monitor;const stop=message=>{failure ||= Error(message);abort()};
 try{checkAbort(signal);signal?.addEventListener('abort',abort,{once:true});if(timeoutMs)timer=setTimeout(()=>stop('Image conversion timed out.'),timeoutMs);if(maxRSSBytes&&typeof app.getAppMetrics==='function'&&typeof w.webContents.getOSProcessId==='function')monitor=setInterval(()=>{if(w.isDestroyed())return;try{const pid=w.webContents.getOSProcessId(),row=app.getAppMetrics().find(item=>item.pid===pid);if(row&&(row.memory?.workingSetSize||0)*1024>maxRSSBytes)stop('Image conversion exceeded its memory limit.');}catch{stop('Image conversion could not be supervised.');}},50);return await invokeWorker(w,name,args,signal);}catch(error){if(signal?.aborted)throw abortError();if(failure)throw failure;throw error;}finally{clearTimeout(timer);clearInterval(monitor);signal?.removeEventListener('abort',abort);if(!w.isDestroyed())w.destroy();}
}
async function convertImage(bytes,type,{signal,dimensions,maxDimension=4096,maxRSSBytes=384*1024*1024,timeoutMs=30000}={}){if(!Number.isSafeInteger(maxRSSBytes)||maxRSSBytes<=0||!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw Error('Invalid image conversion limits.');const image=await callCancelable('image',[bytes,type,false,maxDimension,dimensions],signal,{maxRSSBytes,timeoutMs}),data=Buffer.isBuffer(image.data)?image.data:Buffer.from(image.data,'base64');return{data,bytes:data,width:image.width,height:image.height}}
async function importPDF(bytes,{mode='both',password,language='auto',signal,onProgress=()=>{}}={}){
 checkAbort(signal);onProgress('Reading PDF pages');const pages=await callCancelable('pdf',[bytes,password],signal),assets={},parts=[];
 for(const page of pages){checkAbort(signal);onProgress('Reading page '+page.page+' of '+pages.length);let text=page.text;if(mode!=='images'&&text.replace(/\s/g,'').length<15){const result=await reader.read(Buffer.isBuffer(page.image)?page.image:Buffer.from(page.image,'base64'),{language,signal});text=result.text;}
  const name='assets/page-'+page.page+'.png';if(mode!=='text')assets[name]=Buffer.isBuffer(page.image)?base64(page.image):page.image;parts.push('## Page '+page.page+'\n\n'+(mode!=='text'?'![Page '+page.page+']('+name+')\n\n':'')+(mode!=='images'?text:''));
 }return {path:null,text:parts.join('\n\n---\n\n'),assets,warnings:[]};
}
async function importFile(file,options={}){checkAbort(options.signal);const bytes=await require('./read-limited.cjs').readLimited(file,150*1024*1024,'Import files up to 150 MB.',{signal:options.signal});checkAbort(options.signal);const ext=path.extname(file).toLowerCase();let result;if(ext==='.docx')result=await importWord(bytes,{signal:options.signal});else if(ext==='.pdf')result=await importPDF(bytes,options);else throw Error('Choose a Word .docx or PDF document.');checkAbort(options.signal);return {...result,title:path.basename(file,ext),imported:true,sourcePath:file};}
async function exportFile(doc,file,options={}){
 const ext=path.extname(file).toLowerCase();let bytes;
 doc=await require('./print-images.cjs').preparePrint(doc,options.clean,(...args)=>call('image',...args));
 if(ext==='.docx'){const images={};for(const[name,data]of Object.entries(doc.assets||{}))if(mime(name))images[name]=await call('image',data,mime(name));bytes=await exportWord(doc,images,options);}
 else if(ext==='.pdf'){bytes=await renderPDF(doc,require('./pdf-options.cjs').printOptions(options));}
 else throw Error('Choose .docx or .pdf.');const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes,{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{})}return file;
}
async function previewFile(file,password){
 const bytes=await require('./read-limited.cjs').readLimited(file,150*1024*1024,'Open files up to 150 MB.');const ext=path.extname(file).toLowerCase();
 if(ext==='.pdf')return {kind:'pdf',pages:publicPages(await call('pdf',bytes,password))};
 if(ext==='.docx'){const doc=await importWord(bytes),pdf=await renderPDF(doc,{printBackground:true,pageSize:'A4'});return {kind:'docx',pages:publicPages(await call('pdf',pdf)),converted:doc,html:render(doc.text,doc.assets)};}
 const type=mime(file);if(!type)throw Error('Choose a PDF, Word document, or image.');const image=await call('image',bytes,type);if(Buffer.isBuffer(image.data))image.data=base64(image.data);return {kind:'image',pages:[{...image,image:image.data,page:1,text:'',blocks:[]}]};
}
const publicPages=pages=>pages.map(page=>({...page,image:Buffer.isBuffer(page.image)?base64(page.image):page.image}));
async function renderPDF(doc,options){return require('./print-asset-files.cjs').withPrintFiles(doc,async files=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});try{await fs.writeFile(files.file,printHtml(doc,{files:true,imageUrl:files.url}),{flag:'wx'});await w.loadFile(files.file);await w.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,i=>i.decode())])');return await w.webContents.printToPDF(options)}finally{if(!w.isDestroyed())w.destroy()}})}
let documentWindow=()=>null;
async function previewDimensions(doc){const sizes=new Map();for(const[name,data]of Object.entries(doc.assets||{}))if(mime(name)&&isRawAsset(data)){const header=data.bytes?await codec.readRawAsset(data,{length:Math.min(data.bytes,65536)}):new Uint8Array();const dimensions=imageDimensions(header)||await call('dimensions',data,mime(name));sizes.set(name,dimensions)}return sizes}
async function printDocument(doc,options={},owner){if(!doc||typeof doc.text!=='string')throw Error('Invalid document');if(options.preview)return require('./print-preview.cjs').html(doc,{dimensions:await previewDimensions(doc)});const prepared=await require('./print-images.cjs').preparePrint({...doc,assets:doc.assets||{},meta:doc.meta||{}},options.clean,(...args)=>call('image',...args));if(!Object.values(prepared.assets).some(value=>isRawAsset(value)||ArrayBuffer.isView(value)))return printHtml(prepared);const lease=await printLeases.open(owner,prepared);try{return printHtml(prepared,{files:true,imageUrl:lease.url}).replace('<meta charset=', '<meta name="notemind-print-assets" content="'+lease.token+'"><meta charset=')}catch(error){await printLeases.release(owner,lease.token);throw error}}
async function exportDocument(doc,format,options={}){if(!['docx','pdf'].includes(format))throw Error('Unsupported export');const choice=await dialog.showSaveDialog(documentWindow(),{title:format==='docx'?'Export Word document':'Export PDF',defaultPath:(doc.path?doc.path.replace(/\.[^.]+$/, ''):doc.title||'Untitled')+'.'+format,filters:[{name:format==='docx'?'Word document':'PDF document',extensions:[format]}]});if(choice.canceled)return null;const exported=await exportFile(doc,choice.filePath,options);if(options.open)shell.openPath(exported).catch(()=>{});return exported;}
function register(getWin,getPad=()=>null,seedDocument=(_,doc)=>doc){
 documentWindow=getWin;
 ipcMain.handle('document-preview-capture',async(e,rect,fromPad=false)=>{const r={};for(const key of ['x','y','width','height']){if(!Number.isFinite(rect[key]))throw Error('Invalid selection');r[key]=Math.max(0,Math.round(rect[key]));}if(!r.width||!r.height)throw Error('Select a visible part of the page.');if(fromPad&&e.sender!==getWin()?.webContents)throw Error('Invalid display request');const target=fromPad?getPad():e.sender;if(!target||target.isDestroyed())throw Error('The display is no longer available.');return (await target.capturePage(r)).toPNG().toString('base64')});
 ipcMain.handle('document-preview',(_,file,password)=>previewFile(file,password));
 ipcMain.handle('document-convert-path',async(event,file,options={})=>{const id=typeof options.id==='string'?options.id.slice(0,128):crypto.randomUUID(),key=String(event.sender?.id||0)+':'+id,controller=new AbortController(),destroyed=()=>controller.abort();if(conversions.has(key))throw Error('This conversion is already running.');conversions.set(key,controller);event.sender?.once?.('destroyed',destroyed);try{return seedDocument(event,await importFile(file,{password:options.password,signal:controller.signal}));}finally{conversions.delete(key);event.sender?.removeListener?.('destroyed',destroyed);}});
 ipcMain.handle('document-convert-cancel',(event,id)=>{const key=String(event.sender?.id||0)+':'+String(id);conversions.get(key)?.abort();});
 ipcMain.handle('document-open-default',async(_,file)=>{const error=await shell.openPath(file);if(error)throw Error(error)});
 ipcMain.handle('ocr-available',()=>available());
 ipcMain.handle('ocr-read',(e,{id,data,language})=>reader.read(Buffer.from(data,'base64'),{id,language,onProgress:phase=>{if(!e.sender.isDestroyed())e.sender.send('document-progress',{id,phase})}}));
 ipcMain.handle('ocr-cancel',(_,id)=>reader.cancel(id));
 ipcMain.handle('document-import',async(e,options={})=>{const choice=await dialog.showOpenDialog(getWin(),{title:'Import document',properties:['openFile'],filters:[{name:'Word and PDF',extensions:['docx','pdf']}]});if(choice.canceled)return null;return seedDocument(e,await importFile(choice.filePaths[0],{...options,onProgress:phase=>e.sender.send('document-progress',{phase})}));});
 ipcMain.handle('document-print-html',(event,doc,options)=>printDocument(doc,options,event.sender));
 ipcMain.handle('document-print-release',(event,token)=>printLeases.release(event.sender,token));
 ipcMain.handle('pdf-geometry',(_,options)=>require('./pdf-options.cjs').geometry(options));
 ipcMain.handle('document-export',(_,doc,format,options)=>exportDocument(doc,format,options));
 app.on('will-quit',dispose);
}
function dispose(){disposed=true;void printLeases.dispose();for(const controller of conversions.values())controller.abort();conversions.clear();reader.dispose();if(helper&&!helper.isDestroyed())helper.destroy();helper=null;pendingHelper?.then(w=>{if(!w.isDestroyed())w.destroy();}).catch(()=>{});}
module.exports={register,printDocument,previewImages:(doc,options)=>require('./print-preview.cjs').images(doc,options,(...args)=>call('image',...args)),exportDocument,previewFile,importFile,importPDF,exportFile,reader,call,convertImage,dispose};
