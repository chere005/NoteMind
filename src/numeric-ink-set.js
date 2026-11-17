// Private renderer membership. Sparse pages keep tiny numeric rows; dense pages
// use one bit per ID instead of one hash-table entry per stroke occurrence.
const EDGE=4096,WORDS=EDGE/32,SMALL=8;
const valid=id=>Number.isSafeInteger(id)&&id>0;
class NumericInkSet {
 constructor(){this.pages=new Map();this.size=0;}
 has(id){if(!valid(id))return false;const key=Math.floor(id/EDGE),offset=id-key*EDGE,page=this.pages.get(key);return page===undefined?false:typeof page==='number'?page===offset+1:Array.isArray(page)?page.includes(offset):!!(page[offset>>>5]&(1<<(offset&31)));}
 add(id){if(!valid(id))throw Error('Invalid ink identity.');const key=Math.floor(id/EDGE),offset=id-key*EDGE,page=this.pages.get(key);if(page===undefined)this.pages.set(key,offset+1);else if(typeof page==='number'){if(page===offset+1)return this;this.pages.set(key,[page-1,offset]);}else if(Array.isArray(page)){if(page.includes(offset))return this;page.push(offset);if(page.length>SMALL){const bitmap=new Uint32Array(WORDS+1);for(const value of page)bitmap[value>>>5]|=1<<(value&31);bitmap[WORDS]=page.length;this.pages.set(key,bitmap);}}else{const word=offset>>>5,bit=1<<(offset&31);if(page[word]&bit)return this;page[word]|=bit;page[WORDS]++;}this.size++;return this;}
 delete(id){if(!valid(id))return false;const key=Math.floor(id/EDGE),offset=id-key*EDGE,page=this.pages.get(key);if(page===undefined)return false;if(typeof page==='number'){if(page!==offset+1)return false;this.pages.delete(key);}else if(Array.isArray(page)){const at=page.indexOf(offset);if(at<0)return false;page.splice(at,1);if(page.length===1)this.pages.set(key,page[0]+1);}else{const word=offset>>>5,bit=1<<(offset&31);if(!(page[word]&bit))return false;page[word]&=~bit;const count=--page[WORDS];if(count<=SMALL){const values=[];for(let index=0;index<WORDS;index++){let value=page[index];while(value){const bit=31-Math.clz32(value&-value);values.push(index*32+bit);value&=value-1;}}if(values.length===1)this.pages.set(key,values[0]+1);else if(!values.length)this.pages.delete(key);else this.pages.set(key,values);}}this.size--;return true;}
 clear(){this.pages.clear();this.size=0;}
 get typedBytes(){let bytes=0;for(const page of this.pages.values())if(page instanceof Uint32Array)bytes+=page.byteLength;return bytes;}
}
module.exports={NumericInkSet};
