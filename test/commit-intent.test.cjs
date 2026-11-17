const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {NotesStore,digest}=require('../src/notes-store.cjs'),format=require('../src/notepad-format.cjs');
const vm=require('node:vm'),raw=require('node:fs'),{createRequire}=require('node:module');
const mainFile=require.resolve('../src/main.cjs'),mainSource=raw.readFileSync(mainFile,'utf8'),relative=createRequire(mainFile);
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-commit-intent-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,file:path.join(root,'note.nm'),store:new NotesStore(path.join(root,'library'))};}
test('a committed-file receipt survives clean-draft failure and restart without replacing dirty recovery content',async t=>{
 const {root,file,store}=await fixture(t),doc=await store.draft({path:file,text:'Unsaved writing',assets:{},dirty:true,revision:'old-revision'}),stateFile=path.join(store.recoveryRoot,doc.id+'.json'),before=JSON.parse(await fs.readFile(stateFile)),bytes=format.encode(doc),revision=digest(bytes);
 await store.recordCommitIntent(doc,file,revision);const intent=JSON.parse(await fs.readFile(stateFile));assert.equal(intent.recoveryId,before.recoveryId);assert.equal(intent.dirty,true);assert.equal(intent.revision,'old-revision');assert.deepEqual(intent.pendingCommit,{path:file,revision});
 await fs.writeFile(file,bytes);const rename=fs.rename;t.mock.method(fs,'rename',async(from,to)=>{if(to===path.join(store.recoveryRoot,doc.id+'.wm'))throw Object.assign(Error('clean recovery failed'),{code:'EIO'});return rename(from,to)});await assert.rejects(store.draft({...doc,dirty:false,revision}),/clean recovery failed/);
 const restored=await new NotesStore(path.join(root,'library')).loadDraft(doc.id);assert.equal(restored.text,doc.text);assert.equal(restored.dirty,false);assert.equal(restored.pendingCommit,undefined);assert.equal(restored.revision,revision);assert.equal(digest(await fs.readFile(file)),restored.revision);
});
test('later complete recovery generations invalidate older commit receipts',async t=>{
 const {file,store}=await fixture(t),doc=await store.draft({path:file,text:'First',assets:{},dirty:true});await store.recordCommitIntent(doc,file,'a'.repeat(64));const first=await store.loadDraft(doc.id);assert.ok(first.pendingCommit);
 await store.draft({...doc,text:'Later writing',dirty:true,revision:'b'.repeat(64)});const later=await store.loadDraft(doc.id);assert.equal(later.pendingCommit,undefined);assert.notEqual(later.recoveryId,first.recoveryId);assert.equal(later.text,'Later writing');
});
test('direct saved documents acquire a modern recovery generation before recording an intent',async t=>{
 const {file,store}=await fixture(t),doc=await store.register({path:file,text:'First save',assets:{}});await store.recordCommitIntent(doc,file,'a'.repeat(64));const restored=await store.loadDraft(doc.id);assert.equal(restored.text,doc.text);assert.equal(restored.dirty,true);assert.ok(restored.recoveryId);assert.equal(restored.pendingCommit.revision,'a'.repeat(64));
 await assert.rejects(store.recordCommitIntent({...doc,id:'../escape'},file,'a'.repeat(64)),/Invalid document commit/);await assert.rejects(store.recordCommitIntent(doc,'relative.nm','a'.repeat(64)),/Invalid document commit/);await assert.rejects(store.recordCommitIntent(doc,file,'invalid'),/Invalid document commit/);
});
test('reopening after a committed save and failed clean recovery adopts only the matching file revision',async t=>{
 const {root,file:unresolved,store}=await fixture(t),file=path.join(await fs.realpath(root),'note.nm'),initial={id:'receipt-note',path:file,text:'Before',assets:{},meta:{}},original=format.encode(initial);await fs.writeFile(file,original);
 const doc=await store.draft({...initial,revision:digest(original),dirty:true}),draft=store.draft.bind(store);let failClean=true;
 store.draft=async value=>{if(value.dirty===false&&failClean){failClean=false;throw Object.assign(Error('clean recovery unavailable'),{code:'EIO'});}return draft(value);};
 const context={fs,path,Buffer,digest,physicalPath:value=>value,keyPath:value=>value,notesStore:store,notesIPC:{send(){}},notepadFormat:format,dialog:{},win:null,titleOf:()=> 'Receipt note',Promise,Map,require:relative};
 vm.runInNewContext(mainSource.slice(mainSource.indexOf('const documentWrites='),mainSource.indexOf("ipcMain.handle('save',")),context);
 const saved=await context.saveDocument({...doc,text:'Committed latest writing'},false,true);assert.equal(saved.recoverySaved,false);assert.match(saved.saveWarnings[0],/clean recovery unavailable/);
 const committed=await fs.readFile(file);assert.equal(format.decode(committed).text,'Committed latest writing');
 context.notesStore=new NotesStore(path.join(root,'library'));
 vm.runInNewContext(mainSource.slice(mainSource.indexOf('async function openPath('),mainSource.indexOf("ipcMain.handle('open',")),context);
 const reopened=await context.openPath(file);assert.equal(reopened.text,'Committed latest writing');assert.equal(reopened.revision,digest(committed));const recovered=await context.notesStore.loadDraft(doc.id);assert.equal(recovered.text,'Committed latest writing');assert.equal(recovered.dirty,false);assert.equal(recovered.pendingCommit,undefined);await context.notesStore.session({tabs:[{id:doc.id,path:file}],active:doc.id});assert.equal((await context.notesStore.recover()).tabs[0].text,'Committed latest writing');
 const next=await context.saveDocument({...reopened,text:'Next edit after restart'},false,true);assert.equal(next.revision,digest(await fs.readFile(file)));assert.equal(next.recoverySaved,true);
 const dirty=await context.notesStore.draft({...next,dirty:true});await context.notesStore.recordCommitIntent(dirty,file,next.revision);
 const external=format.encode({...next,text:'External writing'});await fs.writeFile(file,external);
 const conflicted=await context.openPath(file);assert.equal(conflicted.revision,next.revision);assert.notEqual(conflicted.revision,digest(external));
 await assert.rejects(context.saveDocument({...conflicted,text:'Must not overwrite external writing'},false,true),/changed|modified|conflict/i);assert.deepEqual(await fs.readFile(file),external);
});
test('a save cannot attach its receipt to a newer recovery generation',async t=>{
 const {file,store}=await fixture(t),first=await store.draft({path:file,text:'Captured save',assets:{},dirty:true}),newer=await store.draft({...first,text:'Newer writing'});
 assert.notEqual(newer.recoveryId,first.recoveryId);await assert.rejects(store.recordCommitIntent(first,file,'a'.repeat(64)),/recovery draft changed/);
 const kept=await store.loadDraft(first.id);assert.equal(kept.text,'Newer writing');assert.equal(kept.recoveryId,newer.recoveryId);assert.equal(kept.pendingCommit,undefined);
});
test('legacy direct saves upgrade an older recovery body to their matching captured input',async t=>{
 const {file,store}=await fixture(t),first=await store.draft({path:file,text:'Older recovery',assets:{},dirty:true}),direct={...first,text:'Direct save'};delete direct.recoveryId;
 const receipt=await store.recordCommitIntent(direct,file,'a'.repeat(64)),kept=await store.loadDraft(first.id);assert.equal(kept.text,'Direct save');assert.equal(kept.recoveryId,receipt.recoveryId);assert.notEqual(kept.recoveryId,first.recoveryId);
});
