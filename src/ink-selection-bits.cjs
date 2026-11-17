const MAX_STROKES=2000000;
class SelectionBits{
 constructor(length=0){if(!Number.isInteger(length)||length<0||length>MAX_STROKES)throw Error('Invalid ink selection size.');this.length=length;this.words=new Uint32Array(Math.ceil(length/32));this.count=0;}
 has(index){return Number.isInteger(index)&&index>=0&&index<this.length&&!!(this.words[index>>>5]&(1<<(index&31)));}
 set(index,on=true){if(!Number.isInteger(index)||index<0||index>=this.length)throw Error('Invalid selected stroke occurrence.');const word=index>>>5,mask=1<<(index&31),was=!!(this.words[word]&mask);if(was!==!!on){this.words[word]=on?this.words[word]|mask:this.words[word]&~mask;this.count+=on?1:-1;}return this;}
 resize(length){if(!Number.isInteger(length)||length<this.length||length>MAX_STROKES)throw Error('Invalid ink selection size.');if(Math.ceil(length/32)>this.words.length){const words=new Uint32Array(Math.min(Math.ceil(MAX_STROKES/32),Math.max(Math.ceil(length/32),Math.ceil(this.words.length*1.5),4)));words.set(this.words);this.words=words;}this.length=length;return this;}
 clone(){const next=new SelectionBits(this.length);next.words.set(this.words.subarray(0,next.words.length));next.count=this.count;return next;}
 *indexes(){for(let word=0;word<this.words.length;word++){let value=this.words[word];while(value){const bit=31-Math.clz32(value&-value),index=word*32+bit;if(index<this.length)yield index;value&=value-1;}}}
}
module.exports={SelectionBits,MAX_STROKES};
