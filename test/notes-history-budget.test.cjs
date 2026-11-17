const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({budget=8192,assets={},text='Original'}={}){
 const listeners={},windowListeners={},observers=[],a={doc:{id:'A',text,assets,meta:{}},dirty:false},b={doc:{id:'B',text:'Other note',assets:{},meta:{}},dirty:false},source={value:text},rich={contains:()=>false,innerHTML:''},body={},strip={};let api;
 const c={activeTab:a,tabs:[a,b],doc:a.doc,source,rich,structuredClone,WeakRef,queueMicrotask,richChanged:false,render:text=>text,currentText:()=>source.value,markDirty:()=>api.record(c.activeTab),document:{activeElement:source,body,contains:()=>true,getElementById:()=>strip,addEventListener:(name,fn)=>listeners[name]=fn,execCommand(){}},MutationObserver:class{constructor(fn){observers.push(fn)}observe(){}},window:{addEventListener:(name,fn)=>windowListeners[name]=fn,NoteMindWriting:{decorate(){}},NoteMindFind:{refresh(){}}}};
 const code=fs.readFileSync(require.resolve('../src/notes-history.js'),'utf8').replace('const MAX_BYTES=192*1024*1024','const MAX_BYTES='+budget);vm.runInNewContext(code,c);api=c.window.NoteMindHistory;api.initialize(a);
 const edit=(value,{input=true}={})=>{if(input){listeners.keydown({target:source,key:'x',isTrusted:true});listeners.input({target:source,inputType:'insertText',data:'x',isTrusted:true});}source.value=value;c.doc.text=value;api.record(c.activeTab);};
 const activate=tab=>{c.activeTab=tab;c.doc=tab.doc;source.value=tab.doc.text;api.initialize(tab);};
 return{c,a,b,api,listeners,windowListeners,observers,edit,activate};
}
test('typing undo/redo stays correct before and after globally evicting old asset versions',()=>{
 const f=fixture({assets:{'assets/image.png':'A'.repeat(3000)}});f.edit('First');f.edit('Second');f.api.step();assert.equal(f.c.doc.text,'First');f.api.step(true);assert.equal(f.c.doc.text,'Second');
 for(let i=0;i<12;i++){f.c.doc.assets['assets/image.png']=String(i).padStart(2,'0')+'x'.repeat(3000);f.api.record(f.a);}assert.ok(f.api.stats().retainedBytes<=8192);assert.ok(f.a.textHistory.past.length<12);const latest=f.c.doc.assets['assets/image.png'];f.api.step();assert.notEqual(f.c.doc.assets['assets/image.png'],latest);f.api.step(true);assert.equal(f.c.doc.assets['assets/image.png'],latest);assert.ok(f.api.stats().retainedBytes<=8192);
});
test('budgets span tabs, deduplicate shared assets and preserve oversized current documents',()=>{
 const image='shared'.repeat(3000),f=fixture({assets:{'assets/shared.png':image},budget:4096});f.b.doc.assets={'assets/shared.png':image};f.api.initialize(f.b);assert.equal(f.api.stats().retainedBytes,0);f.edit('A edit');f.activate(f.b);f.edit('B edit');assert.ok(f.api.stats().states>=2);assert.ok(f.api.stats().protectedBytes>4096);assert.equal(f.a.doc.assets['assets/shared.png'],image);assert.equal(f.b.doc.assets['assets/shared.png'],image);assert.ok(f.api.stats().retainedBytes<=4096);
});
test('a thousand-image text input does no asset scan or value traversal per keystroke',()=>{
 let reads=0;const assets={};for(let i=0;i<1000;i++)Object.defineProperty(assets,'assets/'+i+'.png',{enumerable:true,get:()=>{reads++;return 'image'+i}});const f=fixture({assets,budget:1024*1024}),initialReads=reads,scans=f.api.stats().assetScans;
 for(let i=0;i<200;i++)f.edit('Typing '+i);assert.equal(reads,initialReads);assert.equal(f.api.stats().assetScans,scans);assert.equal(f.a.textHistory.past.length,100);f.api.step();assert.equal(f.c.doc.text,'Typing 198');
});
test('text-input accounting hints cannot suppress later asynchronous asset or metadata changes',async()=>{
 const f=fixture({assets:{'assets/a.png':'ORIGINAL'}});f.edit('Typing');await Promise.resolve();f.c.doc.assets['assets/a.png']='REPLACED';f.c.doc.meta.tags=['changed'];f.api.record(f.a);f.api.step();assert.equal(f.c.doc.assets['assets/a.png'],'ORIGINAL');assert.deepEqual(Array.from(f.c.doc.meta.tags||[]),[]);f.api.step(true);assert.equal(f.c.doc.assets['assets/a.png'],'REPLACED');assert.deepEqual(Array.from(f.c.doc.meta.tags),['changed']);
});
test('closed-tab cleanup drops its history without changing the surviving current document',()=>{
 const f=fixture({assets:{'assets/a.png':'A'.repeat(3000)}});f.edit('A changed');f.activate(f.b);f.edit('B changed');const before=f.b.doc.text;f.c.tabs=[f.b];for(const observer of f.observers)observer();assert.equal(f.a.textHistory,undefined);assert.equal(f.api.stats().tabs,1);assert.equal(f.b.doc.text,before);assert.equal(f.api.stats().retainedBytes<8192,true);f.api.step();assert.equal(f.c.doc.text,'Other note');
});
test('IME key and menu undo cannot intercept composition, then undo works after composition ends',()=>{
 const f=fixture();f.edit('Composing result');for(const extra of[{isComposing:true},{keyCode:229}]){let prevented=false;f.listeners.keydown({key:'z',ctrlKey:true,preventDefault:()=>prevented=true,...extra});assert.equal(prevented,false);assert.equal(f.c.doc.text,'Composing result');}
 f.listeners.compositionstart();f.windowListeners['notemind-command']({detail:'undoText'});assert.equal(f.c.doc.text,'Composing result');f.listeners.compositionend();let prevented=false;f.listeners.keydown({key:'z',metaKey:true,preventDefault:()=>prevented=true});assert.equal(prevented,true);assert.equal(f.c.doc.text,'Original');
});
test('asset transactions retain the original tab even when their synchronous work changes focus',()=>{
 const f=fixture();f.api.transaction(()=>{f.a.doc.assets['assets/new.png']='NEW';f.activate(f.b)});f.activate(f.a);f.api.step();assert.equal(f.c.doc.assets['assets/new.png'],undefined);assert.equal(f.b.doc.text,'Other note');
});
test('oversized current text and metadata remain intact while older undo-only values are bounded',()=>{
 const f=fixture({budget:1024,text:'A'.repeat(2000)});f.edit('B'.repeat(2000));assert.equal(f.c.doc.text,'B'.repeat(2000));assert.ok(f.api.stats().retainedBytes<=1024);f.c.doc.meta.value='first'.repeat(1000);f.api.record(f.a);f.c.doc.meta.value='second'.repeat(1000);f.api.record(f.a);assert.equal(f.c.doc.meta.value,'second'.repeat(1000));assert.ok(f.api.stats().retainedBytes<=1024);assert.ok(f.api.stats().protectedBytes>1024);
});
test('repeated edits and undo/redo keep accounting nonnegative and match retained entry ownership',()=>{
 const f=fixture({budget:4096});let seed=7;for(let i=0;i<600;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const op=seed%4;if(op===0){f.c.doc.assets['assets/image.png']=String(i)+'x'.repeat(200);f.api.record(f.a);}else if(op===1)f.edit('Text '+i);else f.api.step(op===3);const value=f.api.stats();assert.ok(value.retainedBytes>=0&&value.retainedBytes<=4096);assert.ok(value.totalBytes>=value.retainedBytes);assert.equal(value.states,f.a.textHistory.past.length+f.a.textHistory.future.length);}
 f.c.tabs=[];f.api.prune();assert.equal(f.api.stats().totalBytes,0);assert.equal(f.api.stats().retainedBytes,0);
});

test('programmatic insertText after synchronous image mutation cannot create an image-less undo state',()=>{
 const f=fixture(),name='assets/inserted.png';f.c.doc.assets[name]='IMAGE';f.c.doc.meta.graphicsPanes={[name]:{version:1}};f.c.source.value=f.c.doc.text='![Image]('+name+')';f.listeners.input({target:f.c.source,inputType:'insertText',data:null,isTrusted:true});f.api.record(f.a);f.api.record(f.a);f.api.step();assert.equal(f.c.doc.text,'Original');assert.equal(f.c.doc.assets[name],undefined);f.api.step(true);assert.equal(f.c.doc.text,'![Image]('+name+')');assert.equal(f.c.doc.assets[name],'IMAGE');
});
test('prevented or mismatched physical keys do not lend provenance to programmatic asset edits',()=>{
 for(const prevented of[true,false]){const f=fixture(),event={key:'Enter',isTrusted:true,defaultPrevented:false};f.listeners.keydown(event);event.defaultPrevented=prevented;f.c.doc.assets['assets/new.png']='NEW';f.c.source.value=f.c.doc.text='Inserted image';f.listeners.input({target:f.c.source,inputType:'insertText',data:'Inserted image',isTrusted:true});f.api.record(f.a);f.api.step();assert.equal(f.c.doc.text,'Original');assert.equal(f.c.doc.assets['assets/new.png'],undefined);f.api.step(true);assert.equal(f.c.doc.assets['assets/new.png'],'NEW');}
});
