const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module');
const {NotesStore,digest,titleOf}=require('../src/notes-store.cjs'),notepadFormat=require('../src/notepad-format.cjs'),{keyPath,physicalPath}=require('../src/path-key.cjs');
test('opening and autosaving through a symlink edits its physical target and preserves the link',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-alias-save-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'Real.nm'),alias=path.join(root,'Alias.nm');await fs.writeFile(file,notepadFormat.encode({id:'alias-note',text:'Original',assets:{}}));
 try{await fs.symlink(file,alias);}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Symlink creation is unavailable');return;}throw error;}
 const source=await fs.readFile(require.resolve('../src/main.cjs'),'utf8'),notesStore=new NotesStore(path.join(root,'library')),context={fs,path,keyPath,physicalPath,notesStore,digest,titleOf,notepadFormat,notesIPC:{send(){}},require:createRequire(require.resolve('../src/main.cjs'))};
 const openStart=source.indexOf('async function openPath('),openEnd=source.indexOf("ipcMain.handle('open',",openStart),open=vm.runInNewContext('('+source.slice(openStart,openEnd).trim()+')',context);const opened=await open(alias);assert.equal(keyPath(opened.path),keyPath(file));
 const saveStart=source.indexOf('const documentWrites=new Map();'),saveEnd=source.indexOf("ipcMain.handle('save',",saveStart),save=vm.runInNewContext(source.slice(saveStart,saveEnd)+'\nsaveDocument',context);const saved=await save({...opened,text:'Edited through alias'},false,true);assert.equal(notepadFormat.decode(await fs.readFile(file)).text,'Edited through alias');assert.equal((await fs.lstat(alias)).isSymbolicLink(),true);assert.equal(saved.path,await fs.realpath(file));
});
test('reopening an externally moved note keeps its stable tab and protects a dirty buffer from changed bytes',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'notemind-moved-tab-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=await fs.readFile(require.resolve('../src/main.cjs'),'utf8'),renderer=await fs.readFile(require.resolve('../src/renderer.js'),'utf8'),addTab=renderer.split('\n').find(line=>line.startsWith('function addTab('));
 const notesStore=new NotesStore(path.join(root,'library')),context={fs,path,keyPath,physicalPath,notesStore,digest,titleOf,notepadFormat,notesIPC:{send(){}},require:createRequire(require.resolve('../src/main.cjs'))},openStart=source.indexOf('async function openPath('),openEnd=source.indexOf("ipcMain.handle('open',",openStart),open=vm.runInNewContext('('+source.slice(openStart,openEnd).trim()+')',context),saveStart=source.indexOf('const documentWrites=new Map();'),saveEnd=source.indexOf("ipcMain.handle('save',",saveStart),save=vm.runInNewContext(source.slice(saveStart,saveEnd)+'\nsaveDocument',context);
 for(const dirty of [false,true]){
  const before=path.join(root,(dirty?'dirty':'clean')+'-before.nm'),after=path.join(root,(dirty?'dirty':'clean')+'-after.nm');await fs.writeFile(before,notepadFormat.encode({id:dirty?'dirty-note':'clean-note',text:'Original disk text',assets:{}}));const opened=await open(before),tab={id:41,doc:{...opened,text:dirty?'Local pending edits':opened.text},dirty},oldRevision=opened.revision;await fs.rename(before,after);await fs.writeFile(after,notepadFormat.encode({...opened,text:'External changed text'}));const next=await open(after);assert.equal(next.id,opened.id);
  const state={crypto:require('node:crypto'),tabs:[tab],activeTab:tab,doc:tab.doc,nextTabId:41,next,source:{value:''},rich:{innerHTML:''},richChanged:false,notePathKey:value=>value,rememberCurrent(){},updateTitle(){},render:text=>text,window:{NoteMindNotes:{schedule(){}}},activateTab(value){state.activeTab=value;}};vm.runInNewContext(addTab+'\naddTab(next)',state);assert.equal(state.tabs.length,1);assert.equal(state.tabs[0],tab);assert.equal(tab.id,41);assert.equal(tab.doc.path,next.path);assert.equal(tab.doc.text,dirty?'Local pending edits':'External changed text');assert.equal(tab.doc.revision,dirty?oldRevision:next.revision);
  if(dirty){await assert.rejects(()=>save(tab.doc,false,true),/changed outside/);assert.equal(notepadFormat.decode(await fs.readFile(after)).text,'External changed text');}
 }
});

test('renderer preserves literal backslashes on POSIX and normalizes Windows paths',async()=>{
 const code=await fs.readFile(path.join(__dirname,'../src/renderer.js'),'utf8'),fn=code.match(/function notePathKey\(file\)\{[^\n]+\}/)[0];
 const vm=require('node:vm'),key=platform=>vm.runInNewContext(fn+';notePathKey',{window:{notemind:{platform}}});
 assert.notEqual(key('darwin')('/notes/a\\b.nm'),key('darwin')('/notes/a/b.nm'));
 assert.equal(key('win32')('C:\\Notes\\A.nm'),key('win32')('c:/notes/a.nm'));
});


test('Trash waits for a save that has already started resolving its file identity',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-save-trash-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'Concurrent.nm');await fs.writeFile(file,notepadFormat.encode({id:'queued-note',text:'Original',assets:{}}));const bytes=await fs.readFile(file),notesStore=new NotesStore(path.join(root,'library'));
 const source=await fs.readFile(require.resolve('../src/main.cjs'),'utf8'),context={fs,path,keyPath,physicalPath,notesStore,digest,titleOf,notepadFormat,notesIPC:{send(){}},require:createRequire(require.resolve('../src/main.cjs'))},start=source.indexOf('const documentWrites=new Map();'),end=source.indexOf("ipcMain.handle('save',",start),api=vm.runInNewContext(source.slice(start,end)+'\n({saveDocument,settleDocumentWrites})',context);
 let savedBeforeTrash=false;const save=api.saveDocument({path:file,id:'queued-note',revision:digest(bytes),text:'Pending autosave',assets:{}},false,true),trash=(async()=>{await api.settleDocumentWrites(file);savedBeforeTrash=notepadFormat.decode(await fs.readFile(file)).text==='Pending autosave';await fs.unlink(file);})();await Promise.all([save,trash]);assert.equal(savedBeforeTrash,true);await assert.rejects(fs.access(file),{code:'ENOENT'});
});
