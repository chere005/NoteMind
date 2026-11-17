const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const renderer=require('../src/document-renderer.cjs'),rewrite=require('../src/markdown-reference-rewrite.js');
function replace(text,{from='assets/a.png',to='assets/edited.png',data='OLD',expectedData='OLD',nextData='NEW'}={}){
 const tab={id:1,doc:{text,assets:{[from]:data,'assets/a.png-copy.png':'OTHER'},meta:{graphicsPanes:{[from]:{version:1}}}}},target={tabId:1,assetName:from,expectedData};let listener,alerted=false;
 const c={tabs:[tab],activeTab:tab,doc:tab.doc,rememberCurrent(){},updateTitle(){},source:{},rich:{},render:()=>'',NoteMindDocument:renderer,NoteMindReferenceRewrite:rewrite,alert:()=>alerted=true,window:{addEventListener:(name,fn)=>{listener=fn},NoteMindNotes:{changed(){}}}};
 const handler=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8').split('\n').find(line=>line.startsWith("window.addEventListener('tablet-replace',"));vm.runInNewContext(handler,c);
 const event={detail:{target,name:to,data:nextData},preventDefault(){this.defaultPrevented=true}};listener(event);return {tab,event,target,alerted};
}
test('editing a graphic rewrites exact Markdown destinations and preserves prose and code',()=>{
 const text='![A](assets/a.png)\n\nassets/a.png\n\n`assets/a.png`\n\n```md\n![Example](assets/a.png)\n```\n\n![B](assets/a.png-copy.png)',h=replace(text);
 assert.equal(h.event.defaultPrevented,undefined);assert.equal(h.tab.doc.text,text.replace('![A](assets/a.png)','![A](assets/edited.png)'));assert.equal(h.tab.doc.assets['assets/a.png-copy.png'],'OTHER');assert.equal(h.tab.doc.assets['assets/edited.png'],'NEW');assert.equal(h.target.assetName,'assets/edited.png');
});
test('editing a graphic accepts escaped URLs, references, and titled links',()=>{
 for(const [text,expected]of [['![A](assets/a\\.png)','![A](assets/edited.png)'],['![A][drawing]\n\n[drawing]: assets/a.png "Title"','![A][drawing]\n\n[drawing]: assets/edited.png "Title"'],['![A](assets/a.png\n "Title")','![A](assets/edited.png\n "Title")']]){const h=replace(text);assert.equal(h.event.defaultPrevented,undefined);assert.equal(h.tab.doc.text,expected);}
});
test('graphic replacement rejects stale data and names mentioned only as text',()=>{
 for(const [text,options]of [['![A](assets/a.png)',{expectedData:'STALE'}],['assets/a.png\n\n`![A](assets/a.png)`',{}],['![B](assets/a.png-copy.png)',{}]]){const h=replace(text,options);assert.equal(h.event.defaultPrevented,true);assert.equal(h.alerted,true);assert.equal(h.tab.doc.text,text);assert.equal(h.tab.doc.assets['assets/edited.png'],undefined);}
});
