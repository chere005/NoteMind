// Values are captured, never resolved from a mutable stroke list during upload.
const PAGE=4096,MAX_IDS=2000000;
const discard=bytes=>{if(bytes?.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0);};
class PrivateSheetIds{
 #pages;#offset;#released=false;#bytes;
 constructor(pages,offset,length){this.#pages=pages;this.#offset=offset;this.length=length;this.#bytes=pages.reduce((n,page)=>n+(page.data?.byteLength||0),0);Object.freeze(this);}
 static is(value){return !!value&&typeof value==='object'&&#pages in value;}
 get storageBytes(){return this.#released?0:this.#bytes;}
 get pageCount(){return this.#pages.length;}
 at(index){if(this.#released)throw Error('Drawing identities were released.');if(!Number.isSafeInteger(index)||index<0||index>=this.length)return undefined;const value=index+this.#offset,page=this.#pages[Math.floor(value/PAGE)],local=value%PAGE;return page.data?page.data[local]:page.first+page.step*local;}
 *[Symbol.iterator](){for(let at=0;at<this.length;at++)yield this.at(at);}
 release(){if(this.#released)return;this.#released=true;for(const page of this.#pages)discard(page.data);this.#pages=[];}
}
class SheetPrivateIdBuilder{
 #expected;#length=0;#pages=[];#scratch=null;#count=0;#closed=false;#first=0;#step=0;#affine=true;#narrow=true;
 get length(){return this.#length;}
 get storageBytes(){return(this.#scratch?.byteLength||0)+this.#pages.reduce((n,page)=>n+(page.data?.byteLength||0),0);}
 constructor(length){if(!Number.isSafeInteger(length)||length<0||length>MAX_IDS)throw Error('Invalid drawing identity count.');this.#expected=length;this.#length=0;this.#pages=[];this.#scratch=null;this.#count=0;this.#closed=false;this.#first=0;this.#step=0;this.#affine=true;this.#narrow=true;}
 push(value){if(this.#closed||this.#length>=this.#expected||!Number.isSafeInteger(value)||value<=0)throw Error('Invalid drawing identity.');this.#scratch ||=new Float64Array(PAGE);this.#scratch[this.#count]=value;if(!this.#count)this.#first=value;else if(this.#count===1)this.#step=value-this.#first;else{const expected=this.#first+this.#step*this.#count;if(!Number.isSafeInteger(expected)||expected!==value)this.#affine=false;}if(value>0xffffffff)this.#narrow=false;this.#count++;this.#length++;if(this.#count===PAGE)this.flush();}
 flush(){if(!this.#count)return;let data=null;const scratch=this.#scratch;if(!this.#affine){if(this.#narrow){data=new Uint32Array(this.#count);for(let at=0;at<this.#count;at++)data[at]=scratch[at];}else data=this.#count===PAGE?scratch:scratch.slice(0,this.#count);}if(data!==scratch)discard(scratch);this.#pages.push({first:this.#first,step:this.#step,data});this.#scratch=null;this.#count=0;this.#first=this.#step=0;this.#affine=this.#narrow=true;}
 finish(start=0){if(this.#closed||this.#length!==this.#expected||!Number.isSafeInteger(start)||start<0||start>this.#length)throw Error('Incomplete drawing identities.');this.flush();const first=start===this.#length?this.#pages.length:Math.floor(start/PAGE);for(let at=0;at<first;at++)discard(this.#pages[at].data);const pages=this.#pages.slice(first),offset=start===this.#length?0:start%PAGE,result=new PrivateSheetIds(pages,offset,this.#length-start);this.#pages=[];this.#closed=true;return result;}
 dispose(){discard(this.#scratch);this.#scratch=null;for(const page of this.#pages)discard(page.data);this.#pages=[];this.#closed=true;}
}
const isPrivateSheetIds=value=>PrivateSheetIds.is(value),sheetIdAt=(source,index)=>isPrivateSheetIds(source)?source.at(index):source[index];
function releasePrivateSheetIds(value){if(isPrivateSheetIds(value))value.release();}
async function materializePrivateSheetIds(value,{check=()=>{},yieldControl=async()=>{}}={}){if(!isPrivateSheetIds(value))return value;const result=new Float64Array(value.length);try{for(let at=0;at<result.length;at++){result[at]=value.at(at);if((at+1)%8192===0){check();await yieldControl();check();}}check();return result;}catch(error){discard(result);throw error;}}
module.exports={SheetPrivateIdBuilder,isPrivateSheetIds,sheetIdAt,releasePrivateSheetIds,materializePrivateSheetIds,PAGE};
