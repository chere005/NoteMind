const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),domino=require('@mixmark-io/domino');
const noop=()=>{};
function find(html,query,{wholeWord=false}={}){
 const document=domino.createDocument('<div id="toolbar"></div><article id="rich">'+html+'</article><textarea id="source"></textarea>');
 Object.getPrototypeOf(document.querySelectorAll('input'))[Symbol.iterator]=Array.prototype[Symbol.iterator];
 class TextRange{setStart(node,offset){this.startContainer=node;this.startOffset=offset}setEnd(node,offset){this.endContainer=node;this.endOffset=offset}}
 document.createRange=()=>new TextRange();const c={document,visual:true,doc:{meta:{}},rich:document.getElementById('rich'),source:document.getElementById('source'),localStorage:{getItem:()=>JSON.stringify({wholeWord})},CSS:{highlights:new Map()},Highlight:class{},NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2},window:{addEventListener:noop},$:id=>document.getElementById(id)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/notes-find.js'),'utf8'),c);const input=document.querySelector('.note-find input');input.value=query;input.select=noop;c.window.NoteMindFind.open();return c.window.NoteMindFind.matches;
}
test('visual whole-word Find treats paragraphs, line breaks, and table cells as boundaries',()=>{
 for(const html of ['<p>a</p><p>cat</p>','<h1>a</h1><p>cat</p>','<p>a<br>cat</p>','<ul><li>a</li><li>cat</li></ul>','<table><tr><td>a</td><td>cat</td></tr></table>'])assert.equal(find(html,'cat',{wholeWord:true}),1,html);
});
test('visual Find cannot bridge paragraphs, line breaks, or table cells',()=>{
 for(const html of ['<p>alpha</p><p>beta</p>','<p>alpha<br>beta</p>','<table><tr><td>alpha</td><td>beta</td></tr></table>'])assert.equal(find(html,'alphabeta'),0,html);
});
test('visual Find still spans inline formatting and skips editor controls',()=>{
 for(const html of ['<p>al<strong>pha</strong>beta</p>','<p><em>alpha</em><code>beta</code></p>','<p>alpha<span data-editor-control>ignored</span>beta</p>'])assert.equal(find(html,'alphabeta'),1,html);
});
