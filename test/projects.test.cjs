const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const workspaces=require('../src/workspaces.cjs'),projects=require('../src/projects.cjs');
const temp=async()=>fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'notemind-projects-')));
const service=async()=>{const dir=await temp(),home=path.join(dir,'home');await fs.mkdir(home);return {dir,home,service:projects(home,path.join(home,'workspaces'))};};

test('a project saves itself as a .wmpr with relative paths and keeps its id when reopened',async()=>{
 const {dir,service:s}=await service();
 try{
  const file=path.join(dir,'Book.wmpr'),notes=path.join(dir,'Notes'),outside=path.join(await fs.realpath(os.tmpdir()),'elsewhere-note.md');
  await s.registry.put({id:'book',name:'Book',folders:[notes],files:[outside],excluded:[],file,order:{[notes]:['b.wm','a.wm']}});
  const text=await fs.readFile(file,'utf8');
  assert.match(text,/"folders" : \[\n    "Notes"\n  \]/);assert.ok(text.includes(JSON.stringify(outside)));assert.ok(!text.includes('order'));
  const opened=await s.open(file);
  assert.equal(opened.id,'book');assert.equal(opened.name,'Book');assert.deepEqual(opened.folders,[notes]);assert.deepEqual(opened.order,{[notes]:['b.wm','a.wm']});
  assert.deepEqual((await s.recents.read()).projects.map(x=>x.path),[file]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('the Default Workspace saves itself in the app folder with absolute paths',async()=>{
 const {dir,home,service:s}=await service();
 try{
  const notes=path.join(dir,'Notes');
  await s.registry.put({id:'default',name:'Default Workspace',folders:[notes],files:[]});
  const text=await fs.readFile(path.join(home,'Default Workspace.wmpr'),'utf8');
  assert.ok(text.includes(JSON.stringify(notes)));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('opening an older .wm workspace writes a .wmpr beside it and leaves the old file alone',async()=>{
 const {dir,service:s}=await service();
 try{
  const old=path.join(dir,'Old.wm'),bytes=workspaces.encode({id:'legacy',name:'Old',folders:[path.join(dir,'Notes')],files:[]});
  await fs.writeFile(old,bytes);
  const first=await s.open(old);
  assert.equal(first.file,path.join(dir,'Old.wmpr'));assert.equal(first.id,'legacy');assert.deepEqual(first.folders,[path.join(dir,'Notes')]);
  assert.deepEqual(await fs.readFile(old),bytes);
  const again=await s.open(old);assert.equal(again.file,first.file);
  await fs.writeFile(path.join(dir,'Other.wmpr'),'not a project');
  await fs.writeFile(path.join(dir,'Other.wm'),workspaces.encode({id:'two',name:'Other',folders:[],files:[]}));
  assert.equal((await s.open(path.join(dir,'Other.wm'))).file,path.join(dir,'Other 2.wmpr'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('renaming a project renames its file, keeps its id and moves its place in the recents',async()=>{
 const {dir,service:s}=await service();
 try{
  const made=await s.create(path.join(dir,'First'));
  assert.equal(made.file,path.join(dir,'First.wmpr'));await assert.rejects(()=>s.create(path.join(dir,'First.wmpr')),/already exists/);
  await s.create(path.join(dir,'Taken.wmpr'));
  await assert.rejects(()=>s.rename(made,'Taken'),/already exists/);await assert.rejects(()=>s.rename(made,'a/b'),/special/);await assert.rejects(()=>s.rename({id:'default',name:'D'},'X'),/cannot be renamed/);
  const next=await s.rename(made,'Second');
  assert.equal(next.id,made.id);assert.equal(next.name,'Second');await fs.access(path.join(dir,'Second.wmpr'));await assert.rejects(()=>fs.access(path.join(dir,'First.wmpr')));
  assert.ok((await s.recents.read()).projects.some(x=>x.path===next.file));assert.ok(!(await s.recents.read()).projects.some(x=>x.path===made.file));
  assert.equal((await s.registry.byFile(next.file)).id,made.id);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('a project written by a newer version is shown but never written',async()=>{
 const {dir,service:s}=await service();
 try{
  const file=path.join(dir,'Future.wmpr'),text='{"files":[],"folders":["Notes"],"version":3}';await fs.writeFile(file,text);
  const project=await s.open(file);assert.equal(project.readOnly,true);
  await s.registry.put({...project,folders:[]});assert.equal(await fs.readFile(file,'utf8'),text);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('recents hold twelve of each kind, newest first, and read the older single list',async()=>{
 const dir=await temp();
 try{
  const file=path.join(dir,'recent.json'),r=require('../src/recents.cjs')(file);
  for(let i=0;i<15;i++)await r.remember(path.join(dir,'n'+i+'.wm'));
  await r.remember(path.join(dir,'n3.wm'));await r.remember(path.join(dir,'P.wmpr'),'project');
  const all=await r.read();assert.equal(all.files.length,12);assert.equal(all.files[0].path,path.join(dir,'n3.wm'));assert.equal(all.projects.length,1);
  await fs.writeFile(file,JSON.stringify([{path:'/a.wm',name:'a',kind:'wm'},{path:'/p.wm',name:'p',kind:'project'}]));
  const old=await r.read();assert.deepEqual(old.files.map(x=>x.path),['/a.wm']);assert.deepEqual(old.projects.map(x=>x.path),['/p.wm']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('registry-only projects migrate without losing identity, paths, or existing files',async()=>{
 const {dir,home,service:s}=await service(),folder=path.join(dir,'Projects');
 try{
  const legacy={id:'legacy-1',name:'Old project',folders:[path.join(dir,'Notes')],files:[path.join(dir,'note.md')],excluded:[path.join(dir,'Notes','Hidden')],order:{x:['a']}};
  await s.registry.put(legacy);
  const registry=workspaces.store(path.join(home,'workspaces'),s.defaultFile,folder);
  const [migrated]=await registry.migrate();
  assert.equal(migrated.id,legacy.id);assert.equal(path.basename(migrated.file),'Old project.wmpr');
  assert.deepEqual((await workspaces.readProject(migrated.file,migrated)).excluded,legacy.excluded);
  assert.deepEqual(migrated.order,legacy.order);
  assert.deepEqual(await registry.migrate(),[migrated]);
  await registry.put({...legacy,folders:[...legacy.folders,path.join(dir,'More')]});
  assert.equal((await registry.list())[0].file,migrated.file);
  assert.equal((await workspaces.readProject(migrated.file,migrated)).folders.length,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('project saves preserve external changes and allow an explicit reopen',async t=>{
 const {dir,service:s}=await service();t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'External.wmpr');await s.create(file);const stale=await s.open(file),external='{"version":2,"folders":["External Folder"],"files":[]}';await fs.writeFile(file,external);
 await assert.rejects(()=>s.registry.put({...stale,files:[path.join(dir,'local.nm')]}),/changed outside/);assert.equal(await fs.readFile(file,'utf8'),external);
 const fresh=await s.open(file);assert.deepEqual(fresh.folders,[path.join(dir,'External Folder')]);await s.registry.put({...fresh,files:[path.join(dir,'local.nm')]});assert.deepEqual((await workspaces.readProject(file)).folders,fresh.folders);
});
test('repeated renderer snapshots accept this window saves but reject another window changes',async t=>{
 const {dir,home,service:s}=await service();t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'Windows.wmpr');await s.create(file);const renderer=structuredClone(await s.open(file));await s.registry.put({...renderer,files:[path.join(dir,'one.nm')]});await s.registry.put({...renderer,files:[path.join(dir,'one.nm'),path.join(dir,'two.nm')]});
 const other=projects(home,path.join(home,'workspaces')),otherView=await other.open(file);await other.registry.put({...otherView,folders:[path.join(dir,'Other window')]});const protectedText=await fs.readFile(file,'utf8');await assert.rejects(()=>s.registry.put({...renderer,files:[]}),/changed outside/);assert.equal(await fs.readFile(file,'utf8'),protectedText);
});
test('legacy registry entries acquire revisions without overwriting externally edited projects',async t=>{
 const {dir,home}=await service();t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'Legacy.wmpr'),entry={id:'legacy',name:'Legacy',file,folders:[],files:[],excluded:[]},root=path.join(home,'workspaces');await fs.mkdir(root,{recursive:true});await fs.writeFile(file,require('../src/projectfile.cjs').write(entry));await fs.writeFile(path.join(root,'index.json'),JSON.stringify([entry]));
 const first=projects(home,root);await first.registry.put({...entry,files:[path.join(dir,'one.nm')]});assert.ok((await first.registry.list())[0].fileRevision?.hash);
 const existing=await first.registry.list();delete existing[0].fileRevision;await fs.writeFile(path.join(root,'index.json'),JSON.stringify(existing));await fs.writeFile(file,'{"version":2,"folders":["External"],"files":[]}');const next=projects(home,root);await assert.rejects(()=>next.registry.put({...existing[0],files:[]}),/changed outside/);assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')).folders,['External']);
});
test('an external project edit during temporary-file writing is preserved',async t=>{
 const {dir,service:s}=await service();t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'Racing.wmpr');await s.create(file);const project=await s.open(file),write=fs.writeFile,external='{"version":2,"folders":["External"],"files":[]}';let injected=false;
 t.mock.method(fs,'writeFile',async(target,data,options)=>{await write(target,data,options);if(!injected&&String(target).startsWith(file+'.')&&String(target).endsWith('.tmp')){injected=true;await write(file,external);}});
 await assert.rejects(()=>s.registry.put({...project,files:[path.join(dir,'ours.nm')]}),/changed outside/);assert.equal(injected,true);assert.equal(await fs.readFile(file,'utf8'),external);
});
test('the Default Workspace can explicitly reopen external changes without changing identity',async t=>{
 const {dir,service:s}=await service();t.after(()=>fs.rm(dir,{recursive:true,force:true}));await s.registry.put({id:'default',name:'Default Workspace',folders:[],files:[]});await fs.writeFile(s.defaultFile,'{"version":2,"folders":["External"],"files":[]}');const reopened=await s.open(s.defaultFile);assert.equal(reopened.id,'default');assert.deepEqual(reopened.folders,[path.join(path.dirname(s.defaultFile),'External')]);await s.registry.put({...reopened,files:[path.join(dir,'added.nm')]});assert.deepEqual((await workspaces.readProject(s.defaultFile)).folders,reopened.folders);
});
test('project aliases open and save the physical project without replacing their symbolic links',async t=>{
 const {dir,service:s}=await service();t.after(()=>fs.rm(dir,{recursive:true,force:true}));const real=path.join(dir,'real'),links=path.join(dir,'links');await fs.mkdir(real);await fs.mkdir(links);const file=path.join(real,'Original.wmpr'),alias=path.join(links,'Alias.wmpr'),made=await s.create(file);
 try{await fs.symlink(file,alias);}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Symlink creation is unavailable');return;}throw error;}
 const opened=await s.open(alias);assert.equal(opened.file,file);assert.equal(opened.id,made.id);await s.registry.put({...opened,folders:[path.join(real,'Notes')]});assert.equal((await fs.lstat(alias)).isSymbolicLink(),true);assert.deepEqual((await workspaces.readProject(file)).folders,[path.join(real,'Notes')]);
 const direct={...await workspaces.readProject(file),file:alias,files:[path.join(real,'note.nm')]};await workspaces.save(alias,direct);assert.equal(direct.file,file);assert.equal((await fs.lstat(alias)).isSymbolicLink(),true);assert.deepEqual((await workspaces.readProject(file)).files,[path.join(real,'note.nm')]);
});
