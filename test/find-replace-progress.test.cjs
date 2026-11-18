const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const noop=()=>{};
function fixture(text,query,replacement,visual){
 const buttons={},input={value:query,focus:noop,select:noop},replace={value:replacement},count={},bar={style:{},setAttribute:noop,querySelectorAll:()=>[input,replace],querySelector:key=>key==='[role=status]'?count:key==='.find-replace'?{}:(buttons[key]??={setAttribute:noop})};
 const node={data:text,parentElement:{closest:()=>null,scrollIntoView:noop},get textContent(){return this.data},get length(){return this.data.length}};
 class TextRange{
  setStart(node,offset){this.startContainer=node;this.startOffset=offset}
  setEnd(node,offset){this.endContainer=node;this.endOffset=offset}
  cloneRange(){const copy=new TextRange();Object.assign(copy,this);return copy}
  collapse(start){if(start)this.setEnd(this.startContainer,this.startOffset);else this.setStart(this.endContainer,this.endOffset)}
  compareBoundaryPoints(_,other){return this.startOffset-other.startOffset}
 }
 let selected;
 const selection={removeAllRanges:noop,addRange:range=>selected=range,getRangeAt:()=>selected};
 const source={value:text,addEventListener:noop,focus:noop,parentElement:{clientHeight:100},setSelectionRange:noop,setRangeText(value,a,b){this.value=this.value.slice(0,a)+value+this.value.slice(b)}};
 const document={createElement:()=>bar,addEventListener:noop,createRange:()=>new TextRange(),createTreeWalker:()=>{let visited=false;return {nextNode:()=>visited?null:(visited=true,node)}},execCommand:(_,__,value)=>{node.data=node.data.slice(0,selected.startOffset)+value+node.data.slice(selected.endOffset);selected.setEnd(node,selected.startOffset+value.length);selected.collapse(false)}};
 const c={source,visual,doc:{meta:{}},markDirty:noop,localStorage:{getItem:()=>null,setItem:noop},CSS:{highlights:new Map()},Highlight:class{},Range:{START_TO_START:0},NodeFilter:{SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2},NoteMindHistory:{transaction:fn=>fn()},rich:{addEventListener:noop,focus:noop},document,getSelection:()=>selection,window:{addEventListener:noop},$:()=>({offsetTop:0,offsetHeight:20,after:noop})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/notes-find.js'),'utf8'),c);c.window.NoteMindFind.open({replace:true});
 return {input,replace,bar,find:c.window.NoteMindFind,count,get text(){return visual?node.data:source.value}};
}
for(const visual of [false,true]){
 const mode=visual?'Visual':'Markdown';
 test(mode+' Replace advances past a replacement containing the query',()=>{
  const h=fixture('cat cat','cat','cats',visual);h.find.replaceCurrent();assert.equal(h.text,'cats cat');assert.equal(h.count.textContent,'2 of 2');h.find.replaceCurrent();assert.equal(h.text,'cats cats');assert.equal(h.count.textContent,'1 of 2');
 });
 test(mode+' Replace advances when the replacement equals the query',()=>{
  const h=fixture('cat cat','cat','cat',visual);h.find.replaceCurrent();assert.equal(h.count.textContent,'2 of 2');h.find.replaceCurrent();assert.equal(h.count.textContent,'1 of 2');assert.equal(h.text,'cat cat');
 });
 test(mode+' Replace deletion keeps the adjacent following match',()=>{
  const h=fixture('catcatcat','cat','',visual);h.find.replaceCurrent();h.find.replaceCurrent();assert.equal(h.text,'cat');assert.equal(h.count.textContent,'1 of 1');
 });
}

test('find and replace input keys never act during IME composition or after consumption',()=>{for(const visual of [false,true])for(const control of ['input','replace'])for(const key of ['Enter','Escape'])for(const patch of [{isComposing:true},{keyCode:229},{defaultPrevented:true}]){const h=fixture('cat cat','cat','変換',visual),event={key,preventDefault(){this.prevented=true},...patch};h[control].onkeydown(event);assert.equal(h.text,'cat cat');assert.equal(h.count.textContent,'1 of 2');assert.equal(h.bar.hidden,false);assert.equal(event.prevented,undefined)}});
test('ordinary field Enter and Escape keep find, replace and replace-all actions',()=>{for(const visual of [false,true]){const current=fixture('cat cat','cat','cats',visual);current.replace.onkeydown({key:'Enter',preventDefault(){}});assert.equal(current.text,'cats cat');const all=fixture('cat cat','cat','cats',visual);all.replace.onkeydown({key:'Enter',ctrlKey:true,preventDefault(){}});assert.equal(all.text,'cats cats');const query=fixture('cat cat','cat','cats',visual);query.input.onkeydown({key:'Enter',preventDefault(){}});assert.equal(query.count.textContent,'2 of 2');query.input.onkeydown({key:'Escape',preventDefault(){}});assert.equal(query.bar.hidden,true)}});
