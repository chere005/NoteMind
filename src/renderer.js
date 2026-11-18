const $ = id => document.getElementById(id);

let doc = { path: null, text: '', assets: {} }, dirty = false, visual = true, richChanged = false;

const rich = $('rich'), source = $('source'), sourceCarets=new WeakMap();
NoteMindImagePreviews.mount(rich, () => doc.assets);

let tabs = [], activeTab = null, nextTabId = 0, draggedTab=null;
window.NoteMindDocumentSync?.setCurrentAssetProvider?.(()=>tabs.map(tab=>tab.doc.assets));

const closedTabs=[];
function notePathKey(file){const windows=window.notemind?.platform==='win32'||/Win/i.test(window.navigator?.platform||'');const value=windows?String(file).replace(/\\/g,'/'):String(file);return windows?value.replace(/\/$/,'').toLowerCase():value.replace(/\/$/,'');}
let readingDialog=null;const carets=new Map();
function restoreCaret(){if(!visual)return;rich.focus();let range=carets.get(activeTab?.id);if(!range||!rich.contains(range.startContainer)){range=document.createRange();range.selectNodeContents(rich);range.collapse(false);}const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}

document.addEventListener('selectionchange',()=>{const sel=getSelection();if(activeTab&&sel.rangeCount&&rich.contains(sel.anchorNode))carets.set(activeTab.id,sel.getRangeAt(0).cloneRange())});
function insertText(text,{focus=true,range:capturedRange=null}={}){let insertedRange=null;if(visual){let selection,range=capturedRange?.cloneRange();if(!range){if(focus){restoreCaret();selection=getSelection();range=selection.getRangeAt(0);}else{range=carets.get(activeTab?.id)?.cloneRange();if(!range||!rich.contains(range.startContainer)){range=document.createRange();range.selectNodeContents(rich);range.collapse(false);}}}else if(focus){rich.focus();selection=getSelection();}const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement,locked=node.closest?.('[contenteditable=false]');if(locked&&rich.contains(locked)){range.setStartAfter(locked.closest('p')||locked);range.collapse(true);}range.deleteContents();if(range.startContainer===rich){const p=document.createElement('p');range.insertNode(p);range.selectNodeContents(p);}const fragment=document.createDocumentFragment();text.split('\n').forEach((line,i)=>{if(i)fragment.append(document.createElement('br'));fragment.append(document.createTextNode(line));});const last=fragment.lastChild;range.insertNode(fragment);if(last){range.setStartAfter(last);range.collapse(true);if(focus){selection||=getSelection();selection.removeAllRanges();selection.addRange(range);}carets.set(activeTab.id,range.cloneRange());insertedRange=range.cloneRange();}richChanged=true;}else{if(focus)source.focus();source.setRangeText(text,source.selectionStart,source.selectionEnd,'end');}markDirty();return{range:insertedRange};}

async function readImage(data,onInsert,insertion=window.NoteMindNotes?.captureInsertion(),onClose){
 if(readingDialog){onClose?.();return;}
 const target=insertion?.tab||activeTab,id=crypto.randomUUID(),d=document.createElement('dialog');d.className='ocr-dialog';readingDialog=d;
 d.innerHTML='<div class="ocr-heading"><h2>Read Text</h2><select aria-label="Reading language"><option value="auto">English and Japanese</option><option value="en">English</option></select></div><div class="ocr-review"><div class="ocr-picture"><img alt="Image being read"><svg></svg></div><textarea aria-label="Recognized text" placeholder="Reading…" spellcheck="true"></textarea></div><div class="ocr-status" role="status">Reading text…</div><div class="ocr-actions"><label><input type="checkbox" checked> Show text positions</label><span class="grow"></span><button data-act="again" title="Read the image again using the selected language">Read Again</button><button data-act="cancel" title="Close without inserting recognized text">Cancel</button><button data-act="new" title="Create a Notepad from the recognized text" disabled>New Notepad</button><button data-act="insert" title="Insert the recognized text into the current Notepad" class="primary" disabled>Insert Text</button></div>';
 const img=d.querySelector('img'),area=d.querySelector('textarea'),status=d.querySelector('.ocr-status'),insert=d.querySelector('[data-act=insert]'),newNote=d.querySelector('[data-act=new]'),again=d.querySelector('[data-act=again]'),language=d.querySelector('select'),svg=d.querySelector('svg');img.src='data:image/png;base64,'+data;
 language.value=localStorage.getItem('notemind.ocrLanguage')||'auto';d.querySelector('input').onchange=e=>svg.hidden=!e.target.checked;
 let readingId=null,readRun=0;
 const stopProgress=window.notemind.onDocumentProgress(value=>{if(value.id===readingId)status.textContent=value.phase+'…'});
 let closed=false;
 const read=async()=>{if(closed)return;const run=++readRun;if(readingId)void window.notemind.ocrCancel(readingId).catch(()=>{});const requestId=readingId=id+'-'+run;again.disabled=true;insert.disabled=true;newNote.disabled=true;area.value='';status.textContent='Reading text…';svg.replaceChildren();localStorage.setItem('notemind.ocrLanguage',language.value);try{const result=await window.notemind.ocrRead({id:requestId,data,language:language.value});if(closed||run!==readRun)return;area.value=result.text;status.textContent=result.lines.length?result.lines.length+' text regions · '+Math.round(result.lines.reduce((s,l)=>s+l.confidence,0)/result.lines.length*100)+'% average confidence · Review and correct before inserting.':'No text found. Try a closer, sharper image or another language.';svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');for(const line of result.lines){const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const k of ['x','y','width','height'])rect.setAttribute(k,String(line[k]*1000));rect.setAttribute('class',line.confidence<.8?'uncertain':'');const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=line.text+' ('+Math.round(line.confidence*100)+'%)';rect.append(title);svg.append(rect);}insert.disabled=newNote.disabled=!area.value.trim();}catch(error){if(!closed&&run===readRun)status.textContent=error.message;}finally{if(!closed&&run===readRun)again.disabled=false;}};
 area.oninput=()=>{insert.disabled=newNote.disabled=!area.value.trim();};again.onclick=read;language.onchange=read;
 d.querySelector('[data-act=cancel]').onclick=()=>d.close();insert.onclick=()=>{if(!area.value.trim())return;if(!tabs.includes(target)){status.textContent='The original Notepad is no longer open. Use New Notepad to keep this text.';return;}const text=area.value;d.close();if(insertion&&window.NoteMindNotes?.insertTextFor)window.NoteMindNotes.insertTextFor(insertion,text);else{activateTab(target);restoreCaret();insertText(text);}onInsert?.();};newNote.onclick=()=>{if(!area.value.trim())return;const text=area.value;d.close();addTab({path:null,text,assets:{},meta:{},imported:true});markDirty();onInsert?.();};
 d.onclose=()=>{closed=true;readRun++;if(readingId)void window.notemind.ocrCancel(readingId).catch(()=>{});stopProgress();img.removeAttribute('src');area.value='';data='';readingDialog=null;d.remove();onClose?.();};document.body.append(d);d.showModal();await read();
}
window.addEventListener('notemind-imported',e=>action(async()=>{await addTab({...e.detail,imported:true});markDirty()}));
window.addEventListener('notemind-insert-text',e=>{try{if(e.detail&&typeof e.detail==='object'&&e.detail.insertion)window.NoteMindNotes.insertTextFor(e.detail.insertion,e.detail.text);else insertText(typeof e.detail==='string'?e.detail:e.detail.text);}catch(error){e.preventDefault();alert(error.message);}});
window.addEventListener('notemind-read-image',e=>{e.detail.claimed=true;action(()=>readImage(e.detail.data,e.detail.onInsert,e.detail.insertion,e.detail.onClose));});
function imagePng(image){const canvas=document.createElement('canvas');try{canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];}finally{canvas.width=0;canvas.height=0;}}
async function readDocumentImage(img){const insertion=window.NoteMindNotes?.captureInsertion(),data=await NoteMindImagePreviews.withImage(img,imagePng);return readImage(data,undefined,insertion);}
async function copyDocumentImage(img){const data=await NoteMindImagePreviews.withImage(img,imagePng);return window.notemind.copyPng(data);}
async function readImageFile(){const insertion=window.NoteMindNotes?.captureInsertion(),asset=await window.notemind.image();if(!asset)return;const image=new Image();let data;try{image.src='data:'+NoteMindDocument.mime(asset.name)+';base64,'+asset.data;await image.decode();data=imagePng(image);}finally{image.removeAttribute('src');}await readImage(data,undefined,insertion);}
function documentOptions(kind){return new Promise(resolve=>{const d=document.createElement('dialog');d.className='shell-dialog';const importMode=kind==='import';d.innerHTML='<h2>'+(importMode?'Import Word or PDF':'Export '+kind)+'</h2><label>'+(importMode?'PDF content':'Paper size')+' <select>'+(importMode?'<option value="both">Page images and editable text</option><option value="text">Editable text only</option><option value="images">Page images only</option>':'<option value="A4">A4</option><option value="Letter">Letter</option>')+'</select></label>'+(kind==='PDF'?'<label><input type=checkbox data-clean> Remove image backgrounds</label>':'')+(importMode?'<label class="pdf-password">PDF password, if needed <input type="password" autocomplete="off"></label>':'')+'<div class="dialog-actions"><button data-cancel title="Cancel this import or export">Cancel</button><button data-go title="Choose a file and continue">'+(importMode?'Choose File…':'Export…')+'</button></div>';let value=null;d.querySelector('[data-cancel]').onclick=()=>d.close();d.querySelector('[data-go]').onclick=()=>{value=importMode?{mode:d.querySelector('select').value,password:d.querySelector('input').value||undefined}:{pageSize:d.querySelector('select').value,clean:!!d.querySelector('[data-clean]')?.checked};d.close();};d.onclose=()=>{resolve(value);d.remove()};document.body.append(d);d.showModal();});}
window.addEventListener('notemind-command',e=>action(async()=>{if(e.detail==='readImage')await readImageFile();if(e.detail==='importDocument'){const mode=await documentOptions('import');if(!mode)return;$('status').textContent='Importing…';const stop=window.notemind.onDocumentProgress(p=>$('status').textContent=p.phase);try{const next=await window.notemind.importDocument(mode);if(next?.pdfImport){const plan=next.pdfImport;const createTarget=()=>NoteMindNotes.createImportTarget({path:null,title:plan.title,manualTitle:true,text:'',assets:{},meta:{},imported:true});window.dispatchEvent(new CustomEvent('notemind-preview',{detail:{path:plan.path,name:plan.title,kind:'pdf',key:'pdf-import:'+plan.id,importRequest:{...plan,createTarget}}}));$('status').textContent='';}else if(next){await addTab(next);markDirty();$('status').textContent=next.warnings?.length?'Imported · '+next.warnings.join('; '):'Imported';}else $('status').textContent='Ready';}finally{stop();}}if(e.detail==='exportWord'){const snapshot=window.NoteMindDocumentSync?.capture({...doc,text:currentText()})||structuredClone({...doc,text:currentText()}),format=e.detail==='exportWord'?'docx':'pdf';try{const options=await documentOptions(format==='docx'?'Word':'PDF');if(!options)return;$('status').textContent='Exporting…';const file=await (window.NoteMindDocumentSync?window.NoteMindDocumentSync.call('exportDocument',snapshot,format,options):window.notemind.exportDocument(snapshot,format,options));$('status').textContent=file?'Exported '+file:'Ready';}finally{window.NoteMindDocumentSync?.releaseDocument?.(snapshot);}}}));

function markDirty() { const textOnly=!!window.NoteMindHistory?.isTextInput?.(activeTab);dirty = true; activeTab.dirty = true; window.NoteMindNotes?.changed(activeTab,{textOnly}); updateTitle({assetsUnchanged:textOnly}); }

let rememberedTabs='',tabSignature='',documentSignature='';
function rememberTabs(){try{const next=JSON.stringify({paths:tabs.filter(t=>t.doc.path).map(t=>t.doc.path),active:doc.path});if(next!==rememberedTabs){localStorage.setItem('notemind.tabs',next);rememberedTabs=next;}}catch{}}

function noteLabel(file){return file.split(/[\\/]/).pop().replace(/\.(nm|wm)$/i,'');}
function updateTitle({assetsUnchanged=false}={}) { window.NoteMindDocumentSync?.retainMany(tabs.map(tab=>tab.doc.assets),{unchanged:assetsUnchanged}); NoteMindImagePreviews.retainMany(tabs.map(tab => tab.doc.assets),{unchanged:assetsUnchanged}); rememberTabs(); const title = doc.path ? noteLabel(doc.path) : doc.title||'Untitled'; $('title').textContent = title + (dirty ? ' •' : ''); document.title = `${$('title').textContent} — NoteMind`; window.notemind.dirty(tabs.some(tab => tab.dirty),!activeTab.placeholder); drawTabs(); const detail={path:doc.path,title,dirty,activeId:activeTab.id,noteId:activeTab.doc.id,drafts:tabs.filter(t=>!t.doc.path&&!t.placeholder).map(t=>({id:t.id,noteId:t.doc.id,title:t.doc.title||'Untitled',dirty:t.dirty}))},next=JSON.stringify(detail);if(next!==documentSignature){documentSignature=next;window.dispatchEvent(new CustomEvent('notemind-document',{detail}));} }

function drawTabs() { const next=JSON.stringify([activeTab?.id,tabs.map(t=>[t.id,t.doc.path,t.doc.title,t.dirty])]);if(next===tabSignature)return;tabSignature=next;const container = $('documentTabs'),left=container.scrollLeft||0;container.replaceChildren(); for (const tab of tabs) { const wrap = document.createElement('div'); wrap.className = 'document-tab tab' + (tab === activeTab ? ' selected open' : ''); const button = document.createElement('button'); button.setAttribute('role','tab');button.tabIndex=tab===activeTab?0:-1; button.setAttribute('aria-selected',String(tab === activeTab)); button.title = tab.doc.path || 'Untitled'; button.textContent = (tab.doc.path ? noteLabel(tab.doc.path) : tab.doc.title||'Untitled') + (tab.dirty ? ' •' : ''); button.className='name';button.onclick = () => {activateTab(tab);(visual?rich:source).focus({preventScroll:true});};wrap.onauxclick=e=>{if(e.button===1){e.preventDefault();closeTab(tab)}}; const close = document.createElement('button'); close.className = 'close-tab close';close.tabIndex=tab===activeTab?0:-1; close.title = 'Close '+(tab.doc.path?noteLabel(tab.doc.path):tab.doc.title||'Untitled')+(tab===activeTab?' ('+(/Mac/i.test(window.navigator?.userAgent||'')?'Cmd':'Ctrl')+'+W)':''); close.setAttribute('aria-label',`Close ${tab.doc.path?noteLabel(tab.doc.path):tab.doc.title||'Untitled'}${tab.dirty?' (unsaved changes)':''}`); close.innerHTML = '<svg class="wm-icon" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';  close.onclick = () => closeTab(tab); wrap.draggable=true;wrap.ondragstart=()=>{draggedTab=tab};wrap.ondragover=e=>e.preventDefault();wrap.ondrop=e=>{e.preventDefault();if(!draggedTab||draggedTab===tab)return;tabs.splice(tabs.indexOf(draggedTab),1);tabs.splice(tabs.indexOf(tab),0,draggedTab);draggedTab=null;updateTitle();};button.oncontextmenu=e=>{e.preventDefault();window.notemindMenu([{label:'Close Tab',run:()=>closeTab(tab)},{label:'Close Other Tabs',run:()=>{for(const t of [...tabs])if(t!==tab)closeTab(t)}},{label:'Move Left',run:()=>moveTab(tab,-1)},{label:'Move Right',run:()=>moveTab(tab,1)},...(tab.doc.path&&window.NoteMindSidebar?['-',...window.NoteMindSidebar.entryActions({path:tab.doc.path,name:tab.doc.path.split(/[\\/]/).pop(),type:'file'},false).filter(i=>i==='-'||i.label!=='Open')]:[])],e.clientX,e.clientY);};wrap.append(button,close); container.append(wrap); }container.scrollLeft=left;revealActiveTab();window.requestAnimationFrame?.(revealActiveTab); }
function revealActiveTab(){const container=$('documentTabs'),selected=container.querySelector?.('.selected');if(!selected?.getBoundingClientRect)return;const item=selected.getBoundingClientRect(),view=container.getBoundingClientRect();if(item.left<view.left)container.scrollLeft-=view.left-item.left;else if(item.right>view.right)container.scrollLeft+=item.right-view.right;}

function rememberCurrent() { if (!activeTab) return; doc.text = currentText(); sourceCaret(); if(!visual)rememberSourceCaret(); activeTab.doc = doc; activeTab.dirty = dirty; activeTab.visual = visual; }

function activateTab(tab) { if (activeTab === tab) return; rememberCurrent(); activeTab = tab; doc = tab.doc; dirty = tab.dirty; visual = tab.visual; refreshEditor(); $('toolbar').hidden = false; $('visual').classList.toggle('selected', visual); $('markdown').classList.toggle('selected', !visual); $('modeLabel').textContent = visual ? 'Visual editor' : 'Markdown editor'; $('status').textContent = 'Ready'; if (visual) visualAccess();(visual?rich:source).focus({preventScroll:true});updateTitle(); window.NoteMindNotes?.changedView(); }

function addTab(next,{placeholder=false}={}) { if(next?.__notemindAssetTokens?.transfer)return window.NoteMindDocumentSync.hydrate(next).then(loaded=>addTab(loaded,{placeholder}));try{return addTabOwned(next,{placeholder});}finally{window.NoteMindDocumentSync?.releaseDocument?.(next);}}
function addTabOwned(next,{placeholder=false}={}) { next=window.NoteMindDocumentSync?.seed(next)||next;next.id ||= crypto.randomUUID(); next.meta ||= {}; if(next.preview){window.dispatchEvent(new CustomEvent('notemind-preview',{detail:next.preview}));return;} if(next.workspace){window.notemind.workspaceWindow(next.workspace).catch(e=>alert(e.message));return;} const closing=window.NoteMindNotes?.reopenClosing?.(next);if(closing){if(!tabs.includes(closing))tabs.push(closing);activateTab(closing);return;} if (next.path) { const found = tabs.find(tab => tab.doc.path && (notePathKey(tab.doc.path) === notePathKey(next.path) || next.id && tab.doc.id===next.id)); if (found) { if(notePathKey(found.doc.path)!==notePathKey(next.path)){rememberCurrent();if(found.dirty){found.doc.path=next.path;}else Object.assign(found.doc,next);if(found===activeTab){doc=found.doc;refreshEditor();}updateTitle();window.NoteMindNotes?.schedule();}activateTab(found); return; } } if(next.path&&tabs.length===1&&activeTab&&!activeTab.dirty&&!doc.path&&!currentText().trim()&&!Object.keys(doc.assets||{}).length){tabs=[];activeTab=null;} const tab = { id: ++nextTabId, doc: next, placeholder, dirty: !!next.imported || !!next.dirty, hadImageAssets: Object.keys(next.assets||{}).some(name=>NoteMindDocument.mime(name)||/\.pdf$/i.test(name)), visual: next.visual ?? !/\.py$/i.test(next.path || '') }; tabs.push(tab); activateTab(tab); }

function closeTab(tab) {
 const index=tabs.indexOf(tab);if(index<0)return Promise.resolve(false);const before=tabs[index-1],after=tabs[index+1];
 if(tab.dirty&&!confirm('Close this Notepad? Its changes remain in recovered drafts.'))return Promise.resolve(false);
 const notes=window.NoteMindNotes;let captured;
 try{captured=notes?.snapshot?notes.snapshot(tab):{...tab.doc,assets:window.NoteMindDocumentSync?.copyAssets(tab.doc.assets)||{...tab.doc.assets},meta:structuredClone(tab.doc.meta||{}),dirty:tab.dirty,visual:tab.visual};}
 catch(error){tab.saveError=error.message;$('status').textContent='Could not close Notepad: '+error.message;return Promise.resolve(false);}
 const restore=error=>{
  if(!tabs.includes(tab)){
   const duplicate=tabs.some(other=>other.doc.id===tab.doc.id||other.doc.path&&tab.doc.path&&notePathKey(other.doc.path)===notePathKey(tab.doc.path));
   if(duplicate){tab.doc={...tab.doc,id:crypto.randomUUID(),path:null,revision:undefined,created:undefined};delete tab.doc.pendingCommit;tab.dirty=true;}
   const next=tabs.indexOf(after),previous=tabs.indexOf(before),at=next>=0?next:previous>=0?previous+1:Math.min(index,tabs.length);tabs.splice(at,0,tab);
  }
  if(!activeTab||!tabs.includes(activeTab)){activeTab=null;activateTab(tab);}else updateTitle();
  tab.draftStamp=null;tab.saveError=error.message;$('status').textContent='Could not save closed Notepad: '+error.message;notes?.schedule();
 };
 const attempt={};tab.closeAttempt=attempt;let saving;try{saving=notes?.closeDraft?notes.closeDraft(tab,captured,restore):Promise.resolve((notes?.api||window.notemind.notes).draft(captured)).catch(error=>{restore(error);throw error;});}
 catch(error){restore(error);return Promise.resolve(false);}
 const wasActive=tab===activeTab;tabs.splice(index,1);if(wasActive){activeTab=null;if(!tabs.length)addTab({path:null,text:'',assets:{}},{placeholder:true});else activateTab(tabs[Math.min(index,tabs.length-1)]);}else updateTitle();notes?.schedule();
 return saving.then(()=>{if(tab.closeAttempt===attempt&&tab.doc.path&&!tabs.includes(tab))closedTabs.push(tab.doc.path);return true;},()=>false);
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function assetUrl(name) { const data = doc.assets[name]; if (!data) return ''; const ext = name.split('.').pop().toLowerCase(); const mime = ({ svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', avif:'image/avif' })[ext]; return mime ? `data:${mime};base64,${data}` : ''; }

function render(text) { NoteMindImagePreviews.retainMany(tabs.map(tab => tab.doc.assets));return NoteMindDocument.render(text,doc.assets,doc.meta,NoteMindImagePreviews.url,NoteMindImagePreviews.size); }
function visualAccess(){rich.contentEditable='true';$('toolbar').querySelectorAll('button').forEach(b=>b.disabled=false);return true;}
function currentText(){return !visual?source.value:richChanged?NoteMindDocument.toMarkdown(rich.innerHTML):doc.text;}
function sourceCaret(){const caret=sourceCarets.get(activeTab);if(caret&&caret.document.deref()===doc&&caret.text===doc.text)return caret;sourceCarets.delete(activeTab);return null;}
function rememberSourceCaret(){if(activeTab)sourceCarets.set(activeTab,{document:new WeakRef(doc),text:doc.text,start:source.selectionStart,end:source.selectionEnd,direction:source.selectionDirection});}
function refreshEditor({contentChanged=true}={}){
 // The inactive view is disposable; currentText() and doc.text own the text.
 const caret=sourceCaret(),sourceWasHidden=source.hidden;rich.hidden=!visual;source.hidden=visual;
 if(visual){source.value='';if(contentChanged)rich.innerHTML=render(doc.text);}
 else{rich.innerHTML='';if(contentChanged){source.value=doc.text;if(sourceWasHidden&&caret)source.setSelectionRange(caret.start,caret.end,caret.direction);}}
 richChanged=false;
}
function switchMode(toVisual) { if (visual === toVisual) return; doc.text = currentText(); sourceCaret(); if(!visual)rememberSourceCaret(); visual = toVisual; refreshEditor(); $('toolbar').hidden = false; $('visual').classList.toggle('selected', visual); $('markdown').classList.toggle('selected', !visual); $('modeLabel').textContent = visual ? 'Visual editor' : 'Markdown editor'; if (visual) visualAccess(); else $('status').textContent = 'Ready'; activeTab.visual=visual; window.NoteMindNotes?.changedView();(visual?rich:source).focus({preventScroll:true}); }

async function save(saveAs=false){if(window.NoteMindNotes)return window.NoteMindNotes.saveActive(saveAs);doc.text=currentText();const tab=activeTab,savedText=doc.text,snapshot={...doc,assets:window.NoteMindDocumentSync?.copyAssets(doc.assets)||{...doc.assets},otherOpenPaths:tabs.filter(t=>t!==tab&&t.doc.path).map(t=>t.doc.path)};const result=await (window.NoteMindDocumentSync?.save||window.notemind.save)(snapshot,saveAs);if(!result)return false;const saved=typeof result==='string'?{...snapshot,path:result}:result;const changed=tab===activeTab?currentText()!==savedText:tab.doc.text!==savedText;tab.doc.path=saved.path;tab.doc.id=saved.id;if(!changed){Object.assign(tab.doc,saved);tab.dirty=false;if(tab===activeTab){dirty=false;refreshEditor();}}else tab.dirty=true;updateTitle();$('status').textContent=changed?'Saved earlier changes':'Saved';return true;}
async function action(fn) { try { await fn(); } catch (e) { alert(e.message || String(e)); } }

window.addEventListener('notemind-document-request',()=>{documentSignature='';updateTitle();});
window.addEventListener('notemind-select-tab',e=>{const tab=tabs.find(t=>t.id===e.detail);if(tab)activateTab(tab)});
$('new').onclick = () => addTab({ path: null, text: '', assets: {} });

$('open').onclick = () => action(async () => { const next = await window.notemind.open(); if (next) await addTab(next); });

$('save').onclick = () => action(() => save()); $('saveAs').onclick = () => action(() => save(true));

$('visual').onclick = () => switchMode(true); $('markdown').onclick = () => switchMode(false);

rich.oninput = () => { richChanged = true; markDirty(); }; source.oninput = markDirty;

rich.addEventListener('paste', event => { if(window.NoteMindTables?.paste(event)){event.preventDefault();return;} if(window.NoteMindClipboard?.paste(event)){event.preventDefault();return;} event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); richChanged=true;markDirty(); });

// Drops are handled by notes-clipboard.js.

function formatText(command){
 if(visual){if(window.NoteMindTables?.formatSelection(command))return;restoreCaret();if(command==='heading')document.execCommand('formatBlock',false,'h1');else document.execCommand(command);richChanged=true;markDirty();return;}
 const start=source.selectionStart,end=source.selectionEnd,value=source.value,selected=value.slice(start,end);
 source.focus();
 if(command==='bold'||command==='italic'){const marker=command==='bold'?'**':'*',text=selected||'text';source.setRangeText(marker+text+marker,start,end,'select');source.setSelectionRange(start+marker.length,start+marker.length+text.length);}
 else {const from=value.lastIndexOf('\n',start-1)+1,next=value.indexOf('\n',end),to=next<0?value.length:next,lines=value.slice(from,to).split('\n'),prefix=command==='heading'?'# ':'- ';source.setRangeText(lines.map(line=>prefix+line).join('\n'),from,to,'select');}
 markDirty();
}
$('toolbar').addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>formatText(button.dataset.command));
// The text style picker is installed by notes-styles.js.

let graphicsEditRun=0,graphicsEditAbort=null;
async function editGraphics(img) {
 const run=++graphicsEditRun;graphicsEditAbort?.abort();const controller=new AbortController();graphicsEditAbort=controller;
 const sync=window.NoteMindDocumentSync,tab=activeTab,name=img.dataset.asset,expectedData=tab.doc.assets[name],sidecar=tab.doc.assets[name+'.json'],expectedIdentity=sync?.assetIdentity?.(tab.doc.assets,name);
 let captured;
 try{
  captured=sync?.capture({...tab.doc,assets:sync.copyAssets(tab.doc.assets)})||{assets:{...tab.doc.assets}};
  let url=typeof expectedData==='string'?assetUrl(name):'';
  const sheet=!sidecar?null:sync?.isRef?.(sidecar)?await sync.withAssetBytes(captured.assets,name+'.json',{signal:controller.signal},bytes=>NoteMindGraphics.decodeAsync(bytes,{owned:true,signal:controller.signal})):await NoteMindGraphics.decodeBase64Async(sidecar,{signal:controller.signal});
  if(!url&&!sheet&&sync?.isRef?.(expectedData))url=await sync.withAssetBytes(captured.assets,name,{signal:controller.signal},bytes=>{const type=sync.info(captured.assets,name).mime;if(!/^image\//.test(type))throw Error('The original picture is unavailable.');const chunks=[];for(let offset=0;offset<bytes.length;offset+=24576)chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset,offset+24576))));return 'data:'+type+';base64,'+chunks.join('');});
  if(controller.signal.aborted||run!==graphicsEditRun||!tabs.includes(tab))return false;
  if((expectedIdentity!==undefined?(!Object.hasOwn(tab.doc.assets,name)||sync.assetIdentity(tab.doc.assets,name)!==expectedIdentity):tab.doc.assets[name]!==expectedData)||tab.doc.assets[name+'.json']!==sidecar)throw Error('The original image changed while the drawing was loading. Open it again to edit the current image.');
  window.dispatchEvent(new CustomEvent('tablet-edit-image',{detail:{url,sheet,target:{tabId:tab.id,assetName:name,...(expectedIdentity!==undefined?{expectedIdentity}:{expectedData})}}}));if($('pane').hidden)$('paneToggle').click();return true;
 }catch(error){if(controller.signal.aborted)return false;throw error;}finally{sync?.releaseDocument?.(captured);if(graphicsEditAbort===controller)graphicsEditAbort=null;}
}
function insertAsset(name, data, sheet=null, sidecar=null,sidecarChunks=null,imageChunks=null) {
 if(doc.path&&!/\.(nm|wm|md)$/i.test(doc.path)){alert('Save as a .nm or .md Notepad before adding graphics.');return false;}
 if(visual&&rich.contentEditable!=='true')return false;
 const assets={[name]:data};if(imageChunks)window.NoteMindDocumentSync?.hint(assets,name,data,imageChunks);if(sidecar){assets[name+'.json']=sidecar;window.NoteMindDocumentSync?.hint(assets,name+'.json',sidecar,sidecarChunks)}else if(sheet)assets[name+'.json']=NoteMindGraphics.encodeBase64(sheet);
 window.NoteMindAssetAdmission?.admit(doc.assets,{add:assets,chunks:(owned,key)=>window.NoteMindDocumentSync?.assetChunks(owned,key)});if(visual){restoreCaret();if(!getSelection()?.rangeCount)throw Error('Choose an insertion point in the Notepad.');}window.NoteMindHistory?.initialize(activeTab);for(const[key,value]of Object.entries(assets))Object.defineProperty(doc.assets,key,{value,enumerable:true,writable:true,configurable:true});window.NoteMindDocumentSync?.copyHints(assets,doc.assets);doc.meta ||= {};doc.meta.graphicsPanes ||= {};Object.defineProperty(doc.meta.graphicsPanes,name,{value:{version:1},enumerable:true,writable:true,configurable:true});
 const text='\n\n!['+(sheet||sidecar?'Drawing':'Image')+']('+name+')\n\n';
 if(visual){restoreCaret();const selection=getSelection(),range=selection.getRangeAt(0);const node=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;const block=node.closest?.('p,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol');if(block&&rich.contains(block)){range.setStartAfter(block);range.collapse(true);}else range.collapse(false);const fragment=range.createContextualFragment(render(text)+'<p><br></p>'),last=fragment.lastChild;range.insertNode(fragment);if(last){range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}richChanged=true;}
 else source.setRangeText(text,source.selectionStart,source.selectionEnd,'end');
 markDirty();return true;
}

$('insertImage').onclick = () => action(async () => { const target=window.NoteMindNotes?.captureInsertion();const image = await(window.NoteMindDocumentSync?.image?window.NoteMindDocumentSync.image():window.notemind.image()); if(image){const chunks=image.assets&&window.NoteMindDocumentSync?.assetChunks(image.assets,image.name);if(target)window.NoteMindNotes.insertAssetFor(target,image.name,image.data,null,null,null,chunks);else insertAsset(image.name,image.data,null,null,null,chunks);} });

$('run').onclick = () => action(async () => { const target = activeTab; if (!target.doc.path || !/\.py$/i.test(target.doc.path)) { alert('Save this document as a .py file before running it.'); return; } if (target.dirty && !await save()) return; if (target.dirty) { alert('The document changed while it was being saved. Save it again before running.'); return; } $('output').hidden = false; $('outputText').textContent = 'Running…'; const result = await window.notemind.runPython(target.doc.path); $('outputText').textContent = `${result.output}\n[Exit: ${result.code ?? 'could not start'}]`; });

$('closeOutput').onclick = () => $('output').hidden = true; $('paneToggle').onclick = () => { $('pane').hidden = !$('pane').hidden; window.dispatchEvent(new CustomEvent('tablet-visibility', { detail: !$('pane').hidden })); };

window.addEventListener('tablet-insert', e => {try{const ok=e.detail.insertion?window.NoteMindNotes.insertAssetFor(e.detail.insertion,e.detail.name,e.detail.data,e.detail.sheet,e.detail.sidecar,e.detail.sidecarChunks):insertAsset(e.detail.name,e.detail.data,e.detail.sheet,e.detail.sidecar,e.detail.sidecarChunks);if(ok===false)e.preventDefault();}catch(error){e.preventDefault();alert(error.message);}});

window.addEventListener('notemind-open-path', e => action(async () => { const found = tabs.find(tab => tab.doc.path && notePathKey(tab.doc.path) === notePathKey(e.detail)); if (found) activateTab(found); else { const next = await window.notemind.openPath(e.detail); if (next?.workspace) await window.notemind.workspaceWindow(next.workspace); else { await addTab(next); window.notemind.remember?.(String(e.detail)).catch(() => {}); } } }));

const startupOpenRequests=[];
const openRequestedFile=file=>window.dispatchEvent(new CustomEvent('notemind-open-path',{detail:file}));
window.notemind.onOpenRequest?.(file=>window.NoteMindNotes?.ready?openRequestedFile(file):startupOpenRequests.push(file));
window.addEventListener('notes-ready',()=>{for(const file of startupOpenRequests.splice(0))openRequestedFile(file);});

window.addEventListener('notemind-new-in-folder', e => addTab({ path: null, text: '', assets: {}, initialFolder: e.detail.folder }));

function belongsTo(file, folder) { const norm = notePathKey; const a = norm(file), b = norm(folder); return a === b || a.startsWith(b + '/'); }

function removeTrashedTabs(affected) {
 const index=tabs.indexOf(activeTab),wasActive=affected.includes(activeTab);
 tabs=tabs.filter(tab=>!affected.includes(tab));
 for(let i=closedTabs.length-1;i>=0;i--)if(affected.some(tab=>tab.doc.path&&belongsTo(closedTabs[i],tab.doc.path)))closedTabs.splice(i,1);
 if(wasActive){activeTab=null;if(!tabs.length)addTab({path:null,text:'',assets:{}},{placeholder:true});else activateTab(tabs[Math.min(index,tabs.length-1)]);}else updateTitle();
}

window.addEventListener('notemind-path-renamed', e => { const { from, to } = e.detail; for (const tab of tabs) if (tab.doc.path && belongsTo(tab.doc.path, from)) tab.doc.path = to + tab.doc.path.slice(from.length); updateTitle(); });

window.notemind.onMenu?.(id => { if (!document.dispatchEvent(new CustomEvent('notemind-command',{detail:id,bubbles:true,cancelable:true}))) return; const button = $(id); if (button && !button.disabled) button.click(); });

const startupTabs=(()=>{try{return JSON.parse(localStorage.getItem('notemind.tabs')||'null')}catch{return null}})();

addTab(doc);

window.addEventListener('DOMContentLoaded',()=>window.NoteMindNotes.startup(startupTabs));



window.addEventListener('notemind-command',e=>{const id=e.detail;if(id==='closeTab')closeTab(activeTab);if(id==='importMarkdown')action(async()=>{const next=await window.notemind.open();if(next){next.path=null;await addTab(next);markDirty();}});if(id==='pythonSetup')action(async()=>{const file=await window.notemind.pythonSelect();if(file)$('status').textContent='Python: '+file;});});

document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;if(e.key==='Tab'){e.preventDefault();activateTab(tabs[(tabs.indexOf(activeTab)+(e.shiftKey?tabs.length-1:1))%tabs.length]);}if(e.shiftKey&&e.key.toLowerCase()==='t'&&closedTabs.length){e.preventDefault();window.dispatchEvent(new CustomEvent('notemind-open-path',{detail:closedTabs.pop()}));}});



function moveTab(tab,by){const i=tabs.indexOf(tab),j=i+by;if(j>=0&&j<tabs.length){[tabs[i],tabs[j]]=[tabs[j],tabs[i]];updateTitle();}}

rich.addEventListener('contextmenu',e=>{const img=e.target.closest('img[data-asset]');if(!img)return;e.preventDefault();window.notemindMenu([{label:'Resize, Rotate or Crop…',run:()=>window.NoteMindPicture.edit(img)},{label:'Edit with Tablet',run:()=>action(()=>editGraphics(img))},{label:'Read Text',run:()=>action(()=>readDocumentImage(img))},{label:'Copy Image',run:()=>action(()=>copyDocumentImage(img))}],e.clientX,e.clientY);});

window.addEventListener('tablet-replace',e=>{const {target,data,name}=e.detail;const tab=tabs.find(t=>t.id===target.tabId);rememberCurrent();const used=tab&&NoteMindDocument.md.parse(tab.doc.text,{}).some(token=>(token.children||[]).some(child=>child.type==='image'&&child.attrGet('src')===NoteMindDocument.md.normalizeLink(target.assetName)));if(!tab||!Object.hasOwn(tab.doc.assets,target.assetName)||!used||(target.expectedIdentity!==undefined?window.NoteMindDocumentSync?.assetIdentity?.(tab.doc.assets,target.assetName)!==target.expectedIdentity:target.expectedData!==undefined&&tab.doc.assets[target.assetName]!==target.expectedData)){e.preventDefault();alert('The original image has changed or is no longer open. Insert as a new image instead.');return;}const oldName=target.assetName,next={...tab.doc,text:NoteMindReferenceRewrite(NoteMindDocument.md,tab.doc.text,{[oldName]:name}),assets:window.NoteMindDocumentSync?.copyAssets(tab.doc.assets)||{...tab.doc.assets},meta:{...tab.doc.meta,graphicsPanes:{...tab.doc.meta?.graphicsPanes}}};Object.defineProperty(next.assets,name,{value:data,enumerable:true,writable:true,configurable:true});if(e.detail.sidecar){next.assets[name+'.json']=e.detail.sidecar;window.NoteMindDocumentSync?.hint(next.assets,name+'.json',e.detail.sidecar,e.detail.sidecarChunks)}else if(e.detail.sheet)next.assets[name+'.json']=NoteMindGraphics.encodeBase64(e.detail.sheet);delete next.meta.graphicsPanes[oldName];Object.defineProperty(next.meta.graphicsPanes,name,{value:{version:1},enumerable:true,writable:true,configurable:true});let kept,nextIdentity;try{kept=window.NoteMindPruneReplacedAssets?.(NoteMindDocument.md,next,oldName)||next;window.NoteMindDocumentSync?.copyHints(next.assets,kept.assets);window.NoteMindAssetAdmission?.admit(kept.assets,{chunks:(owned,key)=>window.NoteMindDocumentSync?.assetChunks(owned,key)});if(target.expectedIdentity!==undefined)nextIdentity=window.NoteMindDocumentSync.assetIdentity(kept.assets,name);}catch(error){e.preventDefault();alert(error.message);return;}window.NoteMindHistory?.initialize(tab);Object.assign(tab.doc,{text:next.text,assets:kept.assets,meta:kept.meta});target.assetName=name;if(target.expectedIdentity!==undefined){target.expectedIdentity=nextIdentity;delete target.expectedData;}else target.expectedData=data;tab.dirty=true;if(tab===activeTab){dirty=true;refreshEditor();}updateTitle();window.NoteMindNotes?.changed(tab);});



window.addEventListener('notemind-keep-drawing',e=>{try{const target=e.detail.insertion,owner=target?.tab?.doc||doc;if(owner.path&&!/\.(nm|wm)$/i.test(owner.path))throw Error('Save as a .nm Notepad before keeping a drawing.');const name='assets/drawing-'+Date.now()+'.svg';if(target)window.NoteMindNotes.insertAssetFor(target,name,e.detail.svg,e.detail.sheet,e.detail.sidecar,e.detail.sidecarChunks);else{insertAsset(name,e.detail.svg,e.detail.sheet,e.detail.sidecar,e.detail.sidecarChunks);markDirty();}}catch(error){e.preventDefault();alert(error.message)}});

window.notemind.onPythonOutput(text=>{if($('outputText').textContent==='Running…')$('outputText').textContent='';$('outputText').textContent=($('outputText').textContent+text).slice(-1000000);$('output').scrollTop=$('output').scrollHeight;});$('stopPython').onclick=()=>window.notemind.stopPython();

window.addEventListener('notemind-command',e=>{if(e.detail==='moveTabLeft')moveTab(activeTab,-1);if(e.detail==='moveTabRight')moveTab(activeTab,1);if(e.detail==='cleanAssets'){const text=currentText(),kept=window.NoteMindPruneReplacedAssets(NoteMindDocument.md,{...doc,text},Object.keys(doc.assets)),unused=kept.removed;if(!unused.length){$('status').textContent='No unused images.';return;}if(confirm('Remove '+unused.length+' unused image files from this Notepad? Save to keep the change.')){for(const name of unused)delete doc.assets[name];doc.meta=kept.meta;markDirty();}}});

$('documentTabs').onwheel=e=>{e.currentTarget.scrollLeft+=e.deltaY};

window.notemind.onWorkspaceOpen?.(workspace=>window.notemind.workspaceWindow(workspace));

rich.addEventListener('click',e=>{const b=e.target.closest('[data-edit-graphics]');if(!b)return;e.preventDefault();const img=b.parentElement.querySelector('img[data-asset]');if(img)action(()=>editGraphics(img));});
