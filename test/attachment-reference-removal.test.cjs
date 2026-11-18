const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),domino=require('@mixmark-io/domino');
const renderer=require('../src/document-renderer.cjs'),rewrite=require('../src/markdown-reference-rewrite.js'),noop=()=>{},name='assets/a.pdf';
test('attachment removal accepts titled, escaped, multiline, image, and reference usages',()=>{
 for(const text of ['[Report](assets/a.pdf "Title")','[Report](<assets/a.pdf>\n "Title")','[Report](assets/a\\.pdf)','![Report](assets/a.pdf)','[Report][r]\n\n[r]: assets/a.pdf "Title"','[r][] [r]\n\n[r]: assets/a.pdf\n "Title"']){const removed=rewrite.remove(renderer.md,text,name);assert.equal(removed.trim(),'',text);}
});
test('removal preserves literal prose, code, escaped syntax, and longer destinations',()=>{
 const literals='assets/a.pdf\n\n`[Code](assets/a.pdf)`\n\n```md\n[Code](assets/a.pdf)\n[r]: assets/a.pdf\n```\n\n\\[Literal](assets/a.pdf)\n\n[Other](assets/a.pdf-copy)',text='[Report](assets/a.pdf "Title")\n\n'+literals;
 assert.equal(rewrite.remove(renderer.md,text,name),'\n\n'+literals);
});
test('removal maps lists, quotes, tables, CRLF, and overlapping image links safely',()=>{
 for(const text of ['> [Report](assets/a.pdf\n> "Title")\n> Keep','- [Report](assets/a.pdf)\n- Keep','| [Report](assets/a.pdf "Title") | Keep |\n| --- | --- |','[Report][r]\r\n\r\n[r]: assets/a.pdf "Title"\r\n\r\nKeep','[![Report](assets/a.pdf)](assets/a.pdf) Keep']){const removed=rewrite.remove(renderer.md,text,name);assert.match(removed,/Keep/);assert.doesNotMatch(removed,/assets\/a\.pdf|Report|\[r\]/);}
});
test('tab-indented list continuations retain correct rewrite and removal offsets',()=>{
 for(const text of ['- Intro\n\t![B](assets/a.pdf)','- ![A](assets/a.pdf)\n\t![B](assets/a.pdf)','> - Intro\n> \t[Report](assets/a.pdf "Title")','- Intro\n\t![B](assets/a.pdf\n\t "Title")']){
  const rewritten=rewrite(renderer.md,text,{[name]:'assets/new.pdf'});assert.doesNotMatch(rewritten,/assets\/a\.pdf/,text);assert.match(rewritten,/assets\/new\.pdf/);
  const removed=rewrite.remove(renderer.md,text,name);assert.doesNotMatch(removed,/assets\/a\.pdf|!\[|\[Report\]/,text);if(text.includes('Intro'))assert.match(removed,/Intro/);
 }
});
function browser(text,confirm=true){
 const dom=domino.createWindow('<article id="rich"></article><textarea id="source"></textarea>'),document=dom.document;dom.Element.prototype.append=function(...nodes){for(const node of nodes)this.appendChild(typeof node==='string'?document.createTextNode(node):node)};
 const target={doc:{text,assets:{[name]:'AAAA'},meta:{attachments:{[name]:{title:'Report.pdf'}}}}};let dialog;
 const N={api:{},captureInsertion:()=>({tab:target}),dialog:(_title,body)=>{dialog=document.createElement('div');dialog.innerHTML=body;document.body.appendChild(dialog);return dialog}};
 const c={AbortController,doc:target.doc,activeTab:target,rich:document.getElementById('rich'),source:document.getElementById('source'),document,window:{NoteMindNotes:N,NoteMindWriting:{decorate:noop},addEventListener:noop},NoteMindDocument:renderer,NoteMindReferenceRewrite:rewrite,currentText:()=>target.doc.text,activateTab:noop,render:text=>renderer.render(text,target.doc.assets,target.doc.meta),markDirty:noop,action:fn=>fn(),confirm:()=>confirm};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/notes-attachments.js'),'utf8'),c);
 return {target,async remove(){await c.window.NoteMindAttachments.browser();Array.from(dialog.querySelectorAll('button')).find(button=>button.textContent==='Remove').click()}};
}
test('Attachments Remove deletes accepted references together with the attachment',async()=>{
 const h=browser('[Report](assets/a.pdf "Title")\n\nKeep `assets/a.pdf`');await h.remove();assert.equal(h.target.doc.text,'\n\nKeep `assets/a.pdf`');assert.deepEqual(Object.keys(h.target.doc.assets),[]);
 const cancelled=browser('[Report](assets/a.pdf "Title")',false);await cancelled.remove();assert.equal(cancelled.target.doc.text,'[Report](assets/a.pdf "Title")');assert.equal(cancelled.target.doc.assets[name],'AAAA');
});
