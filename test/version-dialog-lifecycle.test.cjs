const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),domino=require('@mixmark-io/domino');
const noop=()=>{},tick=()=>new Promise(setImmediate);
function fixture(){
 const dom=domino.createWindow('<article id="rich"></article><span id="status"></span>'),document=dom.document;dom.Element.prototype.append=function(...nodes){for(const node of nodes)this.appendChild(typeof node==='string'?document.createTextNode(node):node)};dom.Element.prototype.prepend=function(...nodes){for(const node of nodes.reverse())this.insertBefore(node,this.firstChild)};
 const target={id:1,doc:{id:'A',text:'Current A',assets:{},meta:{}},editVersion:0},other={id:2,doc:{id:'B',text:'Current B',assets:{},meta:{}},editVersion:0},reads=[],snapshots=[],errors=[];let dialog;
 const api={onChanged:noop,versions:async()=>[{id:'old',label:'Old',created:'2020-01-01'},{id:'new',label:'New',created:'2021-01-01'}],version:(_note,id)=>new Promise(resolve=>reads.push({id,resolve})),snapshot:()=>new Promise(resolve=>snapshots.push(resolve)),meta:async()=>{}};
 const c={document,tabs:[target,other],activeTab:target,doc:target.doc,editorText:target.doc.text,rich:document.getElementById('rich'),NoteMindDocument:require('../src/document-renderer.cjs'),$:id=>document.getElementById(id),escapeHtml:s=>s,setTimeout,clearTimeout};
 c.rememberCurrent=()=>{if(c.activeTab)c.activeTab.doc.text=c.editorText};c.activateTab=tab=>{if(c.activeTab===tab)return;c.rememberCurrent();c.activeTab=tab;c.doc=tab.doc;c.editorText=tab.doc.text};c.markDirty=()=>c.activeTab.editVersion++;
 const N={api,flush:async()=>c.rememberCurrent(),snapshot:tab=>{if(tab===c.activeTab)c.rememberCurrent();return structuredClone(tab.doc)},dialog:(_title,body)=>{dialog=document.createElement('div');dialog.innerHTML=body+'<p class="notes-message"></p>';dialog.close=()=>{dialog.dispatchEvent(new dom.Event('close'));dialog.remove()};document.body.appendChild(dialog);return dialog}};
 c.window={NoteMindNotes:N,addEventListener:noop};c.action=fn=>Promise.resolve().then(fn).catch(error=>errors.push(error.message));vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/notes-library.js'),'utf8'),c);
 return {c,target,other,reads,snapshots,errors,get dialog(){return dialog},versions:()=>c.window.NoteMindLibrary.versions(),resolve(index,text){reads[index].resolve({text,assets:{},meta:{}})}};
}
test('Version History ignores an older preview response and closed-dialog responses',async()=>{
 const h=fixture();await h.versions();h.dialog.querySelectorAll('.version-list button')[1].click();h.resolve(1,'OLD VERSION');await tick();h.resolve(0,'NEW VERSION');await tick();assert.match(h.dialog.querySelector('.version-preview').textContent,/OLD VERSION/);assert.doesNotMatch(h.dialog.querySelector('.version-preview').textContent,/NEW VERSION/);
 h.dialog.querySelectorAll('.version-list button')[0].click();h.dialog.close();h.resolve(2,'AFTER CLOSE');await tick();assert.doesNotMatch(h.dialog.querySelector('.version-preview').textContent,/AFTER CLOSE/);
});
test('restoring an inactive Notepad preserves edits in the current Notepad',async()=>{
 const h=fixture();await h.versions();h.resolve(0,'RESTORED A');await tick();h.c.activateTab(h.other);const restoring=h.dialog.querySelector('.restore-version').onclick();await tick();h.c.editorText='B typed while snapshot was saving';h.snapshots[0]();await restoring;
 assert.equal(h.target.doc.text,'RESTORED A');assert.equal(h.other.doc.text,'B typed while snapshot was saving');assert.deepEqual(h.errors,[]);
});
test('closing the original Notepad during a version snapshot prevents restoration',async()=>{
 const h=fixture();await h.versions();h.resolve(0,'RESTORED A');await tick();h.c.activateTab(h.other);const restoring=h.dialog.querySelector('.restore-version').onclick();await tick();h.c.tabs=[h.other];h.snapshots[0]();await restoring;
 assert.equal(h.c.activeTab,h.other);assert.equal(h.target.doc.text,'Current A');assert.match(h.errors[0],/no longer open/);
});
test('edits made while a version snapshot saves prevent an outdated restoration',async()=>{
 const h=fixture();await h.versions();h.resolve(0,'RESTORED A');await tick();const restoring=h.dialog.querySelector('.restore-version').onclick();await tick();h.c.editorText='A typed during snapshot';h.target.editVersion++;h.snapshots[0]();await restoring;
 assert.equal(h.c.editorText,'A typed during snapshot');assert.match(h.errors[0],/changed while restoring/);
});
test('version previews use an independent lazy image owner and release stale or closed reference documents',async()=>{
 const h=fixture(),refs=require('../src/document-asset-reference.js'),image=refs.create({id:require('node:crypto').randomUUID(),bytes:3,chars:4,sha256:'a'.repeat(64),mime:'image/png',binaryGraphics:false,width:30,height:20}),released=[],owners=[];
 h.c.window.NoteMindDocumentSync={releaseDocument:value=>released.push(value)};h.c.window.NoteMindImagePreviews={create:options=>{assert.equal(options.lazy,true);const owner={url:(name,value)=>{assert.equal(value,image);return'blob:version';},size:()=>({width:30,height:20}),retainMany:values=>owner.retained=values,mount:(element,getAssets)=>{owner.element=element;owner.getAssets=getAssets;},clear:()=>owner.cleared=(owner.cleared||0)+1};owners.push(owner);return owner;}};
 await h.versions();const old={text:'![Image](assets/a.png)',assets:{'assets/a.png':image},meta:{}};h.reads[0].resolve(old);await tick();assert.equal(owners.length,1);assert.equal(owners[0].getAssets()['assets/a.png'],image);assert.match(h.dialog.querySelector('.version-preview').innerHTML,/blob:version/);
 h.dialog.querySelectorAll('.version-list button')[1].click();assert.ok(released.includes(old));h.dialog.close();const late={text:'Late',assets:{'assets/a.png':image},meta:{}};h.reads[1].resolve(late);await tick();assert.ok(released.includes(late));assert.ok(owners[0].cleared>=2);
});
test('closing a version dialog during its safety snapshot keeps the restoration capture until that work settles',async()=>{
 const h=fixture(),held=new Set(),released=[];h.c.window.NoteMindDocumentSync={capture:value=>{const captured={...value,assets:{...value.assets}};held.add(captured);return captured;},releaseDocument:value=>{held.delete(value);released.push(value);}};
 await h.versions();h.resolve(0,'RESTORED');await tick();const restoring=h.dialog.querySelector('.restore-version').onclick();await tick();assert.equal(held.size,1);h.dialog.close();assert.equal(held.size,1);h.snapshots[0]();await restoring;assert.equal(held.size,0);assert.equal(h.target.doc.text,'Current A');
});
