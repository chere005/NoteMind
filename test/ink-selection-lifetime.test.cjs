const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild');
const code=transformSync(fs.readFileSync(require.resolve('../src/tablet/renderer/useInkSelection.tsx'),'utf8'),{loader:'tsx',format:'cjs'}).code,tick=()=>new Promise(setImmediate);
function harness(){
 const slots=[],effects=[],edited=[],controllers=[];let cursor=0,dirty=false,view;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={
  useRef(value){const at=cursor++;return slots[at]??(slots[at]={current:value});},
  useState(value){const at=cursor++,slot=slots[at]??(slots[at]={value});return[slot.value,next=>{const value=typeof next==='function'?next(slot.value):next;if(!Object.is(value,slot.value)){slot.value=value;dirty=true;}}];},
  useMemo(make,deps){const at=cursor++;if(slots[at]&&same(slots[at].deps,deps))return slots[at].value;const value=make();slots[at]={deps,value};return value;},
  useLayoutEffect(make,deps){const at=cursor++,previous=slots[at];if(previous&&same(previous.deps,deps))return;const slot=slots[at]={deps,cleanup:previous?.cleanup};effects.push(()=>{slot.cleanup?.();slot.cleanup=make();});},
 };
 class Selection{
  constructor({onChange}){this.onChange=onChange;this.bits={count:0};this.editJob=null;controllers.push(this);}
  bind(owner){this.owner=owner;this.onChange(this);}
  ownerPage(){return this.owner;}
  select(){this.bits.count=1;this.onChange(this);}
  bounds(){return Promise.resolve({x:.1,y:.1,width:.2,height:.2});}
  style(){return Promise.resolve({colour:'#123456',width:3});}
  edit(){this.editJob={};return this.editJob.promise=new Promise(resolve=>this.finish=()=>{this.editJob=null;resolve(true);});}
  pending(){return this.editJob?.promise||Promise.resolve(false);}
  dispose(){this.disposed=true;}
 }
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:name=>name==='react'?hooks:name.includes('ink-selection-input')?require('../src/ink-selection-input.cjs'):{InkSelection:Selection},AbortController,queueMicrotask,Promise,WeakMap});
 const options={page:{id:'A'},focusRoot:()=>null,pixelSize:()=>({width:100,height:100}),widthScale:()=>1,onEdited:owner=>edited.push(owner),onError:error=>{throw error;},finish(){}};
 const render=()=>{for(let count=0;count<10;count++){dirty=false;cursor=0;view=module.exports.useInkSelection({...options});while(effects.length)effects.shift()();if(!dirty)return view;}throw Error('Hook render did not settle.');};
 return{options,edited,controllers,render,get view(){return view;},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
test('switching selection owners clears old busy state while accepted edits finish on their original page',async()=>{
 const h=harness(),first=h.options.page;h.render();const old=h.view.controller,accepted=h.view.run({type:'duplicate'});h.render();assert.equal(h.view.busy,true);
 h.options.page={id:'B'};h.render();const current=h.view.controller;assert.notEqual(current,old);current.select();await tick();h.render();assert.equal(h.view.count,1);assert.equal(h.view.busy,false);
 old.finish();await accepted;await tick();h.render();assert.equal(h.view.busy,false);assert.equal(h.edited[0],first);assert.equal(current.disposed,undefined);h.unmount();
});
test('an old owner edit completion cannot clear the new owner operation busy state',async()=>{
 const h=harness();h.render();const old=h.view.controller,first=h.view.run({type:'duplicate'});h.options.page={id:'B'};h.render();const current=h.view.controller,second=h.view.run({type:'delete'});h.render();assert.equal(h.view.busy,true);
 old.finish();await first;await tick();h.render();assert.equal(h.view.busy,true);current.finish();await second;await tick();h.render();assert.equal(h.view.busy,false);h.unmount();
});
test('switching pages removes an unfinished old owner marquee',()=>{
 const h=harness();h.render();h.view.begin({pointerId:7},{point:{x:0,y:0},px:{x:0,y:0}},{});h.view.move({pointerId:7},{point:{x:.5,y:.5},px:{x:50,y:50}});h.render();assert.equal(h.view.marquee.width,.5);
 h.options.page={id:'B'};h.render();assert.equal(h.view.marquee,null);assert.equal(h.view.pendingGesture(),false);h.unmount();
});
