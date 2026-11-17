const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const workspaces=require('../src/workspaces.cjs'),projectfile=require('../src/projectfile.cjs');
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'notemind-legacy-project-collision-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'Project.wm'),legacy={id:'legacy-project',name:'Project',folders:[path.join(root,'Original notes')],files:[path.join(root,'Plan.md')],excluded:[path.join(root,'Original notes','Hidden')]},bytes=workspaces.encode(legacy);await fs.writeFile(file,bytes);return {root,file,legacy,bytes};}

test('legacy conversion skips valid unrelated project siblings and preserves their bytes',async t=>{
 const f=await fixture(t),targets=[path.join(f.root,'Project.wmpr'),path.join(f.root,'Project 2.wmpr')],originals=[];
 for(const [i,file]of targets.entries()){const text=projectfile.write({file,folders:[path.join(f.root,'Different notes '+i)],files:[],extra:{keep:'unrelated'}});originals.push(text);await fs.writeFile(file,text);}
 const converted=await workspaces.convertLegacy(f.file,f.bytes);assert.equal(converted.file,path.join(f.root,'Project 3.wmpr'));assert.deepEqual(converted.folders,f.legacy.folders);assert.deepEqual(converted.files,f.legacy.files);assert.deepEqual(converted.excluded,f.legacy.excluded);assert.equal(converted.extra.notemindLegacy.id,f.legacy.id);
 for(const [i,file]of targets.entries())assert.equal(await fs.readFile(file,'utf8'),originals[i]);assert.deepEqual(await fs.readFile(f.file),f.bytes);
 // Once converted, reopening the legacy source follows edits made to that conversion.
 await workspaces.save(converted.file,{...converted,folders:[path.join(f.root,'Updated notes')]});const reopened=await workspaces.convertLegacy(f.file,f.bytes);assert.equal(reopened.file,converted.file);assert.deepEqual(reopened.folders,[path.join(f.root,'Updated notes')]);
});

test('equivalent conversions from older versions reopen without rewriting their project file',async t=>{
 const f=await fixture(t),target=path.join(f.root,'Project.wmpr'),text=JSON.stringify({version:2,folders:['Original notes','Original notes'],files:['Plan.md'],excluded:['Original notes/Hidden'],custom:'kept'});await fs.writeFile(target,text);
 const reopened=await workspaces.convertLegacy(f.file,f.bytes);assert.equal(reopened.file,target);assert.equal(reopened.id,f.legacy.id);assert.deepEqual(reopened.folders,f.legacy.folders);assert.equal(await fs.readFile(target,'utf8'),text);
});
