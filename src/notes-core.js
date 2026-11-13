(() => {
 const api=window.notemind.notes;
 let ready=false,timer=null,queue=Promise.resolve(),indexTimer=null;
 const automaticTitle=text=>text.split(/\r?\n/).map(s=>s.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ x]\]\s*)?)/i,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/[*_`=]/g,'').trim()).find(Boolean)?.slice(0,100)||'Untitled';
 const serial=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
 function snapshot(tab){if(tab===activeTab)rememberCurrent();return {...tab.doc,assets:{...tab.doc.assets},meta:structuredClone(tab.doc.meta||{}),dirty:tab.dirty,visual:tab.visual};}
 async function session(){await api.session({tabs:tabs.filter(t=>!t.placeholder).map(t=>({id:t.doc.id,path:t.doc.path,visual:t.visual,scroll:t===activeTab?window.NoteMindScroll?.anchor():t.scroll})),active:activeTab?.doc.id});}
 async function persist(tab,saveFile=true){
  if(tab.placeholder)return;
  const snap=snapshot(tab),edit=tab.editVersion||0;
  if(!snap.path&&!snap.manualTitle)snap.title=automaticTitle(snap.text);
  const stamp=JSON.stringify([edit,snap.path,snap.revision,snap.visual]);const kept=tab.draftStamp===stamp?snap:await api.draft(snap);tab.draftStamp=stamp;if(!tabs.includes(tab))return;
  tab.doc.id=kept.id;tab.doc.created=kept.created;
  if(edit===(tab.editVersion||0))tab.doc.title=kept.title;
  if(saveFile&&tab.dirty&&snap.path){try{
   const saved=await api.autosave({...snap,id:kept.id,otherOpenPaths:tabs.filter(t=>t!==tab&&t.doc.path).map(t=>t.doc.path)});
   tab.doc.revision=saved.revision;
   if(edit===(tab.editVersion||0)){const rewritten=saved.text!==snap.text;Object.assign(tab.doc,saved);tab.dirty=false;if(tab===activeTab){dirty=false;richChanged=false;source.value=saved.text;if(rewritten){rich.innerHTML=render(saved.text);decorate();}}}
   else await api.draft(snapshot(tab));
   if(tab===activeTab)$('status').textContent='Autosaved';tab.saveError=null;
  }catch(error){tab.saveError=error.message;if(tab===activeTab)$('status').textContent='Draft recovered locally · '+error.message;}}
  else if(tab===activeTab&&tab.dirty)$('status').textContent='Draft saved';
 }
 function schedule(delay=700){if(!ready)return;clearTimeout(timer);timer=setTimeout(()=>{timer=null;void flush().catch(error=>$('status').textContent='Could not save draft: '+error.message);},delay);}
 async function flush(){return serial(async()=>{for(const tab of [...tabs])await persist(tab);await session();updateTitle();window.notemind.dirty(false);});}
 function changed(tab){tab.placeholder=false;window.NoteMindHistory?.record(tab);tab.saveError=null;tab.editVersion=(tab.editVersion||0)+1;if(!tab.doc.path&&!tab.doc.manualTitle)tab.doc.title=automaticTitle(tab===activeTab?currentText():tab.doc.text);schedule();clearTimeout(indexTimer);indexTimer=setTimeout(()=>{if(ready&&tabs.includes(tab)&&tab.doc.id&&Object.keys(tab.doc.assets).some(n=>NoteMindDocument.mime(n)))void api.indexImages(snapshot(tab)).then(result=>{if(tab===activeTab)$('status').textContent=result.errors.length?'Image search: '+result.errors.join('; '):'Image search updated';}).catch(error=>$('status').textContent='Image search: '+error.message);},3500);}
 async function saveActive(saveAs=false){const tab=activeTab;clearTimeout(timer);return serial(async()=>{
  await persist(tab,false);const snap=snapshot(tab),edit=tab.editVersion||0;
  const saved=await window.notemind.save({...snap,otherOpenPaths:tabs.filter(t=>t!==tab&&t.doc.path).map(t=>t.doc.path)},saveAs);if(!saved)return false;
  tab.doc.path=saved.path;tab.doc.id=saved.id;tab.doc.revision=saved.revision;
  if(edit===(tab.editVersion||0)){Object.assign(tab.doc,saved);tab.dirty=false;if(tab===activeTab){dirty=false;doc=tab.doc;richChanged=false;source.value=doc.text;rich.innerHTML=render(doc.text);decorate();}}
  tab.placeholder=false;await api.draft(snapshot(tab));await session();updateTitle();window.dispatchEvent(new CustomEvent('notemind-keep-file',{detail:saved.path}));$('status').textContent='Saved';return true;
 });}
 function decorate(){window.NoteMindWriting?.decorate();window.NoteMindFind?.refresh();}
 function changedView(){decorate();window.NoteMindHistory?.initialize(activeTab);schedule(400);}
 async function startup(old){
  try{const recovered=await api.recover();if(recovered?.tabs?.length){tabs=[];activeTab=null;for(const entry of recovered.tabs){if(entry.recoveryError){$('status').textContent='Recovery: '+entry.recoveryError;continue;}let next=entry;try{if(entry.path&&!entry.dirty)next=await window.notemind.openPath(entry.path);}catch{}addTab(next);activeTab.visual=entry.visual!==false;activeTab.scroll=entry.scroll;activeTab.dirty=!!entry.dirty;activeTab.editVersion=0;}
    if(!tabs.length)addTab({path:null,text:'',assets:{}});const chosen=tabs.find(t=>t.doc.id===recovered.active)||tabs.at(-1);activeTab=null;activateTab(chosen);$('status').textContent='Restored '+tabs.length+' Notepad'+(tabs.length===1?'':'s');
   }else if(old?.paths?.length){for(const file of old.paths)try{addTab(await window.notemind.openPath(file));}catch{}const chosen=tabs.find(t=>t.doc.path===old.active);if(chosen)activateTab(chosen);}
  }catch(error){$('status').textContent='Draft recovery failed: '+error.message;}
  ready=true;decorate();window.NoteMindHistory?.initialize(activeTab);schedule();window.dispatchEvent(new Event('notes-ready'));
 }
 function dialog(title,body,buttons=[]){const d=document.createElement('dialog');d.className='shell-dialog notes-dialog';const h=document.createElement('h2');h.textContent=title;d.append(h);if(typeof body==='string'){const div=document.createElement('div');div.className='notes-body';div.innerHTML=body;d.append(div)}else d.append(body);const status=document.createElement('p');status.className='notes-message';status.setAttribute('role','status');d.append(status);const actions=document.createElement('div');actions.className='dialog-actions';for(const item of [...buttons,{label:'Close',run:()=>d.close()}]){const b=document.createElement('button');b.textContent=item.label;b.type='button';b.onclick=async()=>{b.disabled=true;try{await item.run(d);}catch(error){status.textContent=error.message;}finally{b.disabled=false;}};actions.append(b);}d.append(actions);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d;}
 function command(id){window.dispatchEvent(new CustomEvent('notemind-command',{detail:id}));}
 async function openRecord(record){const found=tabs.find(t=>t.doc.id===record.id);if(found){activateTab(found);return;}addTab(await api.resolve(record.id));}
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
 window.addEventListener('camera-flush',e=>e.detail.promises.push(flush()));
 window.addEventListener('notemind-command',e=>{if(e.detail==='quickNote'){$('new').click();rich.focus();}if(e.detail==='indexImages')action(indexCurrent);if(e.detail==='deleteNote'){const focused=window.NoteMindSidebar?.focusedDelete();if(focused)action(focused);else if(!activeTab.placeholder)action(()=>trash({path:doc.path,id:doc.id,title:doc.title}));}});
 api.onIndexProgress(value=>{if(value.id===doc.id)$('status').textContent='Indexing image text…';});
 window.NoteMindNotes={session,api,changed,changedView,schedule,flush,saveActive,startup,dialog,command,openRecord,trash,renameDraft,duplicateDraft,saveDraft,indexCurrent,snapshot,automaticTitle,get ready(){return ready;}};
})();
