const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const noop=()=>{},tick=()=>new Promise(setImmediate);
function fixture(){
 const tab=(id,text)=>({id,doc:{id,path:'/fixture/'+id+'.nm',text,assets:{},meta:{}},dirty:false,visual:false}),a=tab('A','leftRIGHT'),b=tab('B','Other note'),elements={status:{}},listeners={};
 const source={value:a.doc.text,selectionStart:4,selectionEnd:4,addEventListener:noop,setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end},setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=this.selectionEnd=start+text.length}};
 const api={onIndexProgress:noop,draft:async doc=>({...doc,created:'now'}),autosave:async doc=>({...doc,revision:'saved'}),session:async()=>{},indexImages:async()=>({count:0,errors:[]})};
 const c={NoteMindDocument:require('../src/document-renderer.cjs'),tabs:[a,b],activeTab:a,doc:a.doc,source,visual:false,rich:{addEventListener:noop,contains:()=>false},structuredClone,AbortController,setTimeout:()=>1,clearTimeout:noop,Date,crypto:require('node:crypto'),$:id=>elements[id]||{},updateTitle:noop,currentText:()=>source.value,rememberCurrent(){if(c.activeTab)c.activeTab.doc.text=source.value},Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},document:{addEventListener:noop},window:{notemind:{notes:api,dirty:noop,ocrCancel:async()=>{}},addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),dispatchEvent:()=>true},action:fn=>fn()};
 c.activateTab=target=>{c.rememberCurrent();c.activeTab=target;c.doc=target.doc;source.value=target.doc.text};c.window.NoteMindWriting={insertMarkdown(text){source.setRangeText(text,source.selectionStart,source.selectionEnd);c.doc.text=source.value;c.activeTab.dirty=true}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('src/notes-core.js','utf8'),c);return {c,a,b,api,source,notes:c.window.NoteMindNotes};
}
test('deferred image pastes stay ordered in their initiating inactive Notepad',async()=>{
 const h=fixture(),readers=[];h.c.FileReader=class{readAsDataURL(){readers.push(this)}};vm.runInContext(fs.readFileSync('src/notes-clipboard.js','utf8'),h.c);
 h.c.window.NoteMindClipboard.paste({clipboardData:{getData:()=>'',files:[{name:'first.png',type:'image/png'},{name:'second.png',type:'image/png'}]}});h.c.activateTab(h.b);
 readers[0].result='data:image/png;base64,FIRST';readers[0].onload();await tick();readers[1].result='data:image/png;base64,SECOND';readers[1].onload();await tick();
 assert.equal(h.c.activeTab,h.b);assert.equal(h.source.value,'Other note');assert.equal(Object.keys(h.b.doc.assets).length,0);assert.equal(Object.keys(h.a.doc.assets).length,2);assert.ok(h.a.doc.text.indexOf('first.png')<h.a.doc.text.indexOf('second.png'));assert.ok(h.a.doc.text.startsWith('left\n\n!['));assert.ok(h.a.doc.text.endsWith('RIGHT'));
});
test('closing the original Notepad rejects a late insertion without touching another file',()=>{
 const h=fixture(),target=h.notes.captureInsertion();h.c.activateTab(h.b);h.c.tabs=[h.b];assert.throws(()=>h.notes.insertAssetFor(target,'assets/paste.png','AAAA'),/no longer open/);assert.equal(h.b.doc.text,'Other note');assert.equal(Object.keys(h.b.doc.assets).length,0);
});
test('dense drawing sidecars insert into their initiating inactive Notepad without geometry decoding or re-encoding',()=>{
 const h=fixture(),target=h.notes.captureInsertion(),sidecar=Buffer.from(require('../src/graphics-pane.js').encodeBytes({name:'Dense drawing',aspect:1,strokes:[]})).toString('base64');
 h.c.activateTab(h.b);assert.equal(h.notes.insertAssetFor(target,'assets/dense.svg','PREVIEW',null,sidecar),true);
 assert.equal(h.a.doc.assets['assets/dense.svg.json'],sidecar);assert.ok(h.a.doc.text.includes('![Drawing](assets/dense.svg)'));assert.equal(h.c.activeTab,h.b);assert.equal(h.b.doc.text,'Other note');assert.equal(Object.keys(h.b.doc.assets).length,0);
});
test('active drawing insertion forwards its encoded sidecar unchanged',()=>{
 const h=fixture(),target=h.notes.captureInsertion(),calls=[];h.c.insertAsset=(...args)=>{calls.push(args);return true;};
 h.notes.insertAssetFor(target,'assets/dense.svg','PREVIEW',null,'ENCODED');assert.deepEqual(calls,[['assets/dense.svg','PREVIEW',null,'ENCODED']]);
});
test('sequential recognized pages preserve the original insertion position before the suffix across tab changes',()=>{
 const h=fixture(),target=h.notes.captureInsertion();h.c.activateTab(h.b);h.notes.insertTextFor(target,'one\n');h.notes.insertTextFor(target,'two\n');assert.equal(h.a.doc.text,'leftone\ntwo\nRIGHT');assert.equal(h.b.doc.text,'Other note');
 h.c.activateTab(h.a);h.c.insertText=text=>{h.source.setRangeText(text,h.source.selectionStart,h.source.selectionEnd);h.a.doc.text=h.source.value;};h.notes.insertTextFor(target,'three\n');assert.equal(h.source.value,'leftone\ntwo\nthree\nRIGHT');h.c.activateTab(h.b);h.notes.insertTextFor(target,'four\n');assert.equal(h.a.doc.text,'leftone\ntwo\nthree\nfour\nRIGHT');assert.equal(target.start,23);
});
test('recognized text can return to an inactive plain-text file without changing the current tab',()=>{
 const h=fixture();h.a.doc.path='/fixture/A.txt';const target=h.notes.captureInsertion();h.c.activateTab(h.b);h.notes.insertTextFor(target,'recognized');assert.equal(h.a.doc.text,'leftrecognizedRIGHT');assert.equal(h.c.activeTab,h.b);assert.equal(h.b.doc.text,'Other note');assert.equal(Object.keys(h.a.doc.assets).length,0);
 h.c.tabs=[h.b];assert.throws(()=>h.notes.insertTextFor(target,'late'),/no longer open/);assert.equal(h.b.doc.text,'Other note');
});
function loadAttachments(h){vm.runInContext(fs.readFileSync('src/notes-attachments.js','utf8'),h.c);return h.c.window.NoteMindAttachments;}
test('attachments returning from an asynchronous import go into their original Notepad',async()=>{
 const h=fixture();let finish;h.api.attach=()=>new Promise(resolve=>finish=resolve);const attachments=loadAttachments(h),pending=attachments.attach();h.c.activateTab(h.b);finish([{name:'assets/a.pdf',assets:{'assets/a.pdf':'AAAA'},info:{title:'A.pdf'}}]);await pending;
 assert.equal(h.c.activeTab,h.b);assert.ok(h.a.doc.text.includes('[A.pdf](assets/a.pdf)'));assert.equal(h.a.doc.assets['assets/a.pdf'],'AAAA');assert.equal(h.b.doc.text,'Other note');
});
function scanFixture(){
 const h=fixture(),cancelled=[],reads=[],element=()=>({children:[],setAttribute:noop,append(...children){this.children.push(...children)},replaceChildren(){this.children=[]}});h.c.document.createElement=element;h.c.window.NoteMindScanLimits=require('../src/scan-limits.js');h.c.window.notemindScanPages=async()=>[{name:'Page 1',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}];
 h.c.window.notemind.ocrRead=({id})=>new Promise((resolve,reject)=>reads.push({id,resolve,reject}));h.c.window.notemind.ocrCancel=async id=>{cancelled.push(id);reads.find(read=>read.id===id)?.reject(Error('cancelled'))};h.api.scanPDF=async()=>({name:'assets/scan.pdf',assets:{'assets/scan.pdf':'AAAA'},info:{title:'Scan.pdf'}});
 let dialog;h.notes.dialog=(_title,_body,actions)=>{const events={},box=element(),message={},buttons=actions.map(action=>({textContent:action.label})).concat({textContent:'Close'});dialog={actions,box,buttons,querySelector:key=>key==='.scan-pages'?box:message,querySelectorAll:()=>buttons,addEventListener:(name,fn)=>events[name]=fn,close(){events.close?.()}};return dialog};
 return {...h,cancelled,reads,attachments:loadAttachments(h),get dialog(){return dialog}};
}
test('closing a scan cancels its pending OCR and prevents a late PDF insertion',async()=>{
 const h=scanFixture();await h.attachments.scan();const pending=h.dialog.actions.find(action=>action.label==='Insert Scan').run();await tick();assert.equal(h.reads.length,1);h.dialog.close();await pending;
 assert.deepEqual(h.cancelled,[h.reads[0].id]);assert.equal(Object.keys(h.a.doc.assets).length,0);assert.equal(Object.keys(h.b.doc.assets).length,0);
});
test('scan completion keeps its initiating Notepad while another one is active',async()=>{
 const h=scanFixture();await h.attachments.scan();const pending=h.dialog.actions.find(action=>action.label==='Insert Scan').run();await tick();h.c.activateTab(h.b);h.reads[0].resolve({text:'Recognized'});await pending;
 assert.equal(h.a.doc.assets['assets/scan.pdf'],'AAAA');assert.ok(h.a.doc.text.includes('assets/scan.pdf'));assert.equal(h.c.activeTab,h.b);assert.equal(h.b.doc.text,'Other note');
});
test('closing a scan during PDF generation also prevents a late insertion',async()=>{
 const h=scanFixture();let finish;h.api.scanPDF=()=>new Promise(resolve=>finish=resolve);await h.attachments.scan();const pending=h.dialog.actions.find(action=>action.label==='Insert Scan').run();await tick();h.reads[0].resolve({text:'Recognized'});await tick();h.dialog.close();finish({name:'assets/scan.pdf',assets:{'assets/scan.pdf':'AAAA'},info:{title:'Scan.pdf'}});await pending;assert.equal(Object.keys(h.a.doc.assets).length,0);
});
test('attachment insertion checks final target capacity before changing text, metadata, assets or history',()=>{const h=fixture(),admission=require('../src/asset-admission.js'),assets={'assets/old.pdf':'AQIDBAUG'},meta={tags:['original']};h.a.doc.assets=assets;h.a.doc.meta=meta;const target=h.notes.captureInsertion();h.c.activateTab(h.b);let history=0;h.c.window.NoteMindHistory={initialize:()=>history++,record:noop};h.c.window.NoteMindAssetAdmission={admit:(current,options)=>admission.admit(current,{...options,totalLimit:9})};assert.throws(()=>h.notes.insertMarkdownFor(target,'[New](assets/new.pdf)',{assets:{'assets/new.pdf':'AQIDBA=='},attachment:{name:'assets/new.pdf',info:{title:'New'}}}),/199 MB/);assert.equal(h.a.doc.assets,assets);assert.equal(h.a.doc.meta,meta);assert.equal(h.a.doc.text,'leftRIGHT');assert.equal(history,0);assert.equal(h.a.dirty,false);assert.equal(h.b.doc.text,'Other note');assert.equal(h.notes.insertMarkdownFor(target,'[New](assets/new.pdf)',{assets:{'assets/new.pdf':'AQID'}}),true);assert.equal(h.a.doc.assets['assets/new.pdf'],'AQID');assert.equal(history,1)});
test('prototype-named asset and attachment keys remain own values in an inactive Notepad',()=>{const h=fixture(),target=h.notes.captureInsertion();h.c.activateTab(h.b);const assets=Object.fromEntries([['__proto__','AQID'],['constructor','BAUG']]);h.c.window.NoteMindAssetAdmission=require('../src/asset-admission.js');assert.equal(h.notes.insertMarkdownFor(target,'[Source](__proto__)',{assets,attachment:{name:'__proto__',info:{title:'Source'}}}),true);assert.equal(Object.hasOwn(h.a.doc.assets,'__proto__'),true);assert.equal(h.a.doc.assets.__proto__,'AQID');assert.equal(h.a.doc.assets.constructor,'BAUG');assert.equal(Object.hasOwn(h.a.doc.meta.attachments,'__proto__'),true);assert.equal(h.a.doc.meta.attachments.__proto__.title,'Source')});
test('chosen image chunks remain owned when insertion returns to an inactive Notepad',()=>{const h=fixture(),sync=require('../src/document-sync.js').create({uuid:require('node:crypto').randomUUID,invoke:()=>assert.fail()}),target=h.notes.captureInsertion(),chunks=Array(8).fill('A'.repeat(262144));let data='';for(const chunk of chunks)data+=chunk;h.c.window.NoteMindDocumentSync=sync;h.c.window.NoteMindAssetAdmission=require('../src/asset-admission.js');h.c.activateTab(h.b);assert.equal(h.notes.insertAssetFor(target,'assets/chosen.png',data,null,null,null,chunks),true);assert.equal(h.a.doc.assets['assets/chosen.png'],data);assert.deepEqual(sync.assetChunks(h.a.doc.assets,'assets/chosen.png'),chunks);assert.equal(h.b.doc.assets['assets/chosen.png'],undefined)});
