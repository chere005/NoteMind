const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const noop=()=>{};
function editing(text){
 const listeners={},element=()=>({dataset:{},addEventListener:noop,querySelector:()=>({}),insertBefore:noop}),source={value:text,selectionStart:0,selectionEnd:0,addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b},setRangeText(text,a,b){this.value=this.value.slice(0,a)+text+this.value.slice(b);this.selectionStart=this.selectionEnd=a+text.length}};
 const c={source,visual:false,markDirty:noop,rich:{parentElement:element(),addEventListener:noop},window:{NoteMindNotes:{},addEventListener:noop},document:{createElement:element},$:element,MutationObserver:class{observe(){}}};
 for(const file of ['notes-writing.js','notes-structure.js'])vm.runInNewContext(fs.readFileSync('src/'+file,'utf8'),c);
 return {c,source,key(key){const e={key,shiftKey:false,preventDefault(){this.defaultPrevented=true}};for(const fn of listeners.keydown)fn(e);return !!e.defaultPrevented}};
}
test('moving Markdown sections preserves every content line and the final newline',()=>{
 for(const end of ['','\n']){const h=editing('# One\nA\n# Two\nB'+end);h.c.window.NoteMindStructure.moveSection(1);assert.equal(h.source.value,'# Two\nB\n# One\nA'+end);h.source.setSelectionRange(h.source.value.indexOf('# One'),h.source.value.indexOf('# One'));h.c.window.NoteMindStructure.moveSection(-1);assert.equal(h.source.value,'# One\nA\n# Two\nB'+end);}
 for(const text of ['# A\n\ntext a\n\n## A1\n\nsub\n\n# B\n\ntext b','# A\nA\n \n\n# B\nB\n\n# C\nC\n']){const h=editing(text);h.c.window.NoteMindStructure.moveSection(1);const at=h.source.value.indexOf('# A');h.source.setSelectionRange(at,at);h.c.window.NoteMindStructure.moveSection(-1);assert.equal(h.source.value,text);}
});
test('list and quote continuation respect matching fence types and lengths',()=>{
 for(const [fence,line]of [['```','- example'],['~~~','> quote'],['````','```\n- nested example']]){const h=editing(fence+'text\n'+line);h.source.setSelectionRange(h.source.value.length,h.source.value.length);assert.equal(h.key('Enter'),false);assert.equal(h.source.value,fence+'text\n'+line);}
 for(const text of ['- example','> quote']){const h=editing(text);h.source.setSelectionRange(text.length,text.length);assert.equal(h.key('Enter'),true);assert.ok(h.source.value.endsWith(text[0]==='-'?'\n- ':'\n> '));}
 const h=editing('# A\n````\n```\n# hidden\n````\n# B\nEnd');h.c.window.NoteMindStructure.moveSection(1);assert.equal(h.source.value,'# B\nEnd\n# A\n````\n```\n# hidden\n````');
});
function finding(text,query,replacement){
 const buttons={},input={value:query,focus:noop,select:noop},replace={value:replacement},count={},row={},bar={style:{},setAttribute:noop,querySelectorAll:()=>[input,replace],querySelector:key=>key==='[role=status]'?count:key==='.find-replace'?row:(buttons[key]??={setAttribute:noop})};
 const source={value:text,addEventListener:noop,focus:noop,parentElement:{clientHeight:100},setSelectionRange:noop,setRangeText(text,a,b){this.value=this.value.slice(0,a)+text+this.value.slice(b)}};
 const c={doc:{meta:{}},source,visual:false,markDirty:noop,localStorage:{getItem:()=>null,setItem:noop},CSS:{highlights:new Map()},NoteMindHistory:{transaction:fn=>fn()},rich:{addEventListener:noop},document:{createElement:()=>bar,addEventListener:noop},window:{addEventListener:noop},$:()=>({offsetTop:0,offsetHeight:20,after:noop})};vm.runInNewContext(fs.readFileSync('src/notes-find.js','utf8'),c);c.window.NoteMindFind.open({replace:true});return {c,source,buttons};
}
test('Unicode case folding keeps Find and Replace offsets in the original text',()=>{
 const h=finding('İx İx','x','Y');assert.equal(h.c.window.NoteMindFind.matches,2);h.c.window.NoteMindFind.replaceAll();assert.equal(h.source.value,'İY İY');
 const i=finding('İstanbul','i','I');i.c.window.NoteMindFind.replaceAll();assert.equal(i.source.value,'Istanbul');
 const astral=finding('𐐀x x','x','Y');astral.buttons['[data-word]'].onclick();assert.equal(astral.c.window.NoteMindFind.matches,1);astral.c.window.NoteMindFind.replaceAll();assert.equal(astral.source.value,'𐐀x Y');
});
test('attachment metadata cannot inject markup through page-count labels',()=>{
 const renderer=require('../src/document-renderer.cjs'),format=require('../src/notepad-format.cjs'),pages='</span><h1 id="injected">Heading</h1><span>',doc=format.decode(format.encode({text:'[Document](assets/a.pdf)',assets:{'assets/a.pdf':'AAAA'},meta:{attachments:{'assets/a.pdf':{pages}}}}));
 const html=renderer.render(doc.text,doc.assets,doc.meta);assert.doesNotMatch(html,/<h1|id="injected"/);assert.match(html,/&lt;h1 id=&quot;injected&quot;&gt;/);
});
