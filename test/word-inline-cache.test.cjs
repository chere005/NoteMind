const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{md}=require('../src/document-renderer.cjs'),{streamMarkdown}=require('../src/word-markdown.cjs');
const source=fs.readFileSync(require.resolve('../src/word-inline.cjs'),'utf8'),Cache=new Function(source.slice(source.indexOf('class Cache {'),source.indexOf('\nconst discard ='))+';return Cache;')();
test('packed view cache keeps exactly the original FIFO eviction and lazy identity semantics',()=>{
 const cache=new Cache(),reference=new Map();let serial=0;const previous=(key,make)=>{let value=reference.get(key);if(!value){value=make();reference.set(key,value);if(reference.size>256)reference.delete(reference.keys().next().value)}return value};
 let seed=7;for(let n=0;n<10000;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const key=n<500?n:seed%700,value={serial:++serial};assert.equal(cache.get(key,()=>value),previous(key,()=>value));assert.deepEqual([...cache.values.keys()],[...reference.keys()]);assert.ok(cache.values.size<=256);}
 const zero=new Cache();assert.equal(zero.get('zero',()=>0),0);assert.equal(zero.get('zero',()=>false),false);assert.deepEqual([...zero.values.keys()],['zero']);assert.equal(zero.next,1);assert.throws(()=>zero.get('throws',()=>{throw Error('not made')}),/not made/);assert.equal(zero.next,1);
});
test('long packed inline tokens preserve complete Markdown semantics across repeated cache eviction',()=>{
 const text=('a **bold** _italic_ ~~strike~~ ==mark== `code` ![alt](assets/a.png) [link](https://a.example) ').repeat(500),expected=md.parse(text,{}),actual=[];
 const plain=token=>({type:token.type,tag:token.tag,nesting:token.nesting,content:token.content,attrs:token.attrs,children:token.children?Array.from(token.children,plain):undefined});streamMarkdown(text,token=>actual.push(plain(token)));assert.deepEqual(actual,expected.map(plain));
});
