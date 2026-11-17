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
