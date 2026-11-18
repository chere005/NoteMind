const {test}=require('node:test'),assert=require('node:assert/strict'),{md}=require('../src/document-renderer.cjs'),packed=require('../src/word-inline.cjs');
const plain=token=>({type:token.type,tag:token.tag,nesting:token.nesting,level:token.level,content:token.content,attrs:token.attrs,meta:token.meta,...(token.children?{children:Array.from(token.children,plain)}:{})});
const expected=text=>md.parseInline(text,{})[0].children.map(plain);
const parse=text=>{const tokens=packed.parseInline(text,md,{});try{packed.linkifyTokens(tokens,text,md,()=>{});packed.joinText(tokens,{normalize:true});return Array.from(tokens,plain);}finally{packed.releaseInline(tokens);}};
test('packed delimiter and join passes bypass compatible object views without changing output',()=>{
 const text=('***a*** ~~b~~~c~~ __d__ [*e*](x) ![~~alt~~](x.png) \\* f ').repeat(40),authority=expected(text),rules=md.inline.ruler2.__rules__.map(rule=>({...rule})),tokenAt=packed.Tokens.prototype.at,delimiterAt=packed.Delimiters.prototype.at;let post=false;
 md.inline.ruler2.before('balance_pairs','packed_test_enter',()=>{post=true;});md.inline.ruler2.after('fragments_join','packed_test_leave',()=>{post=false;});
 packed.Tokens.prototype.at=function(...args){if(post)throw Error('Packed postprocessing materialized a token view.');return tokenAt.apply(this,args);};
 packed.Delimiters.prototype.at=function(...args){if(post)throw Error('Packed postprocessing materialized a delimiter view.');return delimiterAt.apply(this,args);};
 try{assert.deepEqual(parse(text),authority);}finally{packed.Tokens.prototype.at=tokenAt;packed.Delimiters.prototype.at=delimiterAt;md.inline.ruler2.__rules__=rules;md.inline.ruler2.__cache__=null;}
});
test('replaced installed postprocessing rules keep their complete compatible state contract',()=>{
 const rules=md.inline.ruler2.__rules__.map(rule=>({...rule})),original=rules.find(rule=>rule.name==='emphasis').fn;let calls=0;
 md.inline.ruler2.at('emphasis',state=>{calls++;original(state);for(const token of state.tokens)if(token.type==='em_open')token.attrSet('data-extension','kept');});
 try{const text='*a* [**b** *c*](x)';assert.deepEqual(parse(text),expected(text));assert.equal(calls,2);}finally{md.inline.ruler2.__rules__=rules;md.inline.ruler2.__cache__=null;}
});
test('replaced balance and joining rules and caller-owned delimiter lists retain extension behavior',()=>{
 const rules=md.inline.ruler2.__rules__.map(rule=>({...rule})),calls={balance_pairs:0,fragments_join:0};
 for(const name of Object.keys(calls)){const original=rules.find(rule=>rule.name===name).fn;md.inline.ruler2.at(name,state=>{calls[name]++;original(state);});}
 md.inline.ruler2.before('balance_pairs','replace_private_lists',state=>{state.delimiters=Array.from(state.delimiters);state.tokens_meta=Array.from({length:state.tokens_meta.length},(_,i)=>{const value=state.tokens_meta[i];return value?{delimiters:Array.from(value.delimiters)}:undefined;});});
 try{const text='***a*** [~~b~~~c~~ *d*](x)';assert.deepEqual(parse(text),expected(text));assert.deepEqual(calls,{balance_pairs:2,fragments_join:2});}finally{md.inline.ruler2.__rules__=rules;md.inline.ruler2.__cache__=null;}
});
test('packed postprocessing cancellation retires every unpublished token backing',()=>{
 const rules=md.inline.ruler2.__rules__.map(rule=>({...rule})),create=packed.Tokens.prototype.create;let store,cancel=false;
 packed.Tokens.prototype.create=function(...args){store=this;return create.apply(this,args);};md.inline.ruler2.before('emphasis','packed_cancel',()=>{cancel=true;});
 try{assert.throws(()=>packed.parseInline('**a** ~~b~~ '.repeat(800),md,{}, {check:()=>{if(cancel)throw Error('postprocessing cancelled');}}),/postprocessing cancelled/);assert.ok(store);assert.equal(store.typedBytes,0);assert.equal(store.strings.values.length,0);}finally{packed.Tokens.prototype.create=create;md.inline.ruler2.__rules__=rules;md.inline.ruler2.__cache__=null;}
});
test('packed row passes preserve malformed and nested delimiter semantics over a deterministic corpus',()=>{
 const parts=['*','**','***','_','__','___','~','~~','~~~','a',' b ','\\*','\\~','[x *y*](z)','![*a*](x.png)','<u>a *b*</u>','==a==','`*x*`','&amp;','\n'];let seed=71;
 for(let n=0;n<500;n++){let text='';for(let j=0;j<20;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=parts[seed%parts.length];}assert.deepEqual(parse(text),expected(text),text);}
});
