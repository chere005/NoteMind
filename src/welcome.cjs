const {app,BrowserWindow,ipcMain,dialog}=require('electron'),path=require('node:path'),fs=require('node:fs/promises');
module.exports=function install(getMain,openPath,projectService){
 const {recents}=projectService;let window=null;
 const remember=(file,kind='file')=>recents.remember(file,kind);
 const reveal=()=>{const main=getMain();if(main){if(main.isMinimized())main.restore();main.show();main.focus();}window?.close();};
 const open=async file=>{const doc=await openPath(file);if(doc.workspace){getMain().webContents.send('workspace:open',doc.workspace);}else{getMain().webContents.send('file:open-request',file);await remember(file,'file');}reveal();};
 const rows=(list,kind)=>Promise.all(list.map(async x=>({path:x.path,name:path.basename(x.path,path.extname(x.path)),folder:path.dirname(x.path),kind:kind||path.extname(x.path).slice(1),exists:await fs.access(x.path).then(()=>true,()=>false)})));
 ipcMain.handle('start-info',async()=>{const all=await recents.read();return {version:app.getVersion(),files:await rows(all.files),projects:await rows(all.projects,'project')};});
 ipcMain.handle('start-workspace',reveal);
 ipcMain.handle('start-guide',()=>{getMain().webContents.send('menu:command','welcomeNote');reveal();});
 ipcMain.handle('start-open-path',(_,file)=>open(file));
 ipcMain.handle('start-forget',(_,file)=>recents.forget(file));
 ipcMain.handle('start-open',async()=>{const r=await dialog.showOpenDialog(window||getMain(),{properties:['openFile'],filters:[{name:'Documents and projects',extensions:['nm','wm','wmpr','md','txt','py','docx','pdf']}]});if(!r.canceled)await open(r.filePaths[0]);});
 ipcMain.handle('start-new-project',async()=>{const r=await dialog.showSaveDialog(window||getMain(),{defaultPath:'Project.wmpr',filters:[{name:'Project',extensions:['wmpr']}]});if(r.canceled)return;const project=await projectService.create(r.filePath);getMain().webContents.send('workspace:open',project);reveal();});
 const show=()=>{if(window&&!window.isDestroyed()){window.show();window.focus();return;}window=new BrowserWindow({width:780,height:520,minWidth:660,minHeight:420,title:'Welcome to NoteMind',icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});window.setMenuBarVisibility(false);window.on('closed',()=>{window=null;if(getMain()&&!getMain().isDestroyed()&&!getMain().isVisible())getMain().close();});window.loadFile(path.join(__dirname,'welcome.html'));};
 return {show,remember,dispose:()=>{if(window&&!window.isDestroyed())window.destroy();}};
};
