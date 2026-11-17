const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/notes-core.js'),'utf8');
function fixture(recover,openPath=async()=>null){
 const initial={doc:{id:'initial',path:null,text:'',assets:{},meta:{}},dirty:false,visual:true},saved=[],elements={status:{},source:{value:''}},no=()=>{};
 const c={tabs:[initial],activeTab:initial,doc:initial.doc,dirty:false,source:elements.source,rich:{},structuredClone,Event:class{constructor(type){this.type=type}},setTimeout:()=>1,clearTimeout:no,$:id=>elements[id]||{},updateTitle(){assert.ok(c.activeTab&&c.tabs.includes(c.activeTab))},currentText:()=>c.source.value,rememberCurrent(){if(c.activeTab)c.activeTab.doc.text=c.source.value},render:text=>text};
 c.activateTab=tab=>{assert.ok(tab);c.activeTab=tab;c.doc=tab.doc;c.source.value=tab.doc.text};
 c.addTab=next=>{if(next.preview||next.workspace)return;c.rememberCurrent();const tab={doc:{...next,id:next.id||'blank',meta:next.meta||{}},dirty:!!next.dirty,visual:next.visual!==false};c.tabs.push(tab);c.activateTab(tab);if(next.id==='render-failure')throw Error('Cannot render recovered content')};
 c.window={notemind:{notes:{recover,onIndexProgress:no,draft:async doc=>{saved.push(doc);return {...doc,created:'now'}},session:async state=>state},openPath,dirty:no},addEventListener:no,dispatchEvent:no};
 vm.runInNewContext(source,c);return {c,notes:c.window.NoteMindNotes,initial,saved,elements};
}
const recovered=(id,text='Recovered')=>({id,path:null,text,assets:{},meta:{},dirty:false});

test('preview-only recovery retains a real active Notepad and can flush safely',async()=>{
 const h=fixture(async()=>({tabs:[{...recovered('picture'),path:'/fixture/picture.png'}],active:'picture'}),async()=>({preview:{path:'/fixture/picture.png'}}));
 await h.notes.startup();assert.equal(h.notes.ready,true);assert.equal(h.c.activeTab,h.initial);await h.notes.flush();assert.equal(h.saved.length,1);
});

test('one malformed or unrenderable entry cannot strand recovery or discard later Notepads',async()=>{
 const h=fixture(async()=>({tabs:[null,{id:'bad',text:42},recovered('render-failure'),recovered('good')],active:'good'}));
 await h.notes.startup();assert.equal(h.c.activeTab.doc.id,'good');assert.equal(h.c.tabs.length,1);assert.match(h.elements.status.textContent,/could not be restored/);await h.notes.flush();assert.equal(h.saved[0].id,'good');
});

test('a failed recovery request preserves the existing active Notepad',async()=>{
 const h=fixture(async()=>{throw Error('Recovery unavailable')});await h.notes.startup();assert.equal(h.c.activeTab,h.initial);assert.equal(h.notes.ready,true);await h.notes.flush();
});

test('close flush waits for restoration and writing entered while it loads survives',async()=>{
 let finish;const h=fixture(()=>new Promise(resolve=>finish=resolve)),startup=h.notes.startup();h.c.source.value='Writing during restore';h.initial.dirty=true;
 const flushing=h.notes.flush();await Promise.resolve();assert.equal(h.saved.length,0);finish({tabs:[recovered('good')],active:'good'});await startup;await flushing;
 assert.ok(h.c.tabs.includes(h.initial));assert.equal(h.initial.doc.text,'Writing during restore');assert.ok(h.saved.some(doc=>doc.id==='initial'&&doc.text==='Writing during restore'));
});
