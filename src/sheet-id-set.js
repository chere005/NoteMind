// Canonical persistence IDs may be dense or arbitrarily sparse safe integers.
// Keep a bounded number of bitmap pages; sparse overflow uses typed hash rows.
const {NumericInkSet}=require('./numeric-ink-set.js');
const EDGE=4096,PAGES=2048,PROBES=128,WORK=8192,MAX_TABLE=4194304;
const valid=id=>Number.isSafeInteger(id)&&id>0;
function hash(id,salt){let low=id>>>0,high=Math.floor(id/4294967296)>>>0;low=Math.imul(low^high^salt,0x85ebca6b);low=Math.imul(low^(low>>>16),0xc2b2ae35);return (low^(low>>>16))>>>0;}
class SheetIdSet{
 constructor(expected=0){this.dense=new NumericInkSet();this.tables=[];this.size=0;this.expected=Math.max(0,Math.min(MAX_TABLE/2,Number.isSafeInteger(expected)?expected:0));}
 has(id){if(!valid(id))return false;if(this.dense.has(id))return true;for(const table of this.tables){const mask=table.values.length-1,start=hash(id,table.salt)&mask;for(let probe=0;probe<PROBES;probe++){const value=table.values[(start+probe)&mask];if(value===id)return true;if(value===0)break;}}return false;}
 add(id){if(!valid(id))throw Error('Invalid drawing stroke identity.');if(this.has(id))return this;const page=Math.floor(id/EDGE);if(this.dense.pages.has(page)||this.dense.pages.size<PAGES){this.dense.add(id);this.size++;return this;}let table=this.tables.at(-1),clustered=false;for(;;){if(!table||table.count>=table.values.length*.65){let capacity=8192,target=clustered?8192:table?Math.min(MAX_TABLE,table.values.length*2):Math.max(8192,Math.min(MAX_TABLE,(this.expected-this.size)*2));while(capacity<target)capacity*=2;table={values:new Float64Array(capacity),count:0,salt:Math.imul(this.tables.length+1,0x9e3779b1)>>>0};this.tables.push(table);}const mask=table.values.length-1,start=hash(id,table.salt)&mask;for(let probe=0;probe<PROBES;probe++){const at=(start+probe)&mask;if(table.values[at]===0){table.values[at]=id;table.count++;this.size++;return this;}}// A pathological cluster cannot cause an unbounded synchronous probe.
    if(this.tables.length>=64)throw Error('Drawing identity table capacity exceeded.');table=null;clustered=true;}
 }
 *steps(){let work=0;for(const [key,page]of this.dense.pages){if(typeof page==='number'){yield key*EDGE+page-1;if(++work%WORK===0)yield null;}else if(Array.isArray(page)){for(const offset of page){yield key*EDGE+offset;if(++work%WORK===0)yield null;}}else for(let word=0;word<EDGE/32;word++){let bits=page[word];while(bits){const bit=31-Math.clz32(bits&-bits);yield key*EDGE+word*32+bit;bits&=bits-1;if(++work%WORK===0)yield null;}}}for(const table of this.tables)for(let at=0;at<table.values.length;at++){if(table.values[at])yield table.values[at];if(++work%WORK===0)yield null;}}
 *values(){for(const id of this.steps())if(id!==null)yield id;}
 [Symbol.iterator](){return this.values();}
 clear(){this.dense.clear();this.tables=[];this.size=0;}
 get storageBytes(){return this.dense.typedBytes+this.tables.reduce((sum,table)=>sum+table.values.byteLength,0);}
 get pageCount(){return this.dense.pages.size;}
}
module.exports={SheetIdSet};
