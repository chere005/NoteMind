const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {NotesStore,titleOf}=require('../src/notes-store.cjs'),format=require('../src/notepad-format.cjs'),render=require('../src/document-renderer.cjs');
test('draft recovery, metadata, smart filters, and versions survive a fresh store',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-store-')),store=new NotesStore(root);
 const doc=await store.draft({text:'# Weekend\n\n- [ ] Buy groceries',assets:{'assets/test.svg':Buffer.from('<svg/>').toString('base64')},meta:{tags:['home','home'],pinned:true,collapsed:['0:Weekend']},dirty:true,visual:false});
 await store.session({tabs:[{id:doc.id,visual:false}],active:doc.id});await store.version(doc,'First draft');await store.version({...doc,text:'# New text'},'Updated');
 const reopened=new NotesStore(root),recovery=await reopened.recover();assert.equal(recovery.tabs[0].text,doc.text);assert.equal(recovery.tabs[0].dirty,true);assert.equal(recovery.tabs[0].visual,false);assert.equal(recovery.active,doc.id);assert.deepEqual(recovery.tabs[0].meta.tags,['home']);
 const settings=await reopened.settings({folder:{name:'Household',tags:['home'],checklists:true,attachments:true,pinned:true,days:7}});assert.equal((await reopened.list({smartId:settings.smartFolders[0].id})).length,1);assert.equal((await reopened.list({query:'groceries'})).length,1);
 await reopened.indexText(doc.id,{'assets/test.svg':{hash:'test',text:'handwritten birthday list'}});assert.equal((await new NotesStore(root).list({query:'birthday'})).length,1);
 const versions=await reopened.versions(doc.id);assert.equal(versions.length,2);assert.equal((await reopened.versionDoc(doc.id,versions[0].id)).text,doc.text);assert.equal(titleOf('\n# Weekend\n\nBody'),'Weekend');
});
test('persistent deleted items restore safely and reject occupied targets',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-delete-')),store=new NotesStore(path.join(root,'store')),file=path.join(root,'one.wm');await fs.writeFile(file,'original');const doc=await store.register({path:file,text:'Original',assets:{}}),item=await store.captureDeleted(file);await fs.unlink(file);await store.finishDeleted(item);
 assert.equal((await store.list({})).length,0);const next=new NotesStore(path.join(root,'store'));assert.equal((await next.deleted()).length,1);await fs.writeFile(file,'replacement');await assert.rejects(()=>next.restoreDeleted(item.id),/already exists/);assert.equal(await fs.readFile(file,'utf8'),'replacement');const to=path.join(root,'restored.wm');await next.restoreDeleted(item.id,to);assert.equal(await fs.readFile(to,'utf8'),'original');assert.equal((await next.record(doc.id)).path,to);assert.equal((await next.deleted()).length,0);
});
test('deleted drafts preserve content and cannot return through recovery or stale autosave',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-deleted-draft-')),store=new NotesStore(root),assets={'assets/ink.svg':Buffer.from('<svg>ink</svg>').toString('base64')};
 try{
  const doc=await store.draft({text:'# Latest writing',title:'My draft',manualTitle:true,assets,meta:{tags:['work'],pinned:true},dirty:true,visual:false});
  await store.session({tabs:[{id:doc.id,visual:false}],active:doc.id});const deleted=await store.deleteDraft(doc.id),restarted=new NotesStore(root,path.join(root,'another-window'));
  assert.equal((await restarted.list()).length,0);assert.equal((await store.recover()).tabs.length,0);await restarted.reconcileDeleted(path.join(root,'unrelated.nm'));assert.equal((await restarted.deleted()).length,1);
  await assert.rejects(()=>store.draft(doc),/Recently Deleted/);await assert.rejects(()=>store.loadDraft(doc.id),/Recently Deleted/);
  assert.deepEqual(await restarted.restoreDeleted(deleted),{draft:doc.id});const restored=await restarted.loadDraft(doc.id);
  assert.equal(restored.text,doc.text);assert.deepEqual(restored.assets,assets);assert.equal(restored.manualTitle,true);assert.equal(restored.visual,false);assert.equal(restored.meta.pinned,true);assert.equal((await restarted.deleted()).length,0);
  const file=path.join(root,'Saved.nm');await fs.writeFile(file,format.encode(doc));const saved=await store.register({...doc,id:undefined,path:file});
  await assert.rejects(()=>store.deleteDraft(saved.id),/Move to Trash/);
  const item=await store.captureDeleted(file);await fs.unlink(file);await store.finishDeleted(item);await assert.rejects(()=>store.draft(saved),/Recently Deleted/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('concurrent library instances preserve updates and copies get distinct identities',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-concurrent-')),a=new NotesStore(root),b=new NotesStore(root);await Promise.all(Array.from({length:12},(_,i)=>(i%2?a:b).register({text:'Note '+i,assets:{}})));assert.equal((await a.list({})).length,12);
 const p=path.join(root,'original.wm'),q=path.join(root,'copy.wm');await fs.writeFile(p,'one');await fs.writeFile(q,'two');const one=await a.register({path:p,text:'one',assets:{}}),two=await b.register({...one,path:q});assert.notEqual(one.id,two.id);await a.rename(p,path.join(root,'moved.wm'));assert.equal((await a.record(one.id)).path,path.join(root,'moved.wm'));
});
test('an interrupted empty library lock does not delay recovery',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-lock-')),store=new NotesStore(root);
 try{const lock=path.join(root,'.lock');await fs.writeFile(lock,'');const old=new Date(Date.now()-2000);await fs.utimes(lock,old,old);await store.draft({text:'Recovered promptly',assets:{}});assert.equal((await store.list()).length,1);await assert.rejects(()=>fs.access(lock),{code:'ENOENT'});}
 finally{await fs.rm(root,{recursive:true,force:true});}
});
test('writing and attachment markup round trips without editor decoration',()=>{
 const text='# Heading\n\n- [ ] Open\n- [x] Done\n    - Nested\n\n==Marked==\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n[Report](assets/report.pdf)\n\n[Linked note](notemind:abc)',assets={'assets/report.pdf':Buffer.from('PDF').toString('base64')},meta={attachments:{'assets/report.pdf':{title:'Report',pages:3}}};const html=render.render(text,assets,meta);assert.match(html,/type="checkbox"/);assert.match(html,/<mark>Marked<\/mark>/);assert.match(html,/data-attachment/);const back=render.toMarkdown(html.replace('Heading','Heading<button data-editor-control="fold">▾</button>'));assert.match(back,/-\s+\[ \]\s+Open/);assert.match(back,/-\s+\[x\]\s+Done/);assert.match(back,/==Marked==/);assert.match(back,/\[Report\]\(assets\/report.pdf\)/);assert.ok(!back.includes('▾'));assert.match(back,/notemind:abc/);const decoded=format.decode(format.encode({text,assets,meta}));assert.equal(decoded.meta.attachments['assets/report.pdf'].pages,3);
});
test('Word export and import retain interactive tasks and highlighting',async()=>{
 const {exportWord,importWord}=require('../src/documents.cjs');const bytes=await exportWord({text:'- [ ] Open\n- [x] Done\n\n==A highlight==',assets:{}}),back=await importWord(bytes);assert.match(back.text,/\[ \]/);assert.match(back.text,/\[x\]/);assert.match(back.text,/==A highlight==/);
});
