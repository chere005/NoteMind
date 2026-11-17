const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const projects=require('./projectfile.cjs');
const {keyPath}=require('./path-key.cjs');
const revisionOf=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const freshProjects=new WeakSet();
const conflict=()=>Error('The project changed outside this window. Reopen it before saving your project changes.');
async function physicalPath(file){const absolute=path.resolve(file);try{return await fs.realpath(absolute);}catch(error){if(error.code!=='ENOENT')throw error;try{return path.join(await fs.realpath(path.dirname(absolute)),path.basename(absolute));}catch{return absolute;}}}
const physicalReference=file=>path.isAbsolute(file)&&!(process.platform==='win32'&&/^\/(?!\/)/.test(file))?keyPath(file):file;

function valid(workspace){return workspace && /^[a-zA-Z0-9-]+$/.test(workspace.id) && typeof workspace.name==='string' && Array.isArray(workspace.folders) && workspace.folders.every(x=>typeof x==='string') && (!workspace.files || (Array.isArray(workspace.files)&&workspace.files.every(x=>typeof x==='string')));}

const folded=keyPath;
const sameFile=(a,b)=>!!a&&!!b&&folded(a)===folded(b);
// A project file keeps its registry entry (and so its window profile) however it is renamed; a new one gets an id from its path.
const idFor=file=>crypto.createHash('sha1').update(folded(file)).digest('hex').slice(0,32);

// `defaultFile`: where the Default Workspace saves itself (absolute paths only, since that file never moves).
function store(root,defaultFile,migrationDir){

 let pending=Promise.resolve();const revisions=new Map();

 const registry=path.join(root,'index.json');

 const lock=async()=>{for(let i=0;i<100;i++){try{return await fs.open(registry+'.lock','wx');}catch(e){if(e.code!=='EEXIST')throw e;try{const stat=await fs.stat(registry+'.lock');if(Date.now()-stat.mtimeMs>30000)await fs.unlink(registry+'.lock');}catch{}await new Promise(r=>setTimeout(r,30));}}throw Error('Workspace is busy; try again.');};

 const list=async()=>{try{return JSON.parse(await fs.readFile(registry,'utf8')).filter(valid);}catch(e){if(e.code==='ENOENT')return [];throw e;}};

 const put=(workspace,remove=false)=>{if(!valid(workspace))return Promise.reject(Error('Invalid workspace'));const task=pending.catch(()=>{}).then(async()=>{
  await fs.mkdir(root,{recursive:true});const guard=await lock();
  try{
   const previous=await list(),known=previous.find(x=>x.id===workspace.id);if(!workspace.file&&known?.file&&known.migratedRegistry)workspace={...workspace,file:known.file,migratedRegistry:true};
   const items=previous.filter(x=>x.id!==workspace.id);
   if(!remove){
    items.push(workspace);const target=workspace.id==='default'?defaultFile:workspace.file;
    if(target&&!workspace.readOnly){
     const key=keyPath(target),given=workspace.fileRevision?.path===key?workspace.fileRevision.hash:null,own=revisions.get(key);let expectedRevision;
     // A renderer can send another edit before receiving the prior save's new revision. Only this store's own
     // successful saves form that lineage; changes from another window or an external editor still conflict.
     if(!freshProjects.has(workspace)&&own?.accepted.has(given))expectedRevision=own.current;
     else if(given)expectedRevision=given;
     else if(known){
      if(known.fileRevision?.path===key)expectedRevision=known.fileRevision.hash;
      else{
       let bytes;try{bytes=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
       if(bytes){let unchanged=false;try{const onDisk=await readProject(target);unchanged=projects.write(onDisk)===projects.write({...known,file:target});}catch{}if(!unchanged)throw conflict();expectedRevision=revisionOf(bytes);}else expectedRevision=null;
      }
     }
     const writing=workspace.id==='default'?{...workspace,file:null}:workspace;
     await save(target,writing,{target,expectedRevision});workspace.fileRevision=writing.fileRevision;
     const accepted=new Set(own?.accepted||[]);accepted.add(given);accepted.add(workspace.fileRevision.hash);revisions.set(key,{current:workspace.fileRevision.hash,accepted});freshProjects.delete(workspace);
    }
   }
   const temp=registry+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(items),{flag:'wx'});await fs.rename(temp,registry);}finally{await fs.unlink(temp).catch(()=>{});}return items;
  }finally{await guard.close();await fs.unlink(registry+'.lock').catch(()=>{});}
 });pending=task;return task;};

 // Migrate registry-only projects while holding the same lock used for ordinary saves.
 const migrate=()=>{const task=pending.catch(()=>{}).then(async()=>{
  if(!migrationDir)return list();
  await fs.mkdir(root,{recursive:true});const guard=await lock();
  try{
   const items=await list();let changed=false;
   for(const project of items){
    if(project.id==='default'||project.file)continue;
    await fs.mkdir(migrationDir,{recursive:true});
    const stem=project.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').trim().replace(/[. ]+$/,'')||'Project';
    for(let n=1;;n++){
     const folder=path.join(migrationDir,stem+' ('+project.id+(n===1?'':'-'+n)+')');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,stem+'.wmpr');
     const next={...project,file};const data=projects.write(next);
     try{await fs.writeFile(file,data,{flag:'wx'});project.file=file;project.migratedRegistry=true;changed=true;break;}
     catch(e){if(e.code!=='EEXIST')throw e;if(await fs.readFile(file,'utf8')===data){project.file=file;project.migratedRegistry=true;changed=true;break;}}
    }
   }
   if(changed){const temp=registry+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(items),{flag:'wx'});await fs.rename(temp,registry);}finally{await fs.unlink(temp).catch(()=>{});}}
   return items;
  }finally{await guard.close();await fs.unlink(registry+'.lock').catch(()=>{});}
 });pending=task;return task;};

 const byFile=async file=>(await list()).find(x=>sameFile(x.file||(x.id==='default'?defaultFile:null),file));

 return {list,put,byFile,migrate};

}

function encode(workspace){if(!valid(workspace))throw Error('Invalid workspace');return require('./notepad-format.cjs').encode({text:'# '+workspace.name+'\n\nWorkspace folders and files are linked from their current locations.\n',assets:{}},{kind:'workspace',extra:{'workspace.json':workspace}});}

function decode(buffer){const files=require('./notepad-format.cjs').decode(buffer).files;if(!files['workspace.json'])throw Error('This Notepad does not contain a workspace.');const workspace=JSON.parse(files['workspace.json'].toString('utf8'));if(!valid(workspace))throw Error('Invalid workspace');delete workspace.file;return workspace;}

// A project is a `.wmpr`; an older NoteMind workspace file (`.wm`) is still written as it was until it is converted.
async function save(file,workspace,{target=file,expectedRevision}={}){
 file=await physicalPath(file);target=await physicalPath(target);
 const extension=path.extname(target).toLowerCase();
 if(extension!=='.wmpr'&&extension!=='.wm'&&extension!=='.nm')throw Error('Choose a .wmpr project file.');
 const writing={...workspace,file:workspace.file===null?null:file,folders:workspace.folders.map(physicalReference),files:(workspace.files||[]).map(physicalReference),excluded:(workspace.excluded||[]).map(physicalReference)};
 const data=extension==='.wmpr'?projects.write(writing):encode(workspace);
 let previous;try{previous=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 const before=previous?revisionOf(previous):null;
 if(expectedRevision===undefined&&workspace.fileRevision?.path===keyPath(target))expectedRevision=workspace.fileRevision.hash;
 if(expectedRevision!==undefined&&before!==expectedRevision)throw conflict();
 const temp=target+'.'+crypto.randomUUID()+'.tmp';
 try{await fs.writeFile(temp,data,{flag:'wx'});let current;try{current=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}if((current?revisionOf(current):null)!==before)throw conflict();await fs.rename(temp,target);}finally{await fs.unlink(temp).catch(()=>{});}
 workspace.fileRevision={path:keyPath(target),hash:revisionOf(data)};
 if(workspace.file)workspace.file=file;
}

// The project in a `.wmpr`; `known` is the registry entry for the same file, which keeps its id and the hand-kept sidebar order.
async function readProject(file,known){
 file=await physicalPath(file);
 const bytes=await fs.readFile(file),project=projects.read(bytes.toString('utf8'),path.resolve(file),known?.id||idFor(file));
 project.fileRevision={path:keyPath(file),hash:revisionOf(bytes)};freshProjects.add(project);
 if(known?.order)project.order=known.order;
 return project;
}

// Opening an older `.wm` workspace converts it: `<stem>.wmpr` is written beside it and the old file is left as it was.
async function convertLegacy(file,buffer){
 const old=decode(buffer),stem=path.join(path.dirname(path.resolve(file)),path.basename(file,path.extname(file)));
 let target=stem+'.wmpr';
 for(let n=2;;n++){
  try{const text=await fs.readFile(target,'utf8');if(projects.parse(text))return {...await readProject(target),id:old.id};}catch(e){if(e.code!=='ENOENT')throw e;break;}
  target=stem+' '+n+'.wmpr';
 }
 const converted={...old,name:path.basename(target,'.wmpr'),file:target};
 await save(target,converted);
 return converted;
}
module.exports={store,valid,encode,decode,save,readProject,convertLegacy,idFor,sameFile};
