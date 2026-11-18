(() => {
 const api=window.NoteMindDocumentSync?.api(window.notemind.notes)||window.notemind.notes;
 let ready=false,timer=null,queue=Promise.resolve(),indexTimers=new Map(),closingDrafts=new Map(),closedDrafts=new WeakMap(),startupRun=null,importTargetDepth=0;
 const automaticTitleInfo=text=>{for(let at=0;at<=text.length;){const end=text.indexOf('\n',at),line=text.slice(at,end<0?text.length:end).replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ x]\]\s*)?)/i,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/[*_`=]/g,'').trim();if(line)return{title:line.slice(0,100),end:end<0?text.length:end,found:true};if(end<0)break;at=end+1;}return{title:'Untitled',end:text.length,found:false};};
 const automaticTitle=text=>automaticTitleInfo(text).title;
 const serial=fn=>{const next=queue.then(fn);queue=next.then(()=>{},()=>{});return next;};
 function adoptDraft(tab,saved){for(const key of ['id','created','recoveryId'])if(Object.hasOwn(saved,key))tab.doc[key]=saved[key];}
 function adoptCommitted(tab,error){const receipt=error?.committed;if(!receipt)return false;for(const key of ['id','path','revision','created','recoveryId'])if(Object.hasOwn(receipt,key))tab.doc[key]=receipt[key];tab.dirty=true;if(tab===activeTab)dirty=true;tab.draftStamp=null;tab.saveError=error.message;updateTitle();return true}
 function snapshot(tab){if(tab===activeTab)rememberCurrent();return {...tab.doc,assets:window.NoteMindDocumentSync?.copyAssets(tab.doc.assets)||{...tab.doc.assets},meta:structuredClone(tab.doc.meta||{}),dirty:tab.dirty,visual:tab.visual};}
 function captureDurable(tab,value=snapshot(tab)){return window.NoteMindPDFReferences?.captureSnapshot(tab,value)||value;}
 async function prepareDurable(tab,value){return window.NoteMindPDFReferences?.prepareSnapshot(tab,value)||value;}
 function captureInsertion(){ensureActiveTab();const tab=activeTab;rememberCurrent();window.NoteMindHistory?.initialize(tab);let range=null;if(visual)try{const selected=getSelection();range=selected?.rangeCount&&rich.contains(selected.anchorNode)?selected.getRangeAt(0).cloneRange():carets.get(tab.id)?.cloneRange();}catch{}return {tab,text:tab.doc.text,start:visual?null:source.selectionStart,end:visual?null:source.selectionEnd,range};}
 function createImportTarget(value){importTargetDepth++;try{addTab(value);return captureInsertion();}finally{importTargetDepth--;}}
 function insertionTab(target){const tab=target?.tab;if(!tab||!tabs.includes(tab))throw Error('The original Notepad is no longer open.');if(tab.doc.path&&!/\.(nm|wm|md)$/i.test(tab.doc.path))throw Error('Save the original Notepad as a .nm or .md file before inserting graphics or attachments.');return tab;}
 function insertionState(target){const tab=target?.tab;if(!tab||!tabs.includes(tab))throw Error('The original Notepad is no longer open.');return {tab,document:tab.doc,revision:tab.editVersion||0,text:tab===activeTab?currentText():tab.doc.text,assets:tab.doc.assets,meta:tab.doc.meta,visual:tab===activeTab?visual:tab.visual};}
 function restoreInsertion(target){const same=currentText()===target.text;if(visual){let range;if(same&&target.range&&rich.contains(target.range.startContainer))range=target.range.cloneRange();else{range=document.createRange();range.selectNodeContents(rich);range.collapse(false);}carets.set(target.tab.id,range.cloneRange());return range;}const start=same&&target.start!==null?target.start:source.value.length,end=same&&target.end!==null?target.end:start;source.setSelectionRange(start,end);return null;}
 function insertTextFor(target,text,{focus=true}={}){const tab=target?.tab;if(!tab||!tabs.includes(tab))throw Error('The original Notepad is no longer open.');if(tab===activeTab){const range=restoreInsertion(target),inserted=insertText(text,{focus,range});target.text=currentText();target.start=target.end=!visual?source.selectionEnd:null;if(visual)target.range=inserted?.range?.cloneRange()||carets.get(tab.id)?.cloneRange()||null;else target.range=null;}
  else{const same=tab.doc.text===target.text,start=same&&target.start!==null?target.start:tab.doc.text.length,end=same&&target.end!==null?target.end:start;tab.doc.text=tab.doc.text.slice(0,start)+text+tab.doc.text.slice(end);tab.dirty=true;changed(tab);updateTitle();target.text=tab.doc.text;target.start=target.end=start+text.length;target.range=null;}return true;
 }

 function createPageImport(target,{createPageImport:create}={}){
  if(typeof create!=='function')throw Error('PDF import accounting is unavailable.');const tab=target?.tab;if(!tab||!tabs.includes(tab))throw Error('The original Notepad is no longer open.');
  const root=()=>tab===activeTab&&visual?rich:null;let titleProof=null,pendingTitle=null;const titles=new WeakMap();
  return create({target,document,acceptState:after=>{if(pendingTitle)titleProof={...pendingTitle,state:after};pendingTitle=null;},projectDocument:(value,change)=>{let title=value.title,proof;if(!value.path&&!value.manualTitle){const before=change.before,prior=titleProof?.state,reuse=titleProof?.found&&prior&&prior.document===before.document&&prior.revision===before.revision&&prior.epoch===before.epoch&&prior.text===before.text&&change.start>=titleProof.end&&(change.start>titleProof.end||change.text.startsWith('\n'));proof=reuse?titleProof:automaticTitleInfo(value.text);title=proof.title;}const result={...value,title,dirty:true,visual:tab===activeTab?visual:tab.visual};if(proof)titles.set(result,proof);return result;},serialize:html=>NoteMindDocument.toMarkdown(html),root,range:()=>target.range,readStamp:()=>({document:tab.doc,revision:tab.editVersion||0,path:tab.doc.path,id:tab.doc.id,title:tab.doc.title,created:tab.doc.created,documentRevision:tab.doc.revision,manualTitle:tab.doc.manualTitle,dirty:tab.dirty,assets:tab.doc.assets,meta:tab.doc.meta,active:tab===activeTab,visual:tab===activeTab?visual:tab.visual,text:tab===activeTab&&!visual?source.value:tab.doc.text}),readState:({forceVisual=false}={})=>{const value=insertionState(target);if(forceVisual&&root())value.text=NoteMindDocument.toMarkdown(rich.innerHTML);return value;},publish:(plan,mutate)=>{
   if(!tabs.includes(tab))throw Error('The original Notepad is no longer open.');const history=window.NoteMindHistory,ownership=history?.captureImport?.(tab,plan.before);if(!ownership)history?.initialize(tab);
   for(const node of plan.pageNodes)for(const image of node.querySelectorAll?.('img[data-asset]')||[]){const name=image.getAttribute('data-asset'),holder=document.createElement('div');holder.innerHTML=NoteMindDocument.render('![Image]('+name+')',plan.document.assets,plan.meta,window.NoteMindImagePreviews?.url,window.NoteMindImagePreviews?.size);const rendered=holder.querySelector('img[data-asset]');if(rendered)image.replaceWith(rendered.closest('.graphics-pane')||rendered);}

   for(const[name,data]of Object.entries(plan.add))Object.defineProperty(tab.doc.assets,name,{value:data,enumerable:true,writable:true,configurable:true});window.NoteMindDocumentSync?.copyHints(plan.add,tab.doc.assets);tab.doc.meta=plan.meta;tab.doc.text=plan.document.text;
   if(tab===activeTab){if(visual){if(!mutate())rich.innerHTML=render(plan.document.text);richChanged=false;}else{source.setRangeText(plan.text,plan.start,plan.end,'preserve');tab.doc.text=source.value;}dirty=true;}
   tab.dirty=true;changed(tab,{history:!ownership,titleOverride:plan.document.title,scheduleSave:false});pendingTitle=titles.get(plan.document)||null;if(ownership)history.recordImport(tab,ownership,{assetsChanged:Object.keys(plan.add).length>0,metadataChange:plan.metadataChange});updateTitle();target.text=tab.doc.text;target.start=target.end=plan.cursor;target.range=null;if(root()&&plan.mutation?.afterPage?.parentNode===rich){const range=document.createRange();range.setStartAfter(plan.mutation.afterPage);range.collapse(true);target.range=range;carets.set(tab.id,range.cloneRange());}
  }});
 }

 function insertMarkdownFor(target,text,{assets={},attachment=null,graphic=null}={}){const tab=insertionTab(target);window.NoteMindAssetAdmission?.admit(tab.doc.assets,{add:assets,chunks:(owned,name)=>window.NoteMindDocumentSync?.assetChunks(owned,name)});window.NoteMindHistory?.initialize(tab);for(const[name,data]of Object.entries(assets))Object.defineProperty(tab.doc.assets,name,{value:data,enumerable:true,writable:true,configurable:true});window.NoteMindDocumentSync?.copyHints(assets,tab.doc.assets);tab.doc.meta ||= {};if(attachment){tab.doc.meta.attachments ||= {};Object.defineProperty(tab.doc.meta.attachments,attachment.name,{value:attachment.info,enumerable:true,writable:true,configurable:true});}if(graphic){tab.doc.meta.graphicsPanes ||= {};Object.defineProperty(tab.doc.meta.graphicsPanes,graphic,{value:{version:1},enumerable:true,writable:true,configurable:true});}
  if(tab===activeTab){restoreInsertion(target);window.NoteMindWriting.insertMarkdown(text);target.text=currentText();target.start=target.end=!visual?source.selectionEnd:null;try{target.range=getSelection()?.rangeCount?getSelection().getRangeAt(0).cloneRange():null;}catch{}}
  else{const same=tab.doc.text===target.text,start=same&&target.start!==null?target.start:tab.doc.text.length,end=same&&target.end!==null?target.end:start;tab.doc.text=tab.doc.text.slice(0,start)+text+tab.doc.text.slice(end);tab.dirty=true;changed(tab);updateTitle();target.text=tab.doc.text;target.start=target.end=start+text.length;target.range=null;}
  return true;
 }
 function insertAssetFor(target,name,data,sheet=null,sidecar=null,sidecarChunks=null,imageChunks=null){const tab=insertionTab(target);if(tab===activeTab){restoreInsertion(target);const inserted=imageChunks?insertAsset(name,data,sheet,sidecar,sidecarChunks,imageChunks):sidecarChunks?insertAsset(name,data,sheet,sidecar,sidecarChunks):insertAsset(name,data,sheet,sidecar);if(inserted){target.text=currentText();target.start=target.end=!visual?source.selectionEnd:null;try{target.range=getSelection()?.rangeCount?getSelection().getRangeAt(0).cloneRange():null;}catch{}}return inserted;}const assets={[name]:data};if(imageChunks)window.NoteMindDocumentSync?.hint(assets,name,data,imageChunks);if(sidecar){assets[name+'.json']=sidecar;window.NoteMindDocumentSync?.hint(assets,name+'.json',sidecar,sidecarChunks)}else if(sheet)assets[name+'.json']=NoteMindGraphics.encodeBase64(sheet);return insertMarkdownFor(target,'\n\n!['+(sheet||sidecar?'Drawing':'Image')+']('+name+')\n\n',{assets,graphic:name});}
 async function session(){const pending=[...closingDrafts.values()].filter(job=>!job.persisted).map(job=>job.tab),kept=[...new Set([...tabs,...pending])];await api.session({tabs:kept.filter(t=>!t.placeholder).map(t=>({id:t.doc.id,path:t.doc.path,visual:t.visual,scroll:t===activeTab?window.NoteMindScroll?.anchor():t.scroll})),active:activeTab?.doc.id});}
 const assertDraftDurable=value=>{if(value?.durabilityWarning||value?.durabilityConfirmed===false)throw Error(value.durabilityWarning||'The latest recovery draft disk durability could not be confirmed.');return value;};
 async function persist(tab,saveFile=true,{requireDurable=false}={}){
  if(tab.placeholder)return;
  let retryRecovery=false;const captured=captureDurable(tab),edit=tab.editVersion||0,snap=await prepareDurable(tab,captured);
  if(!snap.path&&!snap.manualTitle)snap.title=automaticTitle(snap.text);
  const stamp=JSON.stringify([edit,snap.path,snap.revision,snap.visual]);const kept=tab.draftStamp===stamp?snap:assertDraftDurable(await api.draft(snap));tab.draftStamp=stamp;
  adoptDraft(tab,kept);if(!tabs.includes(tab))return;
  if(edit===(tab.editVersion||0))tab.doc.title=kept.title;
  if(saveFile&&tab.dirty&&snap.path){try{
   const saved=await api.autosave({...snap,id:kept.id,recoveryId:kept.recoveryId,otherOpenPaths:tabs.filter(t=>t!==tab&&t.doc.path).map(t=>t.doc.path)});retryRecovery=!!requireDurable&&(saved.recoverySaved===false||saved.saveWarnings?.some(warning=>/^Recovery:/.test(warning)));
   for(const key of ['id','path','revision','created','recoveryId'])if(Object.hasOwn(saved,key))tab.doc[key]=saved[key];
   if(edit===(tab.editVersion||0)){const rewritten=saved.text!==snap.text;Object.assign(tab.doc,saved);tab.dirty=false;const closing=closingDrafts.get(tab);if(closing&&closing.editVersion===edit)closing.saved=saved;if(tab===activeTab){dirty=false;richChanged=false;source.value=saved.text;if(rewritten){rich.innerHTML=render(saved.text);decorate();}}}
   else if(!closingDrafts.has(tab))adoptDraft(tab,assertDraftDurable(await api.draft(await prepareDurable(tab,captureDurable(tab)))));
   if(edit===(tab.editVersion||0)&&saved.recoverySaved)tab.draftStamp=JSON.stringify([edit,saved.path,saved.revision,snap.visual]);
   tab.saveError=saved.saveWarnings?.join('; ')||null;if(tab===activeTab)$('status').textContent=tab.saveError?'Saved · '+tab.saveError:'Autosaved';
  }catch(error){const committed=adoptCommitted(tab,error);retryRecovery ||=!!requireDurable&&committed;tab.saveError=error.message;if(tab===activeTab)$('status').textContent=committed?error.message:'Draft recovered locally · '+error.message;}}
  else if(tab===activeTab&&tab.dirty)$('status').textContent='Draft saved';
  if(retryRecovery&&tabs.includes(tab)){const latestEdit=tab.editVersion||0,latest=await prepareDurable(tab,captureDurable(tab)),saved=assertDraftDurable(await api.draft(latest));adoptDraft(tab,saved);tab.draftStamp=latestEdit===(tab.editVersion||0)?JSON.stringify([latestEdit,latest.path,latest.revision,latest.visual]):null;}
 }
 function reopenClosing(next){for(const job of closingDrafts.values()){const tab=job.tab;if(next.id&&next.id===tab.doc.id||next.path&&tab.doc.path&&notePathKey(next.path)===notePathKey(tab.doc.path)){job.reopened=true;return tab;}}return null;}
 const closeStamp=tab=>JSON.stringify([tab.editVersion||0,tab.visual,tab.doc.id,tab.doc.path,tab.doc.revision,tab.doc.recoveryId]);
 function closeDraft(tab,captured,onFailure){
  closedDrafts.delete(tab);
  if(tab.placeholder)return Promise.resolve(null);captureDurable(tab,captured);const kept={...captured,assets:window.NoteMindDocumentSync?.copyAssets(captured.assets)||{...captured.assets},meta:structuredClone(captured.meta||{})},existing=closingDrafts.get(tab);window.NoteMindPDFReferences?.copyCapture(captured,kept);
  if(existing){Object.assign(existing,{captured:kept,editVersion:tab.editVersion||0,onFailure,reopened:false,saved:null,persisted:false,generation:existing.generation+1});return existing.promise;}
  const job={tab,captured:kept,editVersion:tab.editVersion||0,onFailure,generation:0,persisted:false,promise:null};closingDrafts.set(tab,job);
  job.promise=serial(async()=>{try{
   if(startupRun&&!ready)await startupRun;
   for(;;){const generation=job.generation,reopened=job.reopened&&tabs.includes(tab),latest=reopened?captureDurable(tab):{...(job.saved||job.captured),dirty:tab.dirty};if(!reopened)window.NoteMindPDFReferences?.copyCapture(job.saved||job.captured,latest);for(const key of ['id','path','revision','created','recoveryId'])if(Object.hasOwn(tab.doc,key))latest[key]=tab.doc[key];
    const preparedEdit=tab.editVersion||0,prepared=await prepareDurable(tab,latest);if(generation!==job.generation)continue;if(!reopened||preparedEdit===(tab.editVersion||0)){tab.doc={...prepared};if(reopened&&tab===activeTab)doc=tab.doc;}const saved=assertDraftDurable(await api.draft(prepared));adoptDraft(tab,saved);if(generation!==job.generation)continue;job.persisted=true;
    await session();if(generation===job.generation){if(!tabs.includes(tab))closedDrafts.set(tab,{document:tab.doc,stamp:closeStamp(tab)});return saved;}job.persisted=false;
   }
  }catch(error){tab.saveError=error.message;job.onFailure?.(error);throw error;}finally{closingDrafts.delete(tab);}});
  return job.promise;
 }
 function schedule(delay=700){if(!ready)return;clearTimeout(timer);timer=setTimeout(()=>{timer=null;void flush().catch(error=>$('status').textContent='Could not save draft: '+error.message);},delay);}
 function flushRevision(){const revision=[ready,...tabs.flatMap(tab=>[tab,tab.doc,tab.editVersion||0,tab.visual,tab.dirty])];for(const job of closingDrafts.values())revision.push(job.tab,job.generation,job.editVersion,job.persisted);return revision;}

 async function flush({requireDurable=false}={}){if(startupRun&&!ready)await startupRun;ensureActiveTab();return serial(async()=>{for(const tab of [...tabs])await persist(tab,true,{requireDurable});await session();updateTitle();window.notemind.dirty(tabs.some(tab=>tab.dirty),!activeTab.placeholder);});}
 async function flushTarget(target,{requireDurable=false}={}){
  const tab=target?.tab;if(!tab)throw Error('The original Notepad is no longer open.');if(startupRun&&!ready)await startupRun;let joining=closingDrafts.get(tab);
  for(;;){
   // A close can be queued behind this request. Join its promise only outside
   // the serial callback, otherwise neither owner can reach durable storage.
   if(joining)await joining.promise;
   const next=await serial(async()=>{
    const closing=closingDrafts.get(tab);if(closing)return closing;
    if(!tabs.includes(tab)){const kept=closedDrafts.get(tab);if(kept&&kept.document===tab.doc&&kept.stamp===closeStamp(tab))return null;throw Object.assign(Error('The original Notepad is no longer open.'),{name:'AbortError'});}
    await persist(tab,true,{requireDurable});if(closingDrafts.has(tab))return closingDrafts.get(tab);
    await session();if(closingDrafts.has(tab))return closingDrafts.get(tab);updateTitle();window.notemind.dirty(tabs.some(value=>value.dirty),!!activeTab&&!activeTab.placeholder);return null;
   });
   if(!next)return;joining=next;
  }
 }
 function changed(tab,{history=true,titleOverride,scheduleSave=true}={}){closedDrafts.delete(tab);tab.hadImageAssets ||= Object.keys(tab.doc.assets||{}).some(n=>NoteMindDocument.mime(n)||/\.pdf$/i.test(n));tab.placeholder=false;if(history)window.NoteMindHistory?.record(tab);tab.saveError=null;tab.editVersion=(tab.editVersion||0)+1;if(history)window.NoteMindHistory?.confirmRevision?.(tab);if(!tab.doc.path&&!tab.doc.manualTitle)tab.doc.title=typeof titleOverride==='string'?titleOverride:automaticTitle(tab===activeTab?currentText():tab.doc.text);if(scheduleSave)schedule();clearTimeout(indexTimers.get(tab));indexTimers.set(tab,setTimeout(()=>{indexTimers.delete(tab);if(ready&&tabs.includes(tab)&&tab.doc.id&&tab.hadImageAssets)void api.indexImages(snapshot(tab),{background:true}).then(result=>{if(tab===activeTab)$('status').textContent=result.errors.length?'Image search: '+result.errors.join('; '):'Image search updated';}).catch(error=>$('status').textContent='Image search: '+error.message);},3500));}
 async function saveActive(saveAs=false){if(startupRun&&!ready)await startupRun;ensureActiveTab();const tab=activeTab;clearTimeout(timer);return serial(async()=>{
  await persist(tab,false);const captured=captureDurable(tab),edit=tab.editVersion||0,snap=await prepareDurable(tab,captured);
  let saved;try{saved=await (window.NoteMindDocumentSync?.save||window.notemind.save)({...snap,otherOpenPaths:tabs.filter(t=>t!==tab&&t.doc.path).map(t=>t.doc.path)},saveAs)}catch(error){adoptCommitted(tab,error);throw error}if(!saved)return false;
  for(const key of ['id','path','revision','created','recoveryId'])if(Object.hasOwn(saved,key))tab.doc[key]=saved[key];
  if(edit===(tab.editVersion||0)){Object.assign(tab.doc,saved);tab.dirty=false;const closing=closingDrafts.get(tab);if(closing&&closing.editVersion===edit)closing.saved=saved;if(tab===activeTab){dirty=false;doc=tab.doc;richChanged=false;source.value=doc.text;rich.innerHTML=render(doc.text);decorate();}}
  tab.placeholder=false;if(edit!==(tab.editVersion||0)||!saved.recoverySaved)adoptDraft(tab,await api.draft(await prepareDurable(tab,captureDurable(tab))));else tab.draftStamp=JSON.stringify([edit,saved.path,saved.revision,snap.visual]);await session();updateTitle();window.dispatchEvent(new CustomEvent('notemind-keep-file',{detail:saved.path}));tab.saveError=saved.saveWarnings?.join('; ')||null;$('status').textContent=tab.saveError?'Saved · '+tab.saveError:'Saved';return true;
 });}
 function decorate(){window.NoteMindWriting?.decorate();window.NoteMindFind?.refresh();}
 function changedView(){decorate();window.NoteMindHistory?.initialize(activeTab);if(!importTargetDepth)schedule(400);}
 function ensureActiveTab(){if(activeTab&&tabs.includes(activeTab))return;const chosen=tabs.find(tab=>tab?.doc&&typeof tab.doc.text==='string');if(chosen){activeTab=null;activateTab(chosen);}else{tabs=[];activeTab=null;addTab({path:null,text:'',assets:{}});}}
 function startup(old){if(startupRun)return startupRun;startupRun=restore(old);return startupRun;}
 async function restore(old){
  const initial=[...tabs],errors=[];
  try{const recovered=await api.recover();if(recovered?.tabs?.length){for(const entry of recovered.tabs){
    try{if(!entry||typeof entry!=='object')throw Error('Invalid recovered Notepad.');if(entry.recoveryError)throw Error(entry.recoveryError);let next=entry;try{if(entry.path&&!entry.dirty)next=await window.notemind.openPath(entry.path);}catch{}
     if(!next||typeof next!=='object'||!next.preview&&!next.workspace&&(typeof next.text!=='string'||!next.assets||typeof next.assets!=='object'))throw Error('Invalid recovered Notepad.');
     const previous=[...tabs],selected=activeTab;try{await addTab(next);}catch(error){tabs=previous;activeTab=null;if(selected)activateTab(selected);throw error;}
     if(next.preview||next.workspace)continue;
     if(activeTab){activeTab.visual=entry.visual!==false;activeTab.scroll=entry.scroll;activeTab.dirty=!!entry.dirty;activeTab.editVersion=0;}
    }catch(error){errors.push(error.message);}
   }
    rememberCurrent();if(tabs.length>1)tabs=tabs.filter(tab=>!initial.includes(tab)||tab.dirty||tab.doc.path||tab.doc.text.trim()||Object.keys(tab.doc.assets||{}).length);
    ensureActiveTab();const chosen=tabs.find(t=>t.doc.id===recovered.active)||activeTab;activeTab=null;activateTab(chosen);$('status').textContent=errors.length?'Some Notepads could not be restored: '+errors.join('; '):'Restored '+tabs.length+' Notepad'+(tabs.length===1?'':'s');
   }else if(old?.paths?.length){for(const file of old.paths)try{await addTab(await window.notemind.openPath(file));}catch(error){errors.push(error.message);}const chosen=tabs.find(t=>t.doc.path===old.active);if(chosen)activateTab(chosen);}
  }catch(error){$('status').textContent='Draft recovery failed: '+error.message;}
  ensureActiveTab();ready=true;decorate();window.NoteMindHistory?.initialize(activeTab);schedule();window.dispatchEvent(new Event('notes-ready'));
 }
 function dialog(title,body,buttons=[]){const d=document.createElement('dialog');d.className='shell-dialog notes-dialog';const h=document.createElement('h2');h.textContent=title;d.append(h);if(typeof body==='string'){const div=document.createElement('div');div.className='notes-body';div.innerHTML=body;d.append(div)}else d.append(body);const status=document.createElement('p');status.className='notes-message';status.setAttribute('role','status');d.append(status);const actions=document.createElement('div');actions.className='dialog-actions';for(const item of [...buttons,{label:'Close',run:()=>d.close()}]){const b=document.createElement('button');b.textContent=item.label;b.title=item.title||(item.label==='Close'?'Close '+title:item.label);b.type='button';b.onclick=async()=>{b.disabled=true;try{await item.run(d);}catch(error){status.textContent=error.message;}finally{b.disabled=false;}};actions.append(b);}d.append(actions);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d;}
 function command(id){return document.dispatchEvent(new CustomEvent('notemind-command',{detail:id,bubbles:true,cancelable:true}));}
 async function openRecord(record){const found=tabs.find(t=>t.doc.id===record.id);if(found){activateTab(found);return;}await addTab(await api.resolve(record.id));}
 const pendingTrash=new Set();
 async function trash(target,ask=true){
  const key=target.path||target.id;if(!key||pendingTrash.has(key))return false;
  const name=target.path?(target.name||target.path.split(/[\\/]/).pop()):(target.title||'Untitled');
  if(ask&&!confirm((target.path?'Move “'+name+'” to Trash?':'Delete draft “'+name+'”?')+' You can restore it from Recently Deleted.'))return false;
  pendingTrash.add(key);clearTimeout(timer);
  try{return await serial(async()=>{
   const affected=tabs.filter(t=>target.path?t.doc.path&&belongsTo(t.doc.path,target.path):t.doc.id===target.id);
   for(const tab of affected)await persist(tab,false);
   if(target.path)await window.notemind.trashEntry(target.path);else await api.deleteDraft(target.id);
   removeTrashedTabs(affected);await session();
   window.dispatchEvent(new Event('notes-files-changed'));await window.NoteMindLibrary?.refresh();
   $('status').textContent=target.path?'Moved to Trash':'Draft moved to Recently Deleted';return true;
  });}finally{pendingTrash.delete(key);schedule();}
 }
 async function renameDraft(record){await flush();const tab=tabs.find(t=>t.doc.id===record.id),draft=tab?snapshot(tab):await api.openDraft(record.id),name=await window.notemindPrompt('Notepad name',draft.title||'Untitled');if(!name?.trim())return;draft.title=name.trim();draft.manualTitle=true;if(tab){Object.assign(tab.doc,draft);changed(tab);updateTitle();await flush();}else await api.draft(draft);await window.NoteMindLibrary.refresh();}
 async function duplicateDraft(record){await flush();const tab=tabs.find(t=>t.doc.id===record.id),draft=tab?snapshot(tab):await api.openDraft(record.id);addTab({...draft,id:crypto.randomUUID(),path:null,revision:undefined,created:undefined,title:(draft.title||'Untitled')+' copy',manualTitle:true,dirty:true});await flush();}
 async function saveDraft(record){await openRecord(record);return saveActive(true);}
 async function indexCurrent(){await flush();$('status').textContent='Reading images for search…';const result=await api.indexImages(snapshot(activeTab));$('status').textContent=result.errors.length?'Indexed '+result.count+' images · '+result.errors.join('; '):'Image and handwriting search is up to date';return result;}
 window.addEventListener('camera-flush',e=>e.detail.promises.push(flush({requireDurable:e.detail.requireDurable===true})));
 window.addEventListener('notemind-command',e=>{if(e.detail==='quickNote'){$('new').click();rich.focus();}if(e.detail==='indexImages')action(indexCurrent);if(e.detail==='deleteNote'){const focused=window.NoteMindSidebar?.focusedDelete();if(focused)action(focused);else if(!activeTab.placeholder)action(()=>trash({path:doc.path,id:doc.id,title:doc.title}));}});
 api.onIndexProgress(value=>{if(value.id===doc.id)$('status').textContent='Indexing image text…';});
 window.NoteMindNotes={session,api,closeDraft,reopenClosing,changed,changedView,schedule,flush,flushTarget,flushRevision,saveActive,startup,dialog,command,openRecord,trash,renameDraft,duplicateDraft,saveDraft,indexCurrent,snapshot,captureInsertion,createImportTarget,insertionState,createPageImport,captureDurable,prepareDurable,insertTextFor,insertMarkdownFor,insertAssetFor,automaticTitle,get ready(){return ready;}};
})();
