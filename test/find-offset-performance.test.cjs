const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/notes-find.js'),'utf8'),body=source.slice(source.indexOf(' function scan(text){'),source.indexOf('\n const clearHighlights='));
function current(text,query,options={},stats={}){class Maps extends Uint32Array{constructor(length){super(length);stats.bytes=(stats.bytes||0)+this.byteLength;stats.blocks=(stats.blocks||0)+1;}}return vm.runInNewContext(body+';scan(text)',{text,input:{value:query},options:{matchCase:false,wholeWord:false,...options},word:/[\p{L}\p{N}_]/u,Uint32Array:Maps});}
function previous(text,query,{matchCase=false,wholeWord=false}={}){
 if(!query)return[];const needle=matchCase?query:query.toLocaleLowerCase(),hay=matchCase?text:text.toLocaleLowerCase(),starts=[],ends=[];let offset=0;
 if(!matchCase)for(const character of text){const length=character.toLocaleLowerCase().length;for(let i=0;i<length;i++){starts.push(offset);ends.push(offset+character.length)}offset+=character.length;}
 const found=[],word=/[\p{L}\p{N}_]/u;let from=0,at;while((at=hay.indexOf(needle,from))>=0){const stop=at+needle.length,start=matchCase?at:starts[at],end=matchCase?stop:ends[stop-1];let before=start-1;if(before>0&&/[\uDC00-\uDFFF]/.test(text[before]))before--;const left=start>0?text.slice(before,start):'',right=end<text.length?String.fromCodePoint(text.codePointAt(end)):'';if((!wholeWord||(!word.test(left)&&!word.test(right)))&&!(found.at(-1)?.[0]===start&&found.at(-1)?.[1]===end))found.push([start,end]);from=stop;}return found;
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('sparse source offsets preserve expanding, contextual and astral lowercase matching exactly',()=>{
 const texts=['ASCII abc NEEDLE needle','Aİx i\u0307 İİ i I','ΟΣ ΣΟΣ Σ ΟΣΑ','𐐀a𐐨😀word 𐐀𐐨','\ud800A\udc00𐐀İ end','İ𐐀a xİ𐐀b','A\u0307I\u0301J\u0300'],queries=['a','i','İ','\u0307','σ','ς','οσ','𐐀','𐐨','\ud801','\udc00','😀','word','end'];
 for(const text of texts)for(const query of queries)for(const wholeWord of[false,true])for(const matchCase of[false,true]){const options={wholeWord,matchCase};assert.deepEqual(plain(current(text,query,options)),previous(text,query,options),JSON.stringify({text,query,options}));}
 let seed=4;const alphabet=['a','b','İ','i','Σ','ς','𐐀','𐐨','😀','\u0307','_',' ','-','\ud800','\udc00'];for(let n=0;n<500;n++){let text='';for(let i=0;i<50;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=alphabet[seed%alphabet.length]}for(const query of[alphabet[seed%alphabet.length],text.slice(seed%20,seed%20+3)])assert.deepEqual(plain(current(text,query)),previous(text,query),JSON.stringify({text,query}));}
});
test('ordinary ASCII and unchanged-width BMP searches allocate no source-offset map',()=>{
 for(const text of['ordinary ASCII text '.repeat(50000)+'needle','你好 café Καλημέρα '.repeat(10000)+'needle']){const stats={};assert.deepEqual(plain(current(text,'needle',{},stats)),[[text.length-6,text.length]]);assert.equal(stats.bytes||0,0);assert.equal(stats.blocks||0,0);}
});
test('dense exceptional mappings use bounded packed numeric blocks and preserve end offsets',()=>{
 const text='𐐀İ '.repeat(5000)+'needle',stats={};assert.deepEqual(plain(current(text,'needle',{},stats)),previous(text,'needle'));assert.equal(stats.blocks,Math.ceil(10000/1024));assert.equal(stats.bytes,Math.ceil(10000/1024)*16384);
});
module.exports={body,previous,current};
test('an absent Unicode query returns before per-character lowercase work or offset allocation',()=>{
 const stats={};assert.deepEqual(plain(current('𐐀İ Καλημέρα '.repeat(10000),'absent',{},stats)),[]);assert.equal(stats.blocks||0,0);assert.equal(stats.bytes||0,0);
});
