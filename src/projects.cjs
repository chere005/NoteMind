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
  const source=await registry.prepareRename(project),target=path.join(path.dirname(source.file),name+'.wmpr');let renamed=false;
  if(!workspaces.sameFile(target,source.file)){
   try{await fs.lstat(target);throw Error('A project named '+name+' already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
   await source.check();let linked=false;
   try{await fs.link(source.file,target);linked=true;await source.check();await fs.unlink(source.file);renamed=true;}
   catch(error){if(linked)try{const named=await fs.lstat(target,{bigint:true});if(named.isFile()&&!named.isSymbolicLink()&&named.dev===source.stat.dev&&named.ino===source.stat.ino)await fs.unlink(target);}catch(cleanup){if(cleanup.code!=='ENOENT')error.renameCleanupError=cleanup.message;}throw error;}
  }
  const next={...project,...source.project,name,file:target,fileRevision:{path:require('./path-key.cjs').keyPath(target),hash:source.revision.hash}},warnings=[];
  try{await registry.put(next);}catch(error){if(!renamed)throw error;warnings.push('Project registry: '+error.message);}
  try{await recents.moved(project.file,target);}catch(error){if(!renamed)throw error;warnings.push('Recent projects: '+error.message);}
  return renamed?{...next,renameCommitted:true,...(warnings.length?{renameWarnings:warnings}:{})}:next;
 }
 return {home,root,registry,recents,defaultFile,open,create,rename,isProject};
};
