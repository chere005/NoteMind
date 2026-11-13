const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),crypto=require('node:crypto');
const {TextReader,available}=require('./ocr.cjs');
const {importWord,exportWord,printHtml}=require('./documents.cjs');
const {mime,render}=require('./document-renderer.cjs');
const reader=new TextReader();let helper=null,pendingHelper=null,disposed=false;
async function worker(){if(disposed)throw Error("Document tools are closing.");if(helper&&!helper.isDestroyed())return helper;if(pendingHelper)return pendingHelper;pendingHelper=(async()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});try{await w.loadFile(path.join(__dirname,'document-worker.html'));await w.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.documentTools){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(Error("Converter could not load"))}},50)})');if(disposed){w.destroy();throw Error("Document tools are closing.");}helper=w;return w;}catch(e){w.destroy();throw e;}finally{pendingHelper=null;}})();return pendingHelper;}
async function call(name,...args){const w=await worker();return w.webContents.executeJavaScript('window.documentTools['+JSON.stringify(name)+']('+args.map(a=>JSON.stringify(a)).join(',')+')');}
async function importPDF(bytes,{mode='both',password,language='auto',onProgress=()=>{}}={}){
 onProgress('Reading PDF pages');const pages=await call('pdf',bytes.toString('base64'),password),assets={},parts=[];
 for(const page of pages){onProgress('Reading page '+page.page+' of '+pages.length);let text=page.text;if(mode!=='images'&&text.replace(/\s/g,'').length<15){const result=await reader.read(Buffer.from(page.image,'base64'),{language});text=result.text;}
  const name='assets/page-'+page.page+'.png';if(mode!=='text')assets[name]=page.image;parts.push('## Page '+page.page+'\n\n'+(mode!=='text'?'![Page '+page.page+']('+name+')\n\n':'')+(mode!=='images'?text:''));
 }return {path:null,text:parts.join('\n\n---\n\n'),assets,warnings:[]};
}
async function importFile(file,options={}){const bytes=await fs.readFile(file);if(bytes.length>150*1024*1024)throw Error('Import files up to 150 MB.');const ext=path.extname(file).toLowerCase();let result;if(ext==='.docx')result=await importWord(bytes);else if(ext==='.pdf')result=await importPDF(bytes,options);else throw Error('Choose a Word .docx or PDF document.');return {...result,title:path.basename(file,ext),imported:true,sourcePath:file};}
async function exportFile(doc,file,options={}){
 const ext=path.extname(file).toLowerCase();let bytes;
 doc=await require('./print-images.cjs').preparePrint(doc,options.clean,(...args)=>call('image',...args));
 if(ext==='.docx'){const images={};for(const[name,data]of Object.entries(doc.assets||{}))if(mime(name))images[name]=await call('image',data,mime(name));bytes=await exportWord(doc,images,options);}
 else if(ext==='.pdf'){const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});try{const html=printHtml(doc);await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await w.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,i=>i.decode())])');bytes=await w.webContents.printToPDF(require('./pdf-options.cjs').printOptions(options));}finally{w.destroy();}}
 else throw Error('Choose .docx or .pdf.');const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes,{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{})}return file;
}
async function previewFile(file,password){
 const bytes=await fs.readFile(file);if(bytes.length>150*1024*1024)throw Error('Open files up to 150 MB.');const ext=path.extname(file).toLowerCase();
 if(ext==='.pdf')return {kind:'pdf',pages:await call('pdf',bytes.toString('base64'),password)};
 if(ext==='.docx'){const doc=await importWord(bytes),w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});try{await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(printHtml(doc)));await w.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,i=>i.decode())])');const pdf=await w.webContents.printToPDF({printBackground:true,pageSize:'A4'});return {kind:'docx',pages:await call('pdf',pdf.toString('base64')),converted:doc,html:render(doc.text,doc.assets)};}finally{w.destroy();}}
 const type=mime(file);if(!type)throw Error('Choose a PDF, Word document, or image.');const image=await call('image',bytes.toString('base64'),type);return {kind:'image',pages:[{...image,image:image.data,page:1,text:'',blocks:[]}]};
}
function register(getWin,getPad=()=>null){
 ipcMain.handle('document-preview-capture',async(e,rect,fromPad=false)=>{const r={};for(const key of ['x','y','width','height']){if(!Number.isFinite(rect[key]))throw Error('Invalid selection');r[key]=Math.max(0,Math.round(rect[key]));}if(!r.width||!r.height)throw Error('Select a visible part of the page.');if(fromPad&&e.sender!==getWin()?.webContents)throw Error('Invalid display request');const target=fromPad?getPad():e.sender;if(!target||target.isDestroyed())throw Error('The display is no longer available.');return (await target.capturePage(r)).toPNG().toString('base64')});
 ipcMain.handle('document-preview',(_,file,password)=>previewFile(file,password));
 ipcMain.handle('document-convert-path',(_,file)=>importFile(file));
 ipcMain.handle('document-open-default',async(_,file)=>{const error=await shell.openPath(file);if(error)throw Error(error)});
 ipcMain.handle('ocr-available',()=>available());
 ipcMain.handle('ocr-read',(e,{id,data,language})=>reader.read(Buffer.from(data,'base64'),{id,language,onProgress:phase=>{if(!e.sender.isDestroyed())e.sender.send('document-progress',{id,phase})}}));
 ipcMain.handle('ocr-cancel',(_,id)=>reader.cancel(id));
 ipcMain.handle('document-import',async(e,options={})=>{const choice=await dialog.showOpenDialog(getWin(),{title:'Import document',properties:['openFile'],filters:[{name:'Word and PDF',extensions:['docx','pdf']}]});if(choice.canceled)return null;return importFile(choice.filePaths[0],{...options,onProgress:phase=>e.sender.send('document-progress',{phase})});});
 ipcMain.handle('document-print-html',async(_,doc,options={})=>{if(!doc||typeof doc.text!=='string')throw Error('Invalid document');const prepared=await require('./print-images.cjs').preparePrint({...doc,assets:doc.assets||{},meta:doc.meta||{}},options.clean,(...args)=>call('image',...args));return printHtml(prepared);});
 ipcMain.handle('pdf-geometry',(_,options)=>require('./pdf-options.cjs').geometry(options));
 ipcMain.handle('document-export',async(_,doc,format,options={})=>{if(!['docx','pdf'].includes(format))throw Error('Unsupported export');const choice=await dialog.showSaveDialog(getWin(),{title:format==='docx'?'Export Word document':'Export PDF',defaultPath:(doc.path?doc.path.replace(/\.[^.]+$/, ''):doc.title||'Untitled')+'.'+format,filters:[{name:format==='docx'?'Word document':'PDF document',extensions:[format]}]});if(choice.canceled)return null;const exported=await exportFile(doc,choice.filePath,options);if(options.open)shell.openPath(exported).catch(()=>{});return exported;});
 app.on('before-quit',()=>{reader.dispose();if(helper&&!helper.isDestroyed())helper.destroy();});
}
module.exports={register,previewFile,importFile,importPDF,exportFile,reader,call,dispose:()=>{disposed=true;reader.dispose();helper?.destroy();helper=null;pendingHelper?.then(w=>{if(!w.isDestroyed())w.destroy();}).catch(()=>{});}};
