const {dialog, app, ipcMain} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {pack, unpack} = require('./zip.cjs');
module.exports = function installFeatures(window, projectService) {
 const win = () => window();
 const drawingSaves=require('./drawing-save-transport.cjs').installDrawingSaveTransport(ipcMain);app.on('will-quit',()=>drawingSaves.dispose());
 ipcMain.on('window-close',()=>win()?.close());
 const {home,root,registry,recents}=projectService;
 const preferenceKeys=['orientation','pen','view','padChromeOrientation'];
 let folderWatches=[],folderKey='',folderTimer;
 ipcMain.handle('watch-folders',(_,folders)=>{if(!Array.isArray(folders)||folders.some(f=>typeof f!=='string'))throw Error('Invalid folders');const key=folders.join('\n');if(key===folderKey)return;folderKey=key;folderWatches.forEach(w=>w.close());folderWatches=[];for(const folder of folders){try{const watcher=require('node:fs').watch(folder,{recursive:true},()=>{clearTimeout(folderTimer);folderTimer=setTimeout(()=>{const w=win();if(w&&!w.isDestroyed())w.webContents.send('folders-changed');},150);});watcher.on('error',()=>{});folderWatches.push(watcher);}catch{}}});
 app.on('will-quit',()=>{folderWatches.forEach(w=>w.close());clearTimeout(folderTimer);});
 const preferenceFile=key=>path.join(home,'preferences',key+'.json');
 const readPreference=async key=>{if(!preferenceKeys.includes(key))throw Error('Invalid preference');try{return JSON.parse(await fs.readFile(preferenceFile(key),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 ipcMain.handle('preference-get',(_,key)=>readPreference(key));
 const preferenceWrites=new Map();
 ipcMain.handle('preference-set',async(_,key,value)=>{
  if(!preferenceKeys.includes(key))throw Error('Invalid preference');
  const next=(preferenceWrites.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(preferenceFile(key)),{recursive:true});const temp=preferenceFile(key)+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(value));await fs.rename(temp,preferenceFile(key));}finally{await fs.unlink(temp).catch(()=>{});}});
  preferenceWrites.set(key,next);try{await next;}finally{if(preferenceWrites.get(key)===next)preferenceWrites.delete(key);}
 });
 app.whenReady().then(async()=>{await fs.mkdir(path.join(home,'preferences'),{recursive:true});const watcher=require('node:fs').watch(path.join(home,'preferences'),(_,file)=>{const key=String(file).replace(/\.json$/,'');if(!preferenceKeys.includes(key))return;readPreference(key).then(value=>{const w=win();if(w&&!w.isDestroyed())w.webContents.send('preference-changed',{key,value});}).catch(()=>{});});app.on('will-quit',()=>watcher.close());});
 ipcMain.handle('workspace-list',()=>registry.migrate());
 ipcMain.handle('workspace-put',(_,workspace,remove)=>registry.put(workspace,remove));
 ipcMain.handle('workspace-save',async(_,workspace)=>{const result=await dialog.showSaveDialog(win(),{defaultPath:(workspace.id==='default'?'Project':workspace.name)+'.wmpr',filters:[{name:'Project',extensions:['wmpr']}]});if(result.canceled)return null;const file=result.filePath.toLowerCase().endsWith('.wmpr')?result.filePath:result.filePath+'.wmpr';const saved={...workspace,id:require('./workspaces.cjs').idFor(file),name:path.basename(file,'.wmpr'),file,readOnly:false};await registry.put(saved);await recents.remember(file,'project');return saved;});
 ipcMain.handle('workspace-new',async()=>{const result=await dialog.showSaveDialog(win(),{defaultPath:'Project.wmpr',filters:[{name:'Project',extensions:['wmpr']}]});return result.canceled?null:projectService.create(result.filePath);});
 ipcMain.handle('workspace-rename',(_,workspace,name)=>projectService.rename(workspace,name));
 ipcMain.handle('workspace-open-path',(_,file)=>projectService.open(file));
 ipcMain.handle('workspace-recent',async()=>{const all=await recents.read();return Promise.all(all.projects.map(async x=>({path:x.path,name:path.basename(x.path,path.extname(x.path)),exists:await fs.access(x.path).then(()=>true,()=>false)})));});
 ipcMain.handle('workspace-open',async()=>{const result=await dialog.showOpenDialog(win(),{properties:['openFile'],filters:[{name:'Project',extensions:['wmpr','wm']}]});return result.canceled?null:projectService.open(result.filePaths[0]);});
 ipcMain.handle('choose-files',async()=>{const result=await dialog.showOpenDialog(win(),{properties:['openFile','multiSelections'],filters:[{name:'Notepads and text files',extensions:['nm','wm','md','txt','py']}]});return result.canceled?[]:result.filePaths;});
 ipcMain.handle('workspace-seed', async () => { try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'workspace.json'),'utf8')); } catch { return null; } });
 ipcMain.handle('workspace-window', async (_, workspace) => {
  if (!workspace || !/^[a-zA-Z0-9-]+$/.test(workspace.id) || !Array.isArray(workspace.folders)) throw Error('Invalid workspace');
  await registry.put(workspace);if(workspace.file)await recents.remember(workspace.file,'project');
  const profile = workspace.id==='default'?home:path.join(root,workspace.id); await fs.mkdir(profile,{recursive:true});
  await fs.writeFile(path.join(profile,'workspace.json'),JSON.stringify(workspace));
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const child = spawn(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,NOTEMIND_DATA:profile,NOTEMIND_HOME:home,NOTEMIND_WORKSPACES:root}});
  child.unref();
  return child.pid;
 });
 ipcMain.handle('export-image', async (_, data, extension='png') => {
  if(!['png','svg'].includes(extension)) throw Error('Unsupported image type');
  const result=await dialog.showSaveDialog(win(),{defaultPath:`Drawing.${extension}`,filters:[{name:'Image',extensions:[extension]}]});
  if(result.canceled)return null;
  await fs.writeFile(result.filePath,Buffer.from(data,'base64'));return result.filePath;
 });
 ipcMain.handle('save-pane',async(event,sheet,svg,file,options)=>{
  const graphics=require('./graphics-pane.js'),token=sheet&&Object.hasOwn(sheet,'drawingUpload')?sheet.drawingUpload:null;let lease,sidecar;
  try{
   if(token!==null){if(Object.keys(sheet).length!==1||typeof token!=='string'||svg!==null)throw Error('Invalid uploaded drawing sheet.');lease=drawingSaves.consume(event?.sender,token);lease.check();}
   else if(sheet&&Object.hasOwn(sheet,'encodedGraphics')){const value=sheet.encodedGraphics;if(Object.keys(sheet).length!==1||typeof value!=='string'||!value.length||value.length%4!==0||value.length>Math.ceil(graphics.MAX_BINARY_BYTES/3)*4||Buffer.from(value.slice(0,12),'base64').subarray(0,8).toString('ascii')!==graphics.BINARY_MAGIC||!/^[a-z0-9+/]*={0,2}$/i.test(value.slice(-4)))throw Error('Invalid encoded drawing sheet.');sidecar=value;}else sidecar=graphics.encodeBase64(sheet);
   const result=file?{filePath:file,canceled:false}:await dialog.showSaveDialog(win(),{defaultPath:'Drawing.nm',filters:[{name:'Notepad',extensions:['nm','wm']}]});if(result.canceled)return null;lease?.check();
   const dest=require('./path-key.cjs').physicalPath(result.filePath),guard=require('./guarded-write.cjs'),versioned=options?.versioned===true,expected=file&&versioned&&options.expected?options.expected:await guard.fingerprintFile(dest),codec=require('./archive-codec.cjs');
   const encoded=lease?await codec.encodeDrawingOwned(lease.payload):await codec.encodeWithDigest({text:'![Drawing](assets/drawing.svg)\n',assets:{'assets/drawing.svg':svg,'assets/drawing.svg.json':sidecar},meta:{graphicsPanes:{'assets/drawing.svg':{version:1}}}},{kind:'drawing',extra:{'drawing.json':{sheet:'assets/drawing.svg.json',image:'assets/drawing.svg'}}});lease?.check();
   const data=encoded.bytes;await guard.replaceIfUnchanged(dest,data,expected);return versioned?{file:dest,revision:{sha256:encoded.revision,bytes:data.length}}:dest;
  }finally{if(lease)lease.release();else if(token!==null){try{drawingSaves.cancel(event?.sender,token)}catch{}}}
 });
 ipcMain.handle('open-pane',async(event,options)=>{
  const result=await dialog.showOpenDialog(win(),{properties:['openFile'],filters:[{name:'Notepad',extensions:['nm','wm']}]});if(result.canceled)return null;
  const file=require('./path-key.cjs').physicalPath(result.filePaths[0]),bytes=await require('./read-limited.cjs').readLimited(file,require('./archive-limits.cjs').TOTAL_BYTES,'This Notepad is too large.'),owned=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?new Uint8Array(bytes.buffer):Uint8Array.from(bytes),drawing=await require('./archive-codec.cjs').inspectDrawingOwned(owned);
  if(!options?.compact&&drawing.encodedSheet.byteLength<=1024*1024)return {file,fileRevision:drawing.fileRevision,sheet:require('./graphics-pane.js').decode(drawing.encodedSheet)};
  const transfer=require('./sheet-load-transport.cjs').shared.beginFor(event.sender,{encodedSheets:[{metadata:{},bytes:drawing.encodedSheet}]},{scope:'drawing',maxBytes:150*1024*1024});return {file,fileRevision:drawing.fileRevision,transfer};
 });
 ipcMain.handle('python-select',async()=>{const r=await dialog.showOpenDialog(win(),{title:'Select Python interpreter',properties:['openFile']});if(r.canceled)return null;await fs.writeFile(path.join(app.getPath('userData'),'python.json'),JSON.stringify({executable:r.filePaths[0]}));return r.filePaths[0];});
};

