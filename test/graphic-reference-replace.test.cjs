const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const renderer=require('../src/document-renderer.cjs'),rewrite=require('../src/markdown-reference-rewrite.js');
function replace(text,{from='assets/a.png',to='assets/edited.png',data='OLD',expectedData='OLD',nextData='NEW',sidecar,expectedIdentity,sync}={}){
 const tab={id:1,doc:{text,assets:{[from]:data,'assets/a.png-copy.png':'OTHER'},meta:{graphicsPanes:{[from]:{version:1}}}}},target={tabId:1,assetName:from,...(expectedIdentity===undefined?{expectedData}:{expectedIdentity})};let listener,alerted=false;
 const c={tabs:[tab],activeTab:tab,doc:tab.doc,rememberCurrent(){},updateTitle(){},source:{hidden:true,value:'',get textLength(){return this.value.length}},rich:{hidden:false,innerHTML:'',get firstChild(){return this.innerHTML?{}:null}},visual:true,sourceCarets:new WeakMap(),render:text=>renderer.render(text,tab.doc.assets,tab.doc.meta),NoteMindDocument:renderer,NoteMindReferenceRewrite:rewrite,alert:()=>alerted=true,window:{addEventListener:(name,fn)=>{listener=fn},NoteMindDocumentSync:sync,NoteMindNotes:{changed(){}}}};
 const source=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8'),handler=source.split('\n').find(line=>line.startsWith("window.addEventListener('tablet-replace',")),caret=source.match(/^function sourceCaret[^\n]+/m),refresh=source.match(/^function refreshEditor[\s\S]*?^}/m);assert.ok(caret&&refresh);vm.runInNewContext(caret[0]+'\n'+refresh[0]+'\n'+handler,c);
 const event={detail:{target,name:to,data:nextData,sidecar},preventDefault(){this.defaultPrevented=true}};listener(event);return {tab,event,target,alerted,again:(name,data)=>{const next={detail:{target,name,data},preventDefault(){this.defaultPrevented=true}};listener(next);return next;}};
}
test('editing a graphic rewrites exact Markdown destinations and preserves prose and code',()=>{
 const text='![A](assets/a.png)\n\nassets/a.png\n\n`assets/a.png`\n\n```md\n![Example](assets/a.png)\n```\n\n![B](assets/a.png-copy.png)',h=replace(text);
 assert.equal(h.event.defaultPrevented,undefined);assert.equal(h.tab.doc.text,text.replace('![A](assets/a.png)','![A](assets/edited.png)'));assert.equal(h.tab.doc.assets['assets/a.png-copy.png'],'OTHER');assert.equal(h.tab.doc.assets['assets/edited.png'],'NEW');assert.equal(h.target.assetName,'assets/edited.png');
});
test('dense replacement stores the exact worker sidecar without encoding a geometry graph again',()=>{
 const h=replace('![A](assets/a.png)',{sidecar:'WORKER-ENCODED'});assert.equal(h.event.defaultPrevented,undefined);assert.equal(h.tab.doc.assets['assets/edited.png.json'],'WORKER-ENCODED');
});
test('editing a graphic accepts escaped URLs, references, and titled links',()=>{
 for(const [text,expected]of [['![A](assets/a\\.png)','![A](assets/edited.png)'],['![A][drawing]\n\n[drawing]: assets/a.png "Title"','![A][drawing]\n\n[drawing]: assets/edited.png "Title"'],['![A](assets/a.png\n "Title")','![A](assets/edited.png\n "Title")']]){const h=replace(text);assert.equal(h.event.defaultPrevented,undefined);assert.equal(h.tab.doc.text,expected);}
});
test('graphic replacement rejects stale data and names mentioned only as text',()=>{
 for(const [text,options]of [['![A](assets/a.png)',{expectedData:'STALE'}],['assets/a.png\n\n`![A](assets/a.png)`',{}],['![B](assets/a.png-copy.png)',{}]]){const h=replace(text,options);assert.equal(h.event.defaultPrevented,true);assert.equal(h.alerted,true);assert.equal(h.tab.doc.text,text);assert.equal(h.tab.doc.assets['assets/edited.png'],undefined);}
});

test('compact replacement identities advance after each save and reject stale source keys',()=>{const original={},next={},last={},keys=new Map([['OLD',original],['NEW',next],['LAST',last]]),sync={copyAssets:assets=>({...assets}),copyHints(){},assetIdentity:(assets,name)=>keys.get(assets[name])};const h=replace('![A](assets/a.png)',{expectedIdentity:original,sync});assert.equal(h.event.defaultPrevented,undefined);assert.equal(h.target.expectedIdentity,next);assert.equal(Object.hasOwn(h.target,'expectedData'),false);assert.equal(h.again('assets/last.png','LAST').defaultPrevented,undefined);assert.equal(h.target.expectedIdentity,last);assert.match(h.tab.doc.text,/assets\/last.png/);const stale=replace('![A](assets/a.png)',{expectedIdentity:{},sync});assert.equal(stale.event.defaultPrevented,true);assert.equal(stale.tab.doc.assets['assets/edited.png'],undefined);});
