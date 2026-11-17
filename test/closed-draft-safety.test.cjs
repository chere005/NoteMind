const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const noop=()=>{},tick=()=>new Promise(setImmediate),copy=value=>structuredClone(value);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
async function until(predicate){for(let n=0;n<30;n++){if(predicate())return;await tick();}assert.fail('Expected asynchronous operation did not start.');}
async function fixture({paths=true,count=2}={}){
 const makeTab=(id,text)=>({id,doc:{id,path:paths?'/fixture/'+id+'.nm':null,text,assets:{},meta:{},revision:'old-'+id},dirty:id==='A',visual:false});
 const a=makeTab('A','Latest A'),b=makeTab('B','Other B'),cTab=makeTab('C','Other C'),elements={status:{}},events=[],sessions=[],stored=new Map(),hooks={};let generation=0;
 const source={value:a.doc.text,selectionStart:0,selectionEnd:0},rich={innerHTML:'',contains:()=>false};
 const api={recover:async()=>null,onIndexProgress:noop,indexImages:async()=>({count:0,errors:[]}),
  async draft(doc){const snap=copy(doc);events.push({type:'draft-start',doc:snap});const override=await hooks.draft?.(snap);const kept={...(override||{...snap,id:snap.id||'assigned',created:snap.created||'created-'+(snap.id||'assigned')}),recoveryId:'generation-'+(++generation)};stored.set(kept.id,copy(kept));events.push({type:'draft-done',doc:copy(kept)});return copy(kept);},
  async autosave(doc){const snap=copy(doc);events.push({type:'autosave-start',doc:snap});const saved=await hooks.autosave?.(snap)||{...snap,revision:'new-'+snap.id};stored.set(saved.id,{...copy(saved),dirty:false});events.push({type:'clean-draft',doc:copy(saved)});return copy(saved);},
  async session(value){const snap=copy(value);sessions.push(snap);await hooks.session?.(snap);}
 };
 const c={NoteMindDocument:require('../src/document-renderer.cjs'),tabs:[a,b,cTab].slice(0,count),activeTab:a,nextTabId:0,doc:a.doc,dirty:a.dirty,visual:false,richChanged:false,source,rich,structuredClone,setTimeout:()=>1,clearTimeout:noop,Date,crypto:require('node:crypto'),$:id=>elements[id]||{},confirm:()=>true,closedTabs:[],notePathKey:file=>file,updateTitle:noop,render:text=>text,currentText:()=>source.value,Event:class{},CustomEvent:class{},document:{addEventListener:noop},window:{notemind:{notes:api,dirty:noop,async save(doc){const snap=copy(doc);events.push({type:'save-start',doc:snap});return hooks.save?.(snap)||{...snap,path:'/fixture/saved.nm',revision:'manual-new'};}},addEventListener:noop,dispatchEvent:noop},action:fn=>fn()};
 c.rememberCurrent=()=>{if(c.activeTab){c.doc.text=source.value;c.activeTab.doc=c.doc;c.activeTab.dirty=c.dirty;}};
 c.activateTab=target=>{if(c.activeTab===target)return;c.rememberCurrent();c.activeTab=target;c.doc=target.doc;c.dirty=target.dirty;source.value=target.doc.text;};
 vm.createContext(c);vm.runInContext(fs.readFileSync('src/notes-core.js','utf8'),c);
 const renderer=fs.readFileSync('src/renderer.js','utf8');vm.runInContext(renderer.slice(renderer.indexOf('function addTab('),renderer.indexOf('\nfunction escapeHtml')),c);
 const notes=c.window.NoteMindNotes;await notes.startup(null);
 function edit(tab,text){if(c.activeTab===tab){source.value=text;c.dirty=true;}else tab.doc.text=text;tab.dirty=true;notes.changed(tab);}
 return {c,a,b,cTab,api,notes,hooks,events,sessions,stored,elements,source,edit};
}

test('failed closing draft restores latest memory without taking another Notepad focus',async()=>{
 const h=await fixture();h.hooks.draft=async doc=>{if(doc.id==='A')throw Error('Disk full');};
 const closing=h.c.closeTab(h.a);assert.equal(h.c.tabs.includes(h.a),false);assert.equal(h.c.activeTab,h.b);
 assert.equal(await closing,false);assert.equal(h.c.tabs[0],h.a);assert.equal(h.a.doc.text,'Latest A');assert.equal(h.a.dirty,true);assert.equal(h.c.activeTab,h.b);assert.equal(h.source.value,'Other B');assert.equal(h.b.doc.text,'Other B');assert.match(h.elements.status.textContent,/Disk full/);assert.equal(h.c.closedTabs.length,0);
});

test('closing latest edits waits for pending autosave and uses its new file ownership',async()=>{
 const h=await fixture(),save=deferred();h.hooks.autosave=()=>save.promise;
 const flushing=h.notes.flush();await until(()=>h.events.some(e=>e.type==='autosave-start'));
 h.edit(h.a,'Edited while saving');const closing=h.c.closeTab(h.a);await tick();
 assert.equal(h.events.filter(e=>e.type==='draft-start'&&e.doc.id==='A').length,1);assert.equal(h.c.activeTab,h.b);
 save.resolve({...h.events.find(e=>e.type==='autosave-start').doc,id:'owned-A',path:'/fixture/renamed.nm',revision:'new-owned-revision',created:'saved-created'});
 await flushing;assert.equal(await closing,true);
 const saved=h.stored.get('owned-A');assert.equal(saved.text,'Edited while saving');assert.equal(saved.path,'/fixture/renamed.nm');assert.equal(saved.revision,'new-owned-revision');assert.equal(saved.created,'saved-created');assert.equal(saved.dirty,true);
 const clean=h.events.findIndex(e=>e.type==='clean-draft'),latest=h.events.findIndex(e=>e.type==='draft-start'&&e.doc.text==='Edited while saving');assert.ok(latest>clean);
 assert.ok(h.sessions.some(s=>s.tabs.some(t=>t.id==='owned-A')));assert.equal(h.sessions.at(-1).tabs.some(t=>t.id==='owned-A'),false);assert.equal(h.c.closedTabs[0],'/fixture/renamed.nm');assert.equal(h.source.value,'Other B');assert.equal(h.b.doc.text,'Other B');
});

test('first pending draft identity survives removal from the open tabs',async()=>{
 const h=await fixture({paths:false}),draft=deferred();delete h.a.doc.id;let first=true;
 h.hooks.draft=doc=>{if(first){first=false;return draft.promise;}};
 const flushing=h.notes.flush();await until(()=>h.events.length===1);const closing=h.c.closeTab(h.a);
 draft.resolve({...h.events[0].doc,id:'assigned-first-draft',created:'first-created'});await flushing;assert.equal(await closing,true);
 assert.equal(h.a.doc.id,'assigned-first-draft');assert.equal(h.a.doc.created,'first-created');assert.equal(h.stored.get('assigned-first-draft').text,'Latest A');assert.equal(h.events.some(e=>e.type==='draft-start'&&e.doc.id==='assigned-first-draft'),true);assert.equal(h.events.some(e=>e.type==='autosave-start'),false);
});

test('close during manual Save As retains later edits and the returned identity',async()=>{
 const h=await fixture(),save=deferred();h.hooks.save=()=>save.promise;const saving=h.notes.saveActive(true);
 await until(()=>h.events.some(e=>e.type==='save-start'));h.edit(h.a,'Latest after Save As started');const closing=h.c.closeTab(h.a);
 save.resolve({...h.events.find(e=>e.type==='save-start').doc,id:'new-save-as',path:'/fixture/new-location.nm',revision:'save-as-revision',created:'save-as-created'});
 assert.equal(await saving,true);assert.equal(await closing,true);const kept=h.stored.get('new-save-as');assert.equal(kept.text,'Latest after Save As started');assert.equal(kept.revision,'save-as-revision');assert.equal(kept.path,'/fixture/new-location.nm');assert.equal(kept.created,'save-as-created');assert.equal(kept.dirty,true);assert.equal(h.c.activeTab,h.b);assert.equal(h.source.value,'Other B');
});

test('a pending save with no later edits keeps its committed text and asset rewrites',async()=>{
 const h=await fixture(),save=deferred();h.a.doc.text=h.source.value='[image](assets/original.png)';h.a.doc.assets={'assets/original.png':'IMAGE'};h.hooks.save=()=>save.promise;const saving=h.notes.saveActive(true);
 await until(()=>h.events.some(e=>e.type==='save-start'));const closing=h.c.closeTab(h.a);
 save.resolve({...h.events.find(e=>e.type==='save-start').doc,text:'[image](moved/image.png)',assets:{'moved/image.png':'IMAGE'},path:'/fixture/moved/note.md',revision:'rewritten-revision',created:'rewritten-created'});
 assert.equal(await saving,true);assert.equal(await closing,true);const kept=h.stored.get('A');assert.equal(kept.text,'[image](moved/image.png)');assert.equal(kept.assets['moved/image.png'],'IMAGE');assert.equal(kept.assets['assets/original.png'],undefined);assert.equal(kept.dirty,false);assert.equal(kept.path,'/fixture/moved/note.md');
});

test('closing a removed tab again cannot remove an unrelated tab',async()=>{
 const h=await fixture(),draft=deferred();h.hooks.draft=()=>draft.promise;const first=h.c.closeTab(h.a);await until(()=>h.events.length===1);
 assert.equal(await h.c.closeTab(h.a),false);assert.equal(h.c.tabs.length,1);assert.equal(h.c.tabs[0],h.b);
 draft.resolve({...h.events[0].doc,created:'now'});assert.equal(await first,true);assert.equal(h.c.tabs[0],h.b);
});

test('multiple late close failures restore original tab order and preserve the active note',async()=>{
 const h=await fixture({count:3}),first=deferred();h.hooks.draft=doc=>doc.id==='A'?first.promise:Promise.reject(Error('B unavailable'));
 const closeA=h.c.closeTab(h.a),closeB=h.c.closeTab(h.b);await until(()=>h.events.length===1);assert.equal(h.c.activeTab,h.cTab);
 first.reject(Error('A unavailable'));assert.equal(await closeA,false);assert.equal(await closeB,false);
 assert.equal(h.c.tabs.length,3);assert.equal(h.c.tabs[0],h.a);assert.equal(h.c.tabs[1],h.b);assert.equal(h.c.tabs[2],h.cTab);assert.equal(h.c.activeTab,h.cTab);assert.equal(h.source.value,'Other C');assert.equal(h.a.doc.text,'Latest A');assert.equal(h.b.doc.text,'Other B');
});

test('reopened same file is preserved when an older closing draft later fails',async()=>{
 const h=await fixture(),draft=deferred();h.hooks.draft=()=>draft.promise;const closing=h.c.closeTab(h.a);await until(()=>h.events.length===1);
 const reopened={id:'independent',doc:{...copy(h.a.doc),text:'Separately reopened content'},dirty:true,visual:false};h.c.tabs.push(reopened);h.c.activateTab(reopened);draft.reject(Error('Recovery unavailable'));assert.equal(await closing,false);
 assert.equal(h.c.activeTab,reopened);assert.equal(h.source.value,'Separately reopened content');assert.equal(reopened.doc.id,'A');assert.equal(reopened.doc.path,'/fixture/A.nm');assert.equal(reopened.doc.text,'Separately reopened content');assert.equal(h.a.doc.text,'Latest A');assert.equal(h.a.doc.path,null);assert.notEqual(h.a.doc.id,'A');assert.equal(h.a.dirty,true);assert.equal(h.c.tabs.length,3);
});

test('successfully closing recovery cannot be replaced by a stale simultaneous reopen',async()=>{
 const h=await fixture(),draft=deferred();h.hooks.draft=()=>draft.promise;const closing=h.c.closeTab(h.a);await until(()=>h.events.length===1);
 h.c.addTab({...copy(h.a.doc),text:'Older public file content',dirty:false});draft.resolve({...h.events[0].doc,created:'now'});assert.equal(await closing,true);h.hooks.draft=null;await h.notes.flush();
 assert.equal(h.stored.get('A').text,'Latest A');assert.equal(h.source.value,'Latest A');assert.equal(h.c.activeTab,h.a);assert.equal(h.c.closedTabs.length,0);
});

test('reopening before a queued close begins retains subsequent live edits',async()=>{
 const h=await fixture(),save=deferred();h.hooks.autosave=()=>save.promise;const flushing=h.notes.flush();await until(()=>h.events.some(e=>e.type==='autosave-start'));
 h.edit(h.a,'Captured while saving');const closing=h.c.closeTab(h.a);h.c.addTab({...copy(h.a.doc),text:'Older public body',dirty:false});assert.equal(h.c.activeTab,h.a);assert.equal(h.source.value,'Captured while saving');h.edit(h.a,'New edit after reopening');
 save.resolve({...h.events.find(e=>e.type==='autosave-start').doc,revision:'reopened-revision'});await flushing;assert.equal(await closing,true);assert.equal(h.source.value,'New edit after reopening');assert.equal(h.stored.get('A').text,'New edit after reopening');assert.equal(h.stored.get('A').revision,'reopened-revision');assert.equal(h.c.doc,h.a.doc);
});

test('reopening while close storage is pending preserves new edits after a failed write',async()=>{
 const h=await fixture(),draft=deferred();h.hooks.draft=()=>draft.promise;const closing=h.c.closeTab(h.a);await until(()=>h.events.length===1);
 h.c.addTab({...copy(h.a.doc),text:'Older public body',dirty:false});assert.equal(h.c.activeTab,h.a);h.edit(h.a,'Live reopened edit');draft.reject(Error('Write failed'));assert.equal(await closing,false);assert.equal(h.source.value,'Live reopened edit');assert.equal(h.c.tabs.filter(t=>t.doc.id==='A').length,1);
 h.hooks.draft=null;await h.notes.flush();assert.equal(h.stored.get('A').text,'Live reopened edit');assert.equal(h.c.doc,h.a.doc);
});

test('reopening, editing and closing again while storage is pending persists the second close',async()=>{
 const h=await fixture(),draft=deferred();let first=true;h.hooks.draft=()=>{if(first){first=false;return draft.promise;}};const firstClose=h.c.closeTab(h.a);await until(()=>h.events.length===1);
 h.c.addTab({...copy(h.a.doc),text:'Older public body',dirty:false});h.edit(h.a,'New writing before second close');const secondClose=h.c.closeTab(h.a);draft.resolve({...h.events[0].doc,created:'now'});
 assert.equal(await firstClose,true);assert.equal(await secondClose,true);assert.equal(h.stored.get('A').text,'New writing before second close');assert.equal(h.events.filter(e=>e.type==='draft-start'&&e.doc.id==='A').length,2);assert.equal(h.c.closedTabs.length,1);
});

test('a reclose during session persistence is also followed by the latest durable snapshot',async()=>{
 const h=await fixture(),session=deferred();let first=true;h.hooks.session=()=>{if(first){first=false;return session.promise;}};const firstClose=h.c.closeTab(h.a);await until(()=>h.sessions.length===1);
 h.c.addTab({...copy(h.a.doc),text:'Older public body',dirty:false});h.edit(h.a,'Latest while session pending');const secondClose=h.c.closeTab(h.a);session.resolve();assert.equal(await firstClose,true);assert.equal(await secondClose,true);assert.equal(h.stored.get('A').text,'Latest while session pending');assert.equal(h.c.closedTabs.length,1);
});

test('restored unsaved duplicate gets a durable draft under its new identity',async()=>{
 const h=await fixture({paths:false}),draft=deferred();h.a.draftStamp=JSON.stringify([0,null,h.a.doc.revision,false]);h.hooks.draft=()=>draft.promise;const closing=h.c.closeTab(h.a);await until(()=>h.events.length===1);
 const reopened={id:'independent',doc:{...copy(h.a.doc),text:'Other open draft'},dirty:true,visual:false};h.c.tabs.push(reopened);h.c.activateTab(reopened);draft.reject(Error('Temporary failure'));assert.equal(await closing,false);const restoredId=h.a.doc.id;assert.notEqual(restoredId,reopened.doc.id);h.hooks.draft=null;await h.notes.flush();
 assert.equal(h.stored.get(restoredId).text,'Latest A');assert.equal(h.stored.get(reopened.doc.id).text,'Other open draft');assert.equal(h.c.activeTab,reopened);
});

test('closing the final Notepad uses an empty placeholder and does not persist that placeholder',async()=>{
 const h=await fixture({count:1}),draft=deferred();h.hooks.draft=()=>draft.promise;const closing=h.c.closeTab(h.a);await until(()=>h.events.length===1);
 const placeholder=h.c.activeTab;assert.equal(placeholder.placeholder,true);assert.equal(placeholder.doc.text,'');draft.resolve({...h.events[0].doc,created:'now'});assert.equal(await closing,true);await h.notes.flush();assert.equal(h.events.filter(e=>e.type==='draft-start').length,1);assert.equal(h.sessions.at(-1).tabs.length,0);
});

test('queued closing snapshot freezes its body, assets and nested metadata',async()=>{
 const h=await fixture(),save=deferred();h.hooks.autosave=()=>save.promise;const flushing=h.notes.flush();await until(()=>h.events.some(e=>e.type==='autosave-start'));
 h.a.doc.assets['assets/one.png']='ORIGINAL';h.a.doc.meta={nested:{label:'Original'}};h.edit(h.a,'Captured body');const closing=h.c.closeTab(h.a);
 h.a.doc.text='Later mutation';h.a.doc.assets['assets/one.png']='CHANGED';h.a.doc.meta.nested.label='Changed';save.resolve({...h.events.find(e=>e.type==='autosave-start').doc,revision:'captured-revision'});await flushing;assert.equal(await closing,true);
 const kept=h.stored.get('A');assert.equal(kept.text,'Captured body');assert.equal(kept.assets['assets/one.png'],'ORIGINAL');assert.equal(kept.meta.nested.label,'Original');assert.equal(kept.revision,'captured-revision');
});

test('close recovery uses the wrapped Notes API rather than a raw IPC fallback',async()=>{
 const h=await fixture();let wrapped=0,raw=0;h.notes.api.draft=async doc=>{wrapped++;return {...doc,created:'now'};};h.c.window.notemind.notes={draft:async()=>{raw++;throw Error('Raw API bypass');}};
 assert.equal(await h.c.closeTab(h.a),true);assert.equal(wrapped,1);assert.equal(raw,0);
});

test('session persistence failure restores the closing document after its draft succeeds',async()=>{
 const h=await fixture();h.hooks.session=async()=>{throw Error('Session unavailable');};
 assert.equal(await h.c.closeTab(h.a),false);assert.equal(h.c.tabs[0],h.a);assert.equal(h.a.doc.text,'Latest A');assert.equal(h.c.activeTab,h.b);assert.equal(h.stored.get('A').text,'Latest A');assert.match(h.elements.status.textContent,/Session unavailable/);
});

test('snapshot failure leaves the tab and its unsaved memory open',async()=>{
 const h=await fixture();h.notes.snapshot=()=>{throw Error('Snapshot unavailable');};
 assert.equal(await h.c.closeTab(h.a),false);assert.equal(h.c.activeTab,h.a);assert.equal(h.c.tabs.length,2);assert.equal(h.source.value,'Latest A');assert.equal(h.events.length,0);assert.match(h.elements.status.textContent,/Snapshot unavailable/);
});

test('autosave sends its freshly written recovery generation and adopts the clean response',async()=>{
 const h=await fixture();h.hooks.autosave=async doc=>{const written=h.events.find(e=>e.type==='draft-done'&&e.doc.id==='A');assert.equal(doc.recoveryId,written.doc.recoveryId);assert.equal(h.a.doc.recoveryId,written.doc.recoveryId);return {...doc,recoveryId:'committed-generation',revision:'committed-revision'};};
 await h.notes.flush();assert.equal(h.a.doc.recoveryId,'committed-generation');
});

test('redrafting newer edits adopts the latest generation for the next save',async()=>{
 const h=await fixture(),save=deferred();h.hooks.autosave=()=>save.promise;const flushing=h.notes.flush();await until(()=>h.events.some(e=>e.type==='autosave-start'));h.edit(h.a,'Later edit');save.resolve({...h.events.find(e=>e.type==='autosave-start').doc,recoveryId:'older-clean-generation',revision:'new-revision'});await flushing;
 assert.equal(h.a.doc.recoveryId,h.stored.get('A').recoveryId);assert.notEqual(h.a.doc.recoveryId,'older-clean-generation');assert.equal(h.stored.get('A').text,'Later edit');
});

test('manual save and final closing draft retain their newly published generation',async()=>{
 const h=await fixture();await h.notes.saveActive(true);assert.equal(h.a.doc.recoveryId,h.stored.get('A').recoveryId);const before=h.a.doc.recoveryId;assert.equal(await h.c.closeTab(h.a),true);assert.equal(h.a.doc.recoveryId,h.stored.get('A').recoveryId);assert.notEqual(h.a.doc.recoveryId,before);
});

test('manual save hydration failure adopts the committed revision while preserving newer dirty memory',async()=>{
 const h=await fixture(),wait=deferred(),receipt={id:'A',path:'/fixture/committed.nm',revision:'committed-after-reset',recoveryId:'new-recovery'};h.hooks.save=()=>wait.promise;const saving=h.notes.saveActive(true),rejected=assert.rejects(saving,/new images/);await until(()=>h.events.some(event=>event.type==='save-start'));h.edit(h.a,'Newer body after Save');h.a.doc.assets['assets/later.png']='LATER';wait.reject(Object.assign(Error('The file was saved, but its new images could not be loaded.'),{committed:receipt}));await rejected;assert.equal(h.a.doc.revision,receipt.revision);assert.equal(h.a.doc.path,receipt.path);assert.equal(h.a.doc.recoveryId,receipt.recoveryId);assert.equal(h.source.value,'Newer body after Save');assert.equal(h.a.doc.assets['assets/later.png'],'LATER');assert.equal(h.a.dirty,true);assert.equal(h.c.dirty,true);h.hooks.save=async snap=>{assert.equal(snap.revision,receipt.revision);return{...snap,revision:'next-save',recoverySaved:true}};assert.equal(await h.notes.saveActive(),true);
});
test('autosave hydration failure preserves committed ownership and the native unsaved indicator',async()=>{
 const h=await fixture(),native=[];h.c.window.notemind.dirty=(...args)=>native.push(args);h.hooks.autosave=async()=>{throw Object.assign(Error('The file was saved, but its new images could not be loaded.'),{committed:{path:'/fixture/committed.nm',revision:'new-public-revision',recoveryId:'committed-recovery'}})};await h.notes.flush();assert.equal(h.a.doc.revision,'new-public-revision');assert.equal(h.a.doc.recoveryId,'committed-recovery');assert.equal(h.a.dirty,true);assert.equal(h.c.dirty,true);assert.equal(native.at(-1)[0],true);assert.match(h.elements.status.textContent,/file was saved/);
});
test('an ordinary failed autosave keeps the native unsaved indicator enabled',async()=>{
 const h=await fixture(),native=[];h.c.window.notemind.dirty=(...args)=>native.push(args);h.hooks.autosave=async()=>{throw Error('Disk full')};await h.notes.flush();assert.equal(h.a.dirty,true);assert.equal(native.at(-1)[0],true);
});

test('ink preparation during a reopened close preserves newer live text and the next reclose',async()=>{
 const h=await fixture(),gate=deferred();let preparing=false;const pdf={captureSnapshot:(_tab,snapshot)=>snapshot,copyCapture:noop,prepareSnapshot:async(_tab,snapshot)=>{preparing=true;await gate.promise;return {...snapshot,assets:{...snapshot.assets,'assets/captured-ink.json':'INK'}};}};
 const queueGate=deferred();h.hooks.session=()=>queueGate.promise;const flushing=h.notes.flush();await until(()=>h.sessions.length>0);h.c.window.NoteMindPDFReferences=pdf;const closing=h.c.closeTab(h.a);h.c.addTab({...copy(h.a.doc),text:'Stale file'});assert.equal(h.c.activeTab,h.a);queueGate.resolve();await flushing;await until(()=>preparing);h.c.activateTab(h.b);h.edit(h.a,'New text while ink encodes');gate.resolve();await closing;assert.equal(h.a.doc.text,'New text while ink encodes');assert.equal(h.source.value,'Other B');await h.notes.flush();assert.equal(h.stored.get('A').text,'New text while ink encodes');
});
