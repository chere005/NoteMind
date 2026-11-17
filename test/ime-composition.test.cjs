const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const noop=()=>{};
function fixture(text=''){
 const listeners={rich:[],source:[]},element=()=>({children:[],dataset:{},style:{},classList:{toggle:noop,remove:noop},addEventListener:noop,setAttribute:noop,querySelector:element,querySelectorAll:()=>[],insertBefore:noop,append(...children){this.children.push(...children)}});
 const rich={...element(),parentElement:element(),addEventListener:(name,fn)=>{if(name==='keydown')listeners.rich.push(fn)}},source={...element(),value:text,selectionStart:text.length,selectionEnd:text.length,addEventListener:(name,fn)=>{if(name==='keydown')listeners.source.push(fn)},setRangeText(value,a,b){this.value=this.value.slice(0,a)+value+this.value.slice(b);this.selectionStart=this.selectionEnd=a+value.length},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}};
 const c={source,rich,visual:false,markDirty:noop,requestAnimationFrame:noop,carets:new Map(),activeTab:{id:1},window:{NoteMindNotes:{},addEventListener:noop},document:{body:element(),createElement:element,querySelector:element,addEventListener:noop},$:element,MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}}};
 vm.createContext(c);
 return {c,source,listeners,element,load(file){vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+file),'utf8'),c)},key(target,key,isComposing=true){const event={key,isComposing,preventDefault(){this.defaultPrevented=true},stopImmediatePropagation:noop};for(const fn of listeners[target])fn(event);return event}};
}
test('composing Enter leaves Markdown lists and quotes to the input method',()=>{
 for(const text of ['- 日本','- [ ] 日本','1. 日本','> 日本']){const h=fixture(text);h.load('notes-writing.js');h.load('notes-structure.js');assert.equal(h.key('source','Enter').defaultPrevented,undefined);assert.equal(h.source.value,text);assert.equal(h.key('source','Enter',false).defaultPrevented,true);assert.ok(h.source.value.startsWith(text+'\n'));}
});
test('composing code punctuation and indentation do not alter Markdown',()=>{
 for(const [text,key]of [['```js\n日本','('],['```js\n日本','"'],['    ','Backspace'],['- 日本','Tab']]){const h=fixture(text);h.load('notes-writing.js');h.load('notes-structure.js');assert.equal(h.key('source',key).defaultPrevented,undefined);assert.equal(h.source.value,text);}
});
test('composing keys bypass visual list and code editing',()=>{
 const h=fixture();h.c.visual=true;h.c.getSelection=()=>{throw Error('Composition must not enter a custom selection edit')};h.load('notes-writing.js');h.load('notes-structure.js');for(const key of ['Enter','Tab','(','Backspace'])assert.equal(h.key('rich',key).defaultPrevented,undefined);
});
test('composing Enter in a table leaves the existing row intact',()=>{
 const h=fixture();h.c.visual=true;const row=h.element(),entry=h.element(),table={rows:[row]};row.children=[entry];entry.cellIndex=0;entry.closest=selector=>selector==='table'?table:entry;entry.parentElement=row;table.tBodies=[{append(next){table.rows.push(next)}}];
 h.c.rich.contains=()=>true;h.c.rich.focus=noop;const selection={anchorNode:{parentElement:entry},removeAllRanges:noop,addRange:noop};h.c.getSelection=()=>selection;h.c.document.createRange=()=>({selectNodeContents:noop,collapse:noop,cloneRange:()=>({})});h.load('notes-tables.js');
 assert.equal(h.key('rich','Enter').defaultPrevented,undefined);assert.equal(table.rows.length,1);assert.equal(h.key('rich','Enter',false).defaultPrevented,true);assert.equal(table.rows.length,2);
});
