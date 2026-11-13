const fs=require('node:fs/promises'),path=require('node:path');
// Projects as the main process holds them: the registry of every project this machine has opened, the recents, and the
// one way a `.wmpr` (or an older `.wm` workspace) becomes a project value. `home` is shared by every window.
module.exports=function projects(home,root,migrationDir){
 const workspaces=require('./workspaces.cjs'),recents=require('./recents.cjs')(path.join(home,'recent.json'));
 const defaultFile=path.join(home,'Default Workspace.wmpr'),registry=workspaces.store(root,defaultFile,migrationDir);
 const isProject=file=>/\.wmpr$/i.test(file);
 async function open(file){
  file=path.resolve(file);
  let project;
  if(isProject(file))project=await workspaces.readProject(file,await registry.byFile(file));
  else{const bytes=await fs.readFile(file);project=await workspaces.convertLegacy(file,bytes);}
  await registry.put(project);
  await recents.remember(project.file,'project');
  return project;
 }
 // An empty project file, written at once; the name is the file's.
 async function create(file){
  file=path.resolve(file.toLowerCase().endsWith('.wmpr')?file:file+'.wmpr');
  try{await fs.access(file);throw Error('A project named '+path.basename(file)+' already exists there.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const project={id:workspaces.idFor(file),name:path.basename(file,'.wmpr'),folders:[],files:[],excluded:[],file};
  await workspaces.save(file,project);
  await registry.put(project);
  await recents.remember(file,'project');
  return project;
 }
 // The project's file takes a new name (the name is the file's), and the registry and recents follow it.
 async function rename(project,name){
  name=String(name||'').trim();
  if(!name||/[\\/:*?"<>|]/.test(name)||name==='.'||name==='..')throw Error('Choose a name without slashes or other special characters.');
  if(!project.file||project.id==='default')throw Error('This project cannot be renamed.');
  const target=path.join(path.dirname(project.file),name+'.wmpr');
  if(!workspaces.sameFile(target,project.file)){try{await fs.access(target);throw Error('A project named '+name+' already exists.');}catch(e){if(e.code!=='ENOENT')throw e;}await fs.rename(project.file,target);}
  const next={...project,name,file:target};
  await registry.put(next);
  await recents.moved(project.file,target);
  return next;
 }
 return {home,root,registry,recents,defaultFile,open,create,rename,isProject};
};
