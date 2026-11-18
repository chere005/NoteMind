const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/renderer.js'),'utf8'),code=source.slice(source.indexOf('let graphicsEditRun='),source.indexOf('function insertAsset('));
function fixture(){
 const a={id:1,doc:{assets:{'assets/a.svg':'PREVIEW-A','assets/a.svg.json':'SIDECAR-A','assets/b.svg':'PREVIEW-B','assets/b.svg.json':'SIDECAR-B'}}},b={id:2,doc:{assets:{}}},events=[],reads=[],pane={hidden:false};
 const c={tabs:[a,b],activeTab:a,doc:a.doc,AbortController,$:()=>pane,assetUrl:name=>'data:image/svg+xml;base64,'+c.doc.assets[name],NoteMindGraphics:{decodeBase64Async:(data,options)=>new Promise((resolve,reject)=>reads.push({data,options,resolve,reject}))},window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};vm.runInNewContext(code+';globalThis.start=editGraphics;',c);return {a,b,c,events,reads,start:name=>c.start({dataset:{asset:name}})};
}
test('asynchronous drawing decode keeps its initiating image and Notepad after a tab switch',async()=>{
 const h=fixture(),pending=h.start('assets/a.svg');h.c.activeTab=h.b;h.c.doc=h.b.doc;const sheet={strokes:[]};h.reads[0].resolve(sheet);assert.equal(await pending,true);
 assert.equal(h.events.length,1);assert.equal(h.events[0].detail.sheet,sheet);assert.equal(h.events[0].detail.url,'data:image/svg+xml;base64,PREVIEW-A');assert.equal(h.events[0].detail.target.tabId,h.a.id);assert.equal(h.events[0].detail.target.expectedData,'PREVIEW-A');
});
test('closing a Notepad while its drawing loads drops completion safely',async()=>{
 const h=fixture(),pending=h.start('assets/a.svg');h.c.tabs=[h.b];h.reads[0].resolve({strokes:[]});assert.equal(await pending,false);assert.equal(h.events.length,0);
});
test('a changed preview or sidecar cannot be replaced by an older asynchronous load',async()=>{
 for(const name of ['assets/a.svg','assets/a.svg.json']){const h=fixture(),pending=h.start('assets/a.svg');h.a.doc.assets[name]='NEW';h.reads[0].resolve({strokes:[]});await assert.rejects(pending,/original image changed/);assert.equal(h.events.length,0);}
});
test('a newer edit request cancels an older decode and owns the visible drawing',async()=>{
 const h=fixture(),first=h.start('assets/a.svg'),second=h.start('assets/b.svg');assert.equal(h.reads[0].options.signal.aborted,true);h.reads[1].resolve({name:'Second',strokes:[]});assert.equal(await second,true);h.reads[0].resolve({name:'Old',strokes:[]});assert.equal(await first,false);assert.equal(h.events.length,1);assert.equal(h.events[0].detail.target.assetName,'assets/b.svg');
});
test('reference drawing reads retain the captured sources and use exact encoded image bytes',async()=>{
 const h=fixture(),preview={},sidecar={},bytes=Uint8Array.from({length:49153},(_,i)=>i%251),held=[],released=[],reads=[];
 h.a.doc.assets['assets/a.svg']=preview;h.a.doc.assets['assets/a.svg.json']=sidecar;
 h.c.btoa=value=>Buffer.from(value,'binary').toString('base64');
 h.c.window.NoteMindDocumentSync={isRef:value=>value===preview||value===sidecar,copyAssets:value=>({...value}),capture:value=>{held.push(value);return value;},releaseDocument:value=>released.push(value),info:()=>({mime:'image/svg+xml'}),withAssetBytes:async(assets,name,options,consume)=>{assert.equal(assets,held[0].assets);reads.push(name);return consume(name.endsWith('.json')?new Uint8Array([1,2,3]):bytes);}};
 h.a.doc.assets['assets/a.svg.json']=null;const sheet=null;
 assert.equal(await h.start('assets/a.svg'),true);assert.deepEqual(reads,['assets/a.svg']);assert.equal(h.events[0].detail.url,'data:image/svg+xml;base64,'+Buffer.from(bytes).toString('base64'));assert.equal(h.events[0].detail.sheet,sheet);assert.deepEqual(released,held);
});
test('drawing capture is released on decode failure and cancellation',async()=>{
 for(const cancelled of [false,true]){const h=fixture(),released=[];h.c.window.NoteMindDocumentSync={copyAssets:value=>({...value}),capture:value=>value,releaseDocument:value=>released.push(value)};const pending=h.start('assets/a.svg');let second;if(cancelled)second=h.start('assets/b.svg');h.reads[0].reject(Error('bad sidecar'));if(cancelled)assert.equal(await pending,false);else await assert.rejects(pending,/bad sidecar/);assert.equal(released.length,1);if(second){h.reads[1].resolve({strokes:[]});await second;assert.equal(released.length,2);}}
});

test('editable Ref sidecars avoid materializing an unused preview and replacement identity holds no source value',async()=>{const h=fixture(),preview={},sidecar={},identity={},sheet={strokes:[]},reads=[];h.a.doc.assets['assets/a.svg']=preview;h.a.doc.assets['assets/a.svg.json']=sidecar;h.c.NoteMindGraphics.decodeAsync=async()=>sheet;h.c.window.NoteMindDocumentSync={isRef:value=>value===preview||value===sidecar,copyAssets:value=>({...value}),capture:value=>value,releaseDocument(){},assetIdentity:()=>identity,withAssetBytes:async(_assets,name,_options,run)=>{reads.push(name);return run(new Uint8Array([1]));}};assert.equal(await h.start('assets/a.svg'),true);assert.deepEqual(reads,['assets/a.svg.json']);assert.equal(h.events[0].detail.url,'');assert.equal(h.events[0].detail.sheet,sheet);assert.equal(h.events[0].detail.target.expectedIdentity,identity);assert.equal(Object.hasOwn(h.events[0].detail.target,'expectedData'),false);});


test('first edit of an unhinted local image captures its actual DocSync identity before copying source ownership',async()=>{
 const h=fixture(),{create}=require('../src/document-sync.js');let next=0;
 const sync=create({uuid:()=>String(++next),invoke:()=>assert.fail('edit must not dispatch a document operation')});h.c.window.NoteMindDocumentSync=sync;
 const pending=h.start('assets/a.svg'),originalKey=sync.assetIdentity(h.a.doc.assets,'assets/a.svg');
 h.reads[0].resolve({strokes:[]});assert.equal(await pending,true);
 const target=h.events[0].detail.target;assert.equal(target.expectedIdentity,originalKey);assert.equal(Object.hasOwn(target,'expectedData'),false);
 assert.equal(sync.assetIdentity(h.a.doc.assets,target.assetName),target.expectedIdentity,'unchanged first edit remains eligible for Save to Original');
 h.a.doc.text='![Image](assets/a.svg)';h.a.doc.meta={};let replace;
 Object.assign(h.c,{rememberCurrent(){},updateTitle(){},source:{},rich:{},render:()=>'',NoteMindDocument:require('../src/document-renderer.cjs'),NoteMindReferenceRewrite:require('../src/markdown-reference-rewrite.js'),alert:message=>assert.fail(message)});
 h.c.window.addEventListener=(_name,listener)=>replace=listener;
 vm.runInNewContext(source.split('\n').find(line=>line.startsWith("window.addEventListener('tablet-replace',")),h.c);
 const event={detail:{target,name:'assets/edited.png',data:'TkVX'},preventDefault(){this.defaultPrevented=true}};replace(event);
 assert.equal(event.defaultPrevented,undefined);assert.equal(h.a.doc.assets['assets/edited.png'],'TkVX');assert.equal(target.expectedIdentity,sync.assetIdentity(h.a.doc.assets,'assets/edited.png'));

});

test('actual DocSync autosave preserves the current local source identity during deferred sidecar decoding',async()=>{
 const h=fixture(),{create}=require('../src/document-sync.js'),{DocumentAssetSessions}=require('../src/document-asset-sessions.cjs'),{EventEmitter}=require('node:events');
 h.a.doc.assets={'assets/a.svg':Buffer.from('<svg/>').toString('base64'),'assets/a.svg.json':Buffer.from('sidecar'.repeat(256*1024)).toString('base64')};
 const sender=Object.assign(new EventEmitter(),{isDestroyed:()=>false}),server=new DocumentAssetSessions(),sync=create({uuid:require('node:crypto').randomUUID,invoke:packet=>server.run(sender,packet,async doc=>({...doc,meta:{saved:true}}))});
 h.c.window.NoteMindDocumentSync=sync;const pending=h.start('assets/a.svg'),key=sync.assetIdentity(h.a.doc.assets,'assets/a.svg'),before=h.a.doc.assets['assets/a.svg'];
 try{h.a.doc=await sync.call('autosave',{text:'![Image](assets/a.svg)',...h.a.doc});assert.equal(h.a.doc.assets['assets/a.svg'],before,'first autosave retains a known local string instead of adopting an unrelated Ref');assert.equal(sync.assetIdentity(h.a.doc.assets,'assets/a.svg'),key);h.reads[0].resolve({strokes:[]});assert.equal(await pending,true);assert.equal(h.events[0].detail.target.expectedIdentity,key);}finally{await server.dispose();}
});
