const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),domino=require('@mixmark-io/domino');
const noop=()=>{};
function fixture(html='<p>cat cat</p>',visual=true){
 const document=domino.createDocument('<div id="toolbar"></div><article id="rich">'+html+'</article><textarea id="source"></textarea>');
 Object.getPrototypeOf(document.querySelectorAll('input'))[Symbol.iterator]=Array.prototype[Symbol.iterator];
 document.getElementById('rich').constructor.prototype.scrollIntoView=noop;
 let created=0,observer,selected,scans=0;const handlers={};
 class TextRange{setStart(node,offset){this.startContainer=node;this.startOffset=offset}setEnd(node,offset){this.endContainer=node;this.endOffset=offset}}
 document.createRange=()=>{created++;return new TextRange()};
 const c={document,visual,doc:{meta:{}},activeTab:{editVersion:0},rich:document.getElementById('rich'),source:document.getElementById('source'),localStorage:{getItem:()=>null,setItem:noop},CSS:{highlights:new Map()},Highlight:class extends Set{constructor(...ranges){super(ranges)}},MutationObserver:class{constructor(callback){observer=this;this.callback=callback;this.records=[]}observe(root,options){this.root=root;this.options=options;this.connected=true}disconnect(){this.connected=false;this.records=[]}takeRecords(){const records=this.records;this.records=[];return records}},NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2},window:{addEventListener:(name,fn)=>handlers[name]=fn},getSelection:()=>({toString:()=>'',removeAllRanges:noop,addRange:range=>selected=range}),$:id=>document.getElementById(id),scanObserved:()=>scans++};
 c.source.value='cat cat';c.source.setSelectionRange=(start,end)=>{c.source.selectionStart=start;c.source.selectionEnd=end};
 const code=fs.readFileSync(path.join(__dirname,'../src/notes-find.js'),'utf8').replace('function scan(text){','function scan(text){scanObserved();');vm.runInNewContext(code,c);
 const input=document.querySelector('.note-find input');input.value='cat';input.select=noop;const api=c.window.NoteMindFind;api.open();
 return {c,api,input,handlers,get observer(){return observer},get created(){return created},get scans(){return scans},get selected(){return selected},current:()=>c.CSS.highlights.get('note-current')?.values().next().value,queue:()=>observer.records.push({type:'characterData'}),mutate(html){c.rich.innerHTML=html;observer.records.push({type:'childList'});}};
}
test('unchanged visual navigation reuses every range and closes without retaining the match graph',()=>{
 const h=fixture('<p>'+'a'.repeat(150000)+'</p>');h.input.value='a';h.input.oninput();const created=h.created,scans=h.scans,all=h.c.CSS.highlights.get('note-find');
 for(let at=0;at<3;at++)h.api.move(1);
 assert.equal(h.created,created);assert.equal(h.scans,scans);assert.equal(h.api.matches,150000);assert.equal(all.size,150000);assert.equal(h.current().startOffset,3);
 const current=h.current();h.api.close();assert.equal(h.selected,current);assert.equal(h.api.matches,0);assert.equal(h.c.CSS.highlights.size,0);h.api.open();assert.equal(h.created-created,150000);
});
test('same-turn character, subtree and control-attribute edits invalidate before observer callback',()=>{
 const h=fixture();h.c.rich.firstChild.firstChild.data='cat dog cat';h.queue();h.api.move(1);assert.equal(h.api.matches,2);assert.equal(h.current().startOffset,8);
 h.mutate('<p>dog cat</p>');h.api.move(1);assert.equal(h.api.matches,1);assert.equal(h.current().startOffset,4);
 h.c.rich.firstChild.setAttribute('data-editor-control','');h.observer.records.push({type:'attributes'});h.api.refresh();assert.equal(h.api.matches,0);
 assert.equal(h.observer.options.characterData,true);assert.equal(h.observer.options.childList,true);assert.equal(h.observer.options.attributes,true);assert.equal(h.observer.options.subtree,true);
});
test('delivered rich mutations, query and both options cause one exact rebuild',()=>{
 const h=fixture('<p>cat Cat scatter</p>');h.observer.callback([{type:'attributes'}]);h.api.move(1);assert.equal(h.created,6);
 h.input.value='Cat';h.input.oninput();assert.equal(h.api.matches,3);assert.equal(h.created,9);
 h.c.document.querySelector('[data-case]').onclick();assert.equal(h.api.matches,1);assert.equal(h.created,10);
 h.c.document.querySelector('[data-word]').onclick();assert.equal(h.api.matches,1);assert.equal(h.created,11);
 h.api.move(1);assert.equal(h.created,11);
});
test('document, tab, edit revision, node realm and highlight registry own cached ranges',()=>{
 for(const mutate of [h=>h.c.doc={meta:{}},h=>h.c.activeTab={editVersion:0},h=>h.c.activeTab.editVersion++,h=>{const before=h.c.document;h.c.document=domino.createDocument('<p></p>');h.c.document.createRange=before.createRange},h=>h.c.CSS.highlights=new Map()]){
  const h=fixture();const created=h.created;mutate(h);h.api.refresh();assert.equal(h.created-created,2);h.api.move(1);assert.equal(h.created-created,2);
 }
 const h=fixture(),old=h.c.rich;h.c.rich=h.c.document.createElement('article');h.c.rich.innerHTML='<p>cat</p>';old.parentNode.replaceChild(h.c.rich,old);h.api.refresh();assert.equal(h.api.matches,1);assert.equal(h.observer.root,h.c.rich);
});
test('changed owner or same-turn edit cannot restore a retired range on close',()=>{
 for(const change of [h=>h.c.activeTab={},h=>h.mutate('<p>dog</p>')]){const h=fixture();h.api.move(0);change(h);h.api.close();assert.equal(h.selected,undefined);assert.equal(h.api.matches,0);}
});
test('source navigation reuses scans but exact programmatic value and mode changes invalidate',()=>{
 const h=fixture('<p>cat cat</p>',false);assert.equal(h.scans,1);h.api.move(1);h.api.move(1);assert.equal(h.scans,1);h.c.source.value='dog cat';h.api.move(1);assert.equal(h.scans,2);assert.equal(h.api.matches,1);assert.equal(h.c.source.selectionStart,4);
 h.c.visual=true;h.api.move(0);assert.equal(h.scans,3);assert.equal(h.created,2);h.c.visual=false;h.api.refresh();assert.equal(h.scans,4);
});
test('lost highlight publication is restored without rebuilding and unload drops its owner',()=>{const h=fixture(),all=h.c.CSS.highlights.get('note-find');h.c.CSS.highlights.delete('note-find');h.api.move(1);assert.equal(h.c.CSS.highlights.get('note-find'),all);assert.equal(h.created,2);h.handlers.unload();assert.equal(h.observer.connected,false);assert.equal(h.api.matches,0);assert.equal(h.c.CSS.highlights.size,0)});
