const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),domino=require('@mixmark-io/domino');
const noop=()=>{};
function find(html,query,{wholeWord=false,instrument=false,action=null}={}){
 const document=domino.createDocument('<div id="toolbar"></div><article id="rich">'+html+'</article><textarea id="source"></textarea>');
 Object.getPrototypeOf(document.querySelectorAll('input'))[Symbol.iterator]=Array.prototype[Symbol.iterator];
 class TextRange{setStart(node,offset){this.startContainer=node;this.startOffset=offset}setEnd(node,offset){this.endContainer=node;this.endOffset=offset}}
 let rangeCreates=0;document.createRange=()=>{rangeCreates++;return new TextRange()};document.getElementById('rich').constructor.prototype.scrollIntoView=()=>{};const c={document,visual:true,doc:{meta:{}},rich:document.getElementById('rich'),source:document.getElementById('source'),endReads:0,localStorage:{getItem:()=>JSON.stringify({wholeWord})},CSS:{highlights:new Map()},Highlight:class{constructor(...ranges){this.ranges=new Set(ranges)}add(range){this.ranges.add(range);return this}},NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2},window:{addEventListener:noop},getSelection:()=>({toString:()=>query}),$:id=>document.getElementById(id)};
 let code=fs.readFileSync(path.join(__dirname,'../src/notes-find.js'),'utf8');if(instrument)code=code.replace('nodes.push({node,start:text.length,end:text.length+node.length})','const nodeEnd=text.length+node.length;nodes.push({node,start:text.length,get end(){endReads++;return nodeEnd}})');vm.runInNewContext(code,c);const input=document.querySelector('.note-find input');input.value=action?'':query;input.select=noop;c.window.NoteMindFind.open();if(action){input.value=query;if(action==='input')input.oninput();else if(action==='selection')c.window.NoteMindFind.useSelection();else document.querySelector('[data-'+action+']').onclick();}return instrument?{matches:c.window.NoteMindFind.matches,endReads:c.endReads,highlighted:c.CSS.highlights.get('note-find')?.ranges.size||0,rangeCreates}:c.window.NoteMindFind.matches;
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

test('visual Find advances through nodes once rather than rescanning them for every match',()=>{for(const count of[500,1000,2000]){const result=find('<p>needle</p>'.repeat(count),'needle',{instrument:true});assert.equal(result.matches,count);assert.ok(result.endReads<8*count,JSON.stringify(result));}});

test('visual Find publishes every150000 range without spreading them into one native constructor call',()=>{const result=find('<p>'+'a'.repeat(150000)+'</p>','a',{instrument:true});assert.equal(result.matches,150000);assert.equal(result.highlighted,150000);});

test('query input, option toggles and selected-text search build each resulting range only once',()=>{for(const action of['input','case','word','selection']){const result=find('<p>needle needle needle</p>','needle',{instrument:true,action});assert.equal(result.matches,3,action);assert.equal(result.highlighted,3,action);assert.equal(result.rangeCreates,3,action);}});
