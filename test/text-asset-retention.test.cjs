const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const references=require('../src/document-asset-reference.js'),sync=require('../src/document-sync.js'),previews=require('../src/image-previews.js');
const historySource=fs.readFileSync(require.resolve('./notes-history-budget.test.cjs'),'utf8').split("\ntest('typing undo")[0],{fixture:historyFixture}=new Function('require',historySource+'\nreturn {fixture};')(require);
const renderer=fs.readFileSync(require.resolve('../src/renderer.js'),'utf8');
const makeRef=()=>references.create({id:randomUUID(),bytes:4,chars:8,sha256:'a'.repeat(64),mime:'image/png',binaryGraphics:false,width:1,height:1});
const tick=()=>new Promise(setImmediate);
function fixture(){
 let scans=0,retains=0;const values={},assets=new Proxy(values,{ownKeys(target){scans++;return Reflect.ownKeys(target);}}),client=sync.create({uuid:randomUUID,invoke:async()=>{throw Error('unexpected document request');},retain:async()=>{retains++;}}),images=previews.create({lazy:true,isRef:client.isRef,identity:client.assetIdentity,info:client.info});
 for(let i=0;i<500;i++)values['assets/'+i+'.png']=makeRef();
 const f=historyFixture({assets,sync:client,budget:1024*1024}),c=f.c,title={textContent:''};
 client.setCurrentAssetProvider(()=>c.tabs.map(tab=>tab.doc.assets));
 Object.assign(c,{$:()=>title,dirty:false,documentSignature:'',NoteMindImagePreviews:images,rememberTabs(){},drawTabs(){},noteLabel:value=>value,CustomEvent:class{constructor(type,settings){this.type=type;Object.assign(this,settings);}}});
 c.window.notemind={dirty(){}};c.window.dispatchEvent=event=>f.windowListeners[event.type]?.(event);c.window.NoteMindNotes={changed(tab){f.api.record(tab);}};
 vm.runInNewContext(renderer.match(/^function markDirty\(.*$/m)[0]+'\n'+renderer.match(/^function updateTitle\(.*$/m)[0],c);
 const input=({composition=false,trusted=true,before=true}={})=>{if(composition)f.listeners.compositionstart();else f.listeners.keydown({target:c.source,key:'x',isTrusted:trusted});const event={target:c.source,inputType:composition?'insertCompositionText':'insertText',data:composition?'あ':'x',isTrusted:trusted};if(before)f.listeners.beforeinput(event);f.listeners.input({...event,currentTarget:c.source,eventPhase:2});c.source.value=c.doc.text+='x';c.markDirty();if(composition)f.listeners.compositionend();};
 return{...f,client,images,input,values,get scans(){return scans;},get retains(){return retains;}};
}
test('actual markDirty/title retention reuses unchanged assets only for authenticated text and IME inputs',async()=>{
 const f=fixture();f.c.updateTitle();await tick();const scans=f.scans,retains=f.retains,history=f.api.stats().assetScans;
 for(let i=0;i<200;i++)f.input();f.input({composition:true});await tick();
 assert.equal(f.scans,scans);assert.equal(f.retains,retains);assert.equal(f.api.stats().assetScans,history);assert.equal(f.a.textHistory.last.assets['assets/0.png'],f.values['assets/0.png']);
 const previous=f.scans;f.values['assets/new.png']=makeRef();f.input({trusted:false});assert.ok(f.scans>previous);assert.equal(f.a.textHistory.last.assets['assets/new.png'],f.values['assets/new.png']);
 f.values['assets/programmatic.png']=makeRef();f.input({before:false});assert.equal(f.a.textHistory.last.assets['assets/programmatic.png'],f.values['assets/programmatic.png']);
});
test('default retention observes in-place replace/delete, Undo, tab removal and new asset dictionary identity',async()=>{
 const f=fixture();f.c.updateTitle();await tick();const original=f.values['assets/0.png'],replacement=makeRef();f.values['assets/0.png']=replacement;f.c.markDirty();assert.equal(f.a.textHistory.last.assets['assets/0.png'],replacement);
 f.api.step();assert.equal(f.c.doc.assets['assets/0.png'],original);f.api.step(true);assert.equal(f.c.doc.assets['assets/0.png'],replacement);
 delete f.c.doc.assets['assets/0.png'];f.c.markDirty();assert.equal(f.a.textHistory.last.assets['assets/0.png'],undefined);assert.ok(f.client.stats().entries>=500,'history keeps replaced and removed capabilities');
 f.c.tabs=[];f.api.prune();f.client.retainMany([]);f.images.retainMany([]);await tick();assert.equal(f.client.stats().entries,0);
});
test('unchanged current dictionaries cannot hide a new history union or pending captured source',async()=>{
 const calls=[],client=sync.create({uuid:randomUUID,invoke:async()=>{},retain:async tokens=>calls.push(tokens.slice())}),one=makeRef(),two=makeRef(),assets={'assets/current.png':one};let history=Object.freeze([]);client.setCurrentAssetProvider(()=>[assets]);client.setHistoryAssetProvider(()=>history);await client.retainMany([assets]);
 const captured=client.capture({text:'',assets:{'assets/pending.png':two}});await tick();assert.ok(calls.at(-1).includes(two.id));
 client.retainMany([assets],{unchanged:true});await tick();assert.ok(calls.at(-1).includes(two.id));await client.releaseDocument(captured);await tick();assert.ok(!calls.at(-1).includes(two.id));
 history=Object.freeze([Object.freeze({'assets/history.png':two})]);await client.retainMany([assets],{unchanged:true});assert.ok(calls.at(-1).includes(two.id));
 history=Object.freeze([]);await client.retainMany([assets],{unchanged:true});assert.ok(!calls.at(-1).includes(two.id));assert.ok(calls.at(-1).includes(one.id));
});
test('unchanged hint falls back when an ordered current dictionary identity changes',async()=>{
 const one={'assets/one.png':makeRef()},two={'assets/two.png':makeRef()},client=sync.create({uuid:randomUUID,invoke:async()=>{}}),images=previews.create({lazy:true,isRef:client.isRef,identity:client.assetIdentity,info:client.info});
 images.url('assets/one.png',one['assets/one.png'],'image/png');await client.retainMany([one]);images.retainMany([one]);assert.equal(images.stats().entries,1);await client.retainMany([two],{unchanged:true});images.retainMany([two],{unchanged:true});assert.equal(client.stats().entries,1);assert.equal(client.stats().bytes,512);assert.equal(images.stats().entries,0);
});
