const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),domino=require('@mixmark-io/domino'),renderer=require('../src/document-renderer.cjs');
const noop=()=>{},read=()=>fs.readFileSync(require.resolve('../src/renderer.js'),'utf8');
function fixture(code=read()){
 const document=domino.createDocument('<div id="toolbar"><button></button></div><button id="visual"></button><button id="markdown"></button><span id="modeLabel"></span><span id="status"></span><article id="rich"></article><textarea id="source" hidden></textarea>'),events=[];
 Object.getPrototypeOf(document.querySelectorAll('button')).forEach=Array.prototype.forEach;
 const rich=document.getElementById('rich'),source=document.getElementById('source');rich.focus=source.focus=()=>{};source.setSelectionRange=(start,end,direction='none')=>{source.selectionStart=start;source.selectionEnd=end;source.selectionDirection=direction};source.setRangeText=(value,start,end,mode)=>{source.value=source.value.slice(0,start)+value+source.value.slice(end);source.setSelectionRange(start+value.length,start+value.length)};
 const c={document,rich,source,sourceCarets:new WeakMap(),activeTab:null,doc:{text:'',assets:{},meta:{}},dirty:false,visual:true,richChanged:false,tabs:[],NoteMindDocument:renderer,NoteMindImagePreviews:{retainMany:noop,url:()=>'',size:()=>null},$:id=>document.getElementById(id),updateTitle:noop,window:{NoteMindNotes:{changedView:()=>events.push('view')}},markDirty:()=>events.push('dirty')};
 const lines=code.split('\n'),one=name=>lines.find(line=>line.startsWith('function '+name+'('));
 const helpers=code.match(/^function refreshEditor[\s\S]*?^}/m)?.[0]||'';
 vm.runInNewContext(['rememberCurrent','activateTab','render','visualAccess','currentText','rememberSourceCaret','switchMode'].map(one).filter(Boolean).join('\n')+'\n'+helpers+'\n'+code.slice(code.indexOf('function insertText('),code.indexOf('\n\nasync function readImage(')),c);
 let renders=0;const render=c.render;c.render=text=>{renders++;return render(text)};
 const tab=(text,visual=true)=>{const tab={doc:{text,assets:{},meta:{}},visual,dirty:false};c.tabs.push(tab);return tab};
 return {c,rich,source,tab,events,get renders(){return renders}};
}
test('source activation never renders hidden rich content; visual activation never fills hidden native source',()=>{
 const f=fixture(),text='**hello**\n\nworld\n'.repeat(2000),a=f.tab(text,false);f.c.activateTab(a);assert.equal(f.renders,0);assert.equal(f.rich.innerHTML,'');assert.equal(f.source.value,text);assert.equal(f.c.currentText(),text);assert.equal(f.source.hidden,false);assert.equal(f.rich.hidden,true);
 const b=f.tab('# Other\n\n**bold**',true);f.c.activateTab(b);assert.equal(f.renders,1);assert.equal(f.source.value,'');assert.equal(f.rich.innerHTML,renderer.render(b.doc.text,{}));assert.equal(f.c.currentText(),b.doc.text);assert.equal(a.doc.text,text);assert.deepEqual(f.events,['view','view']);
});
test('mode retirement commits edited text first and restores exact unchanged source selection',()=>{
 const f=fixture(),a=f.tab('one\n\ntwo',false);f.c.activateTab(a);f.source.setSelectionRange(2,6,'backward');f.c.switchMode(true);assert.equal(f.source.value,'');assert.equal(f.c.currentText(),'one\n\ntwo');f.c.switchMode(false);assert.equal(f.source.value,'one\n\ntwo');assert.equal(f.source.selectionStart,2);assert.equal(f.source.selectionEnd,6);assert.equal(f.source.selectionDirection,'backward');assert.equal(f.rich.innerHTML,'');
 f.source.value='one **changed**';f.source.setSelectionRange(3,3);f.c.switchMode(true);assert.equal(a.doc.text,'one **changed**');f.rich.innerHTML='<p>visual <em>change</em></p>';f.c.richChanged=true;const expected=renderer.toMarkdown(f.rich.innerHTML);f.c.switchMode(false);assert.equal(a.doc.text,expected);assert.equal(f.source.value,expected);assert.equal(f.rich.innerHTML,'');
});
test('programmatic source insertion, tab return and canonical visual text survive retirement',()=>{
 const f=fixture(),a=f.tab('abc',false),b=f.tab('other',true);f.c.activateTab(a);f.source.setSelectionRange(1,2);f.c.insertText('XYZ');assert.equal(f.source.value,'aXYZc');assert.equal(f.c.currentText(),'aXYZc');f.c.activateTab(b);assert.equal(a.doc.text,'aXYZc');assert.equal(f.source.value,'');f.c.activateTab(a);assert.equal(f.source.value,'aXYZc');assert.equal(f.rich.innerHTML,'');
 f.c.switchMode(true);f.rich.innerHTML='<p><strong>editable</strong></p>';f.c.richChanged=true;const exact=renderer.toMarkdown(f.rich.innerHTML);f.c.activateTab(b);assert.equal(a.doc.text,exact);f.c.activateTab(a);assert.equal(f.c.currentText(),exact);assert.equal(f.source.value,'');
});
test('unchanged autosave publication preserves the live control, native selection and visual node identity',()=>{
 const f=fixture(),a=f.tab('active text',false);f.c.activateTab(a);f.source.setSelectionRange(1,5,'forward');f.c.refreshEditor({contentChanged:false});assert.equal(f.source.selectionStart,1);assert.equal(f.source.selectionEnd,5);assert.equal(f.source.value,'active text');assert.equal(f.renders,0);
 f.c.switchMode(true);const node=f.rich.firstChild;f.c.refreshEditor({contentChanged:false});assert.equal(f.rich.firstChild,node);assert.equal(f.source.value,'');assert.equal(f.c.currentText(),'active text');
});
test('history restore keeps source mode free of hidden rendered copies and remains reversible',()=>{
 const file=require.resolve('./notes-history-budget.test.cjs'),prefix=fs.readFileSync(file,'utf8').split("\ntest('typing undo")[0],make=new Function('require',prefix+'\nreturn fixture;')(require('node:module').createRequire(file)),f=make({text:'original'});f.edit('edited');f.api.step();assert.equal(f.c.source.value,'original');assert.equal(f.c.rich.innerHTML,'');f.api.step(true);assert.equal(f.c.source.value,'edited');assert.equal(f.c.rich.innerHTML,'');
});
module.exports={fixture};
