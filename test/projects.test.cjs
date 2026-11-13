const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const workspaces=require('../src/workspaces.cjs'),projects=require('../src/projects.cjs');
const temp=async()=>fs.mkdtemp(path.join(os.tmpdir(),'notemind-projects-'));
const service=async()=>{const dir=await temp(),home=path.join(dir,'home');await fs.mkdir(home);return {dir,home,service:projects(home,path.join(home,'workspaces'))};};

test('a project saves itself as a .wmpr with relative paths and keeps its id when reopened',async()=>{
 const {dir,service:s}=await service();
 try{
  const file=path.join(dir,'Book.wmpr'),notes=path.join(dir,'Notes'),outside=path.join(os.tmpdir(),'elsewhere-note.md');
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
