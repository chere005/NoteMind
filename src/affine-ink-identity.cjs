// A proven unique range needs arithmetic, not a second per-row identity table.
const {PersistentInkIdentity}=require('./ink-identity.cjs'),{yieldTask}=require('./graphics-pane.js');
const MAX_COUNT=2000000,RADIX=MAX_COUNT+1,MAX_LOCATOR=513*RADIX,PAGE_SHIFT=12,PAGE_SIZE=1<<PAGE_SHIFT,MAX_SPARSE=16384;
const validId=id=>Number.isSafeInteger(id)&&id>0,clock=()=>globalThis.performance?.now()??Date.now();
function packed(locator,count){if(!Number.isSafeInteger(locator)||locator<0||locator>MAX_LOCATOR||!Number.isSafeInteger(count)||count<1||count>MAX_COUNT)throw Error('Invalid ink identity entry.');const value=locator*RADIX+count;if(!Number.isSafeInteger(value))throw Error('Ink identity exceeds exact numeric range.');return value;}
const location=value=>Math.floor(value/RADIX),multiplicity=value=>value-location(value)*RADIX;
function baseIndex(state,id){if(!validId(id))return-1;const range=state.range,index=range.step?(id-range.start)/range.step:id===range.start?0:-1;return Number.isInteger(index)&&index>=0&&index<range.length&&range.start+range.step*index===id?index:-1;}
function deleted(state,index){const page=state.deleted.get(index>>>PAGE_SHIFT);return!!(page&&page.bits[(index&(PAGE_SIZE-1))>>>5]&(1<<(index&31)));}
function valueOf(state,id){const index=baseIndex(state,id);if(index<0)return state.extras.get(id)||0;if(deleted(state,index))return 0;return state.overrides.get(index)??packed(state.range.locatorStart+index,1);}
function locationOf(state,id){const index=baseIndex(state,id);if(index<0){const value=state.extras.get(id)||0;return value?location(value):-1;}if(deleted(state,index))return-1;const override=state.overrides.get(index);return override===undefined?state.range.locatorStart+index:location(override);}
function countOf(state,id){const index=baseIndex(state,id);if(index<0)return multiplicity(state.extras.get(id)||0);if(deleted(state,index))return 0;const override=state.overrides.get(index);return override===undefined?1:multiplicity(override);}
class Pacer{
 constructor({signal,yieldControl=yieldTask}={}){if(typeof yieldControl!=='function')throw Error('Invalid ink yield function.');this.signal=signal;this.yieldControl=yieldControl;this.work=0;this.time=clock();this.check();}
 check(){if(this.signal?.aborted)throw Object.assign(Error('Ink identities cancelled.'),{name:'AbortError'});}
 poll(){return++this.work>=4096||this.work%256===0&&clock()-this.time>=3;}
 async pause(){this.check();await this.yieldControl();this.check();this.work=0;this.time=clock();}
}
function setDeleted(state,index,next,owned){
 const key=index>>>PAGE_SHIFT,word=(index&(PAGE_SIZE-1))>>>5,mask=1<<(index&31),held=state.deleted.get(key),before=!!(held&&held.bits[word]&mask);
 if(before===next)return;
 let page=held;if(!page||!owned.has(key)){page={bits:page?page.bits.slice():new Uint32Array(PAGE_SIZE/32),count:page?.count||0};state.deleted.set(key,page);owned.add(key);}
 if(next){page.bits[word]|=mask;page.count++;state.deletedCount++;}else{page.bits[word]&=~mask;page.count--;state.deletedCount--;if(!page.count)state.deleted.delete(key);}
}
function* activeIndices(state){
 const length=state.range.length;
 for(let first=0;first<length;first+=PAGE_SIZE){const count=Math.min(PAGE_SIZE,length-first),page=state.deleted.get(first>>>PAGE_SHIFT);if(page?.count===count)continue;
  for(let local=0;local<count;local+=32){const width=Math.min(32,count-local),mask=width===32?0xffffffff:0xffffffff>>>(32-width);let bits=((page?~page.bits[local>>>5]:0xffffffff)&mask)>>>0;while(bits){const bit=31-Math.clz32(bits&-bits);yield first+local+bit;bits&=bits-1;}}
 }
}
function rowsOf(state,reuse=false){return{length:state.size,*[Symbol.iterator](){const row={id:0,locator:0,count:1};for(const index of activeIndices(state)){const value=state.overrides.get(index);row.id=state.range.start+state.range.step*index;row.locator=value===undefined?state.range.locatorStart+index:location(value);row.count=value===undefined?1:multiplicity(value);yield reuse?row:{...row};}for(const[id,value]of state.extras){row.id=id;row.locator=location(value);row.count=multiplicity(value);yield reuse?row:{...row};}}};}
class AffineInkIdentity{
 #state;
 constructor(state){this.#state=Object.freeze(state);Object.freeze(this);}
 get size(){return this.#state.size;}
 get totalCount(){return this.#state.totalCount;}
 get capacity(){return this.#state.range.length;}
 get stats(){const state=this.#state;return{kind:'affine',capacity:state.range.length,pages:state.deleted.size,copiedPages:state.copiedPages,typedBytes:[...state.deleted.values()].reduce((sum,page)=>sum+page.bits.byteLength,0),maxProbe:0,sparseEntries:state.overrides.size+state.extras.size,deleted:state.deletedCount};}
 value(id){return valueOf(this.#state,id);}
 locator(id){return locationOf(this.#state,id);}
 count(id){return countOf(this.#state,id);}
 *entries(){yield*rowsOf(this.#state);}
 async patch(changes,options={}){
  if(!changes||typeof changes[Symbol.iterator]!=='function')throw Error('Invalid ink identity patch.');const pacer=new Pacer(options),old=this.#state,next={...old,deleted:new Map(old.deleted),overrides:new Map(old.overrides),extras:new Map(old.extras),copiedPages:0},owned=new Set(),iterator=changes[Symbol.iterator]();let changed=false,finished=false;
  try{
   for(;;){const step=iterator.next();if(step.done){finished=true;break;}const entry=step.value;if(!entry||typeof entry!=='object')throw Error('Invalid ink identity patch.');const id=entry.id,count=entry.count;if(!validId(id)||!Number.isSafeInteger(count)||count<0||count>MAX_COUNT)throw Error('Invalid ink identity entry.');const value=count?packed(entry.locator,count):0,before=valueOf(next,id);if(before!==value){const previousCount=multiplicity(before);if(next.totalCount-previousCount+count>MAX_COUNT)throw Error('Too many ink identity occurrences.');const index=baseIndex(next,id);
     if(index>=0){setDeleted(next,index,!count,owned);if(!count||count===1&&entry.locator===next.range.locatorStart+index)next.overrides.delete(index);else next.overrides.set(index,value);}
     else if(count)next.extras.set(id,value);else next.extras.delete(id);
     next.size+=(count?1:0)-(before?1:0);next.totalCount+=count-previousCount;changed=true;
    }
    if(pacer.poll())await pacer.pause();
    if(next.overrides.size+next.extras.size>MAX_SPARSE){next.copiedPages=owned.size;const generic=await PersistentInkIdentity.build(rowsOf(next,true),options),tail={[Symbol.iterator](){return this;},next(){const step=iterator.next();if(step.done)finished=true;return step;},return(){finished=true;return iterator.return?.()??{done:true};}};return await generic.patch(tail,options);}
   }
   pacer.check();if(!changed)return this;next.copiedPages=owned.size;return new AffineInkIdentity(next);
  }finally{if(!finished)iterator.return?.();}
 }
}
function createAffineInkIdentity(range){
 if(!range||!validId(range.start)||!Number.isSafeInteger(range.step)||!Number.isSafeInteger(range.length)||range.length<1||range.length>MAX_COUNT||range.length>1&&!range.step||!Number.isSafeInteger(range.locatorStart)||range.locatorStart<0||range.locatorStart+range.length-1>MAX_LOCATOR)return null;
 const end=range.start+range.step*(range.length-1);if(!validId(end))return null;
 return new AffineInkIdentity({range:Object.freeze({...range}),deleted:new Map(),overrides:new Map(),extras:new Map(),deletedCount:0,size:range.length,totalCount:range.length,copiedPages:0});
}
module.exports={AffineInkIdentity,createAffineInkIdentity};
