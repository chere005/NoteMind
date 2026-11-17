const {dialog, app, ipcMain} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {pack, unpack} = require('./zip.cjs');
module.exports = function installFeatures(window, projectService) {
 const win = () => window();
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
 ipcMain.handle('save-pane',async(_, sheet, svg, file)=>{
  const result=file?{filePath:file,canceled:false}:await dialog.showSaveDialog(win(),{defaultPath:'Drawing.nm',filters:[{name:'Notepad',extensions:['nm','wm']}]});if(result.canceled)return null;
  const dest=result.filePath, temp=dest+'.'+require('node:crypto').randomUUID()+'.tmp';
  const data=require('./notepad-format.cjs').encode({text:'![Drawing](assets/drawing.svg)\n',assets:{'assets/drawing.svg':svg,'assets/drawing.svg.json':Buffer.from(require('./graphics-pane.js').encode(sheet)).toString('base64')},meta:{graphicsPanes:{'assets/drawing.svg':{version:1}}}},{kind:'drawing',extra:{'drawing.json':{sheet:'assets/drawing.svg.json',image:'assets/drawing.svg'}}});
  try{await fs.writeFile(temp,data,{flag:'wx'});await fs.rename(temp,dest);}finally{await fs.unlink(temp).catch(()=>{});}return dest;
 });
 ipcMain.handle('open-pane',async()=>{
  const result=await dialog.showOpenDialog(win(),{properties:['openFile'],filters:[{name:'Notepad',extensions:['nm','wm']}]});if(result.canceled)return null;
  const data=require('./notepad-format.cjs').decode(await fs.readFile(result.filePaths[0])).files,info=data['drawing.json']?JSON.parse(data['drawing.json'].toString('utf8')):{},name=info.sheet||(data['assets/drawing.svg.json']?'assets/drawing.svg.json':'assets/drawing.json');if(!data[name])throw Error('This Notepad does not contain an editable drawing sheet.');return {file:result.filePaths[0],sheet:require('./graphics-pane.js').decode(data[name].toString('utf8'))};
 });
 ipcMain.handle('python-select',async()=>{const r=await dialog.showOpenDialog(win(),{title:'Select Python interpreter',properties:['openFile']});if(r.canceled)return null;await fs.writeFile(path.join(app.getPath('userData'),'python.json'),JSON.stringify({executable:r.filePaths[0]}));return r.filePaths[0];});
};

