const {app,dialog,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/projects-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
const notes=path.join(root,'My Notes'),made=path.join(root,'Made.wmpr');fs.mkdirSync(notes);fs.writeFileSync(path.join(notes,'One.md'),'# One\n');
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const defaultFile=path.join(root,'Default Workspace.wmpr'),read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
 const menuLabels=async()=>js(()=>[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].map(b=>b.getAttribute('data-menu-label')||b.textContent.replace(/\s*[▸›]\s*$/,'').trim()));
 const closeMenu=async()=>{await js(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await pause(60);};
 const rowNames=()=>js(()=>[...document.querySelectorAll('#tree .tree-row,#tree [data-path],#tree button')].map(x=>x.textContent.trim()));
 try{
  await pause(1100);
  const projects=Menu.getApplicationMenu().items.find(i=>i.label==='Projects');
  check(!!projects&&!Menu.getApplicationMenu().items.some(i=>i.label==='Workspaces'),'The menu bar has Projects in place of Workspaces');
  check(projects.submenu.items.find(i=>i.label==='New Project…').accelerator==='CmdOrCtrl+Shift+N'&&projects.submenu.items.find(i=>i.label==='Add Folder…').accelerator==='CmdOrCtrl+Shift+A','New Project and Add Folder have their shortcuts');

  dialog.showSaveDialog=async()=>({canceled:false,filePath:made});
  const project=await js(()=>window.notemind.workspaceNew());
  check(project.file===made&&project.name==='Made'&&fs.existsSync(made),'New Project writes an empty .wmpr named by its file');
  check(JSON.parse(read(made)).version===2&&JSON.parse(read(made)).files.length===0,'A new project file is version 2 with no files');
  const renamed=await js(project=>window.notemind.workspaceRename(project,'Renamed'),project);
  check(renamed.file===path.join(root,'Renamed.wmpr')&&fs.existsSync(renamed.file)&&!fs.existsSync(made)&&renamed.id===project.id,'Renaming a project renames its file and keeps its identity');
  const recent=await js(()=>window.notemind.workspaceRecent());
  check(recent.length===1&&recent[0].name==='Renamed'&&recent[0].exists,'Open Recent lists the project under its new name');
  const reopened=await js(file=>window.notemind.workspaceOpenPath(file),renamed.file);
  check(reopened.id===project.id&&reopened.name==='Renamed','Opening the file again finds the same project');

  await js(()=>document.getElementById('projectMenu').click());await pause(250);
  const labels=await menuLabels();
  for(const label of ['New Project…','Open Project…','Open Recent','Save Project As…','Rename Project…','Add to Project'])check(labels.includes(label),'Project menu offers '+label);
  check(!labels.some(l=>/Workspace/.test(l)&&l!=='Open Default Workspace'),'The project menu no longer says Workspace');
  await closeMenu();

  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[notes]});
  await js(()=>document.getElementById('chooseFolder').click());await pause(500);
  check(read(defaultFile).includes(JSON.stringify(notes)),'Adding a folder saves the Default Workspace file at once');
  check(await js(()=>document.body.innerText.includes('My Notes')&&document.body.innerText.includes('One.md')),'The added folder and its notes show in the sidebar');
  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'undoFile'})));await pause(500);
  check(!read(defaultFile).includes(JSON.stringify(notes)),'Undo takes the folder out of the project file again');
  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'redoFile'})));await pause(500);
  check(read(defaultFile).includes(JSON.stringify(notes)),'Redo puts the folder back');
  fs.writeFileSync(path.join(root,'projects.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>document.body.innerText.slice(0,600)).catch(()=>null);}
 fs.writeFileSync('test-results/projects.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
