const {test}=require('node:test'),assert=require('node:assert/strict'),{md}=require('../src/document-renderer.cjs'),{Tokens,parseInline,releaseInline}=require('../src/word-inline.cjs');
const input='!['+'*a* '.repeat(9000)+'](x.png)',columns=['type','tag','content','attrs','meta','level','nesting','order'];
function captured(run){const original=Tokens.prototype.create,stores=new Set();Tokens.prototype.create=function(...args){stores.add(this);return original.apply(this,args);};try{return run(stores,original);}finally{Tokens.prototype.create=original;}}
const buffers=stores=>[...stores].flatMap(store=>columns.flatMap(key=>store[key].pages.filter(Boolean).map(page=>page.buffer)));
function retired(stores,backings){assert.ok(stores.size>=2,'a completed packed child must exist');assert.ok(backings.length>0);assert.equal(backings.reduce((sum,value)=>sum+value.byteLength,0),0,'every captured owned backing is explicitly detached');for(const store of stores){assert.equal(store.typedBytes,0);assert.equal(store.strings.values.length,0);assert.equal(store.cache.values.size,0);}}
test('parent postprocessing failure retires the completed private image-alt packet',()=>captured(stores=>{
 const rules=md.inline.ruler2.__rules__.map(rule=>({...rule}));let backings,completed=false;
 md.inline.ruler2.before('balance_pairs','nested_owner_fault',state=>{if(state.src!==input)return;completed=[...stores].some(store=>store.count>1000&&store.names.includes('em_open'));backings=buffers(stores);throw Error('parent postprocessing failed');});
 try{assert.throws(()=>parseInline(input,md,{}),/parent postprocessing failed/);assert.equal(completed,true);retired(stores,backings);}finally{md.inline.ruler2.__rules__=rules;md.inline.ruler2.__cache__=null;}
}));
test('failure before image token attachment still retires its already completed packed child',()=>captured((stores,original)=>{
 let backings,completed=false;Tokens.prototype.create=function(type,...args){stores.add(this);if(type==='image'){completed=[...stores].some(store=>store.count>1000&&store.names.includes('em_open'));backings=buffers(stores);throw Error('parent token interrupted');}return original.call(this,type,...args);};
 assert.throws(()=>parseInline(input,md,{}),/parent token interrupted/);assert.equal(completed,true);retired(stores,backings);
}));
test('replaced private child remains owned while ordinary extension children remain borrowed',()=>captured(stores=>{
 const rules=md.inline.ruler2.__rules__.map(rule=>({...rule})),borrowedBytes=new Uint8Array([4,5,6]),borrowed=[{type:'text',content:'caller child',bytes:borrowedBytes}];let backings;
 md.inline.ruler2.before('balance_pairs','replace_nested_owner',state=>{if(state.src!==input)return;backings=buffers(stores);state.tokens[0].children=borrowed;throw Error('extension interrupted');});
 try{assert.throws(()=>parseInline(input,md,{}),/extension interrupted/);retired(stores,backings);assert.deepEqual(borrowedBytes,new Uint8Array([4,5,6]));assert.equal(borrowed[0].content,'caller child');}finally{md.inline.ruler2.__rules__=rules;md.inline.ruler2.__cache__=null;}
}));
test('successful recursive private packets remain usable until their exact owner releases them',()=>captured(stores=>{
 const tokens=parseInline('![outer '+input+'](outer.png)',md,{}),backings=buffers(stores);assert.ok(stores.size>=3);assert.ok(backings.every(value=>value.byteLength>0));assert.equal(tokens[0].type,'image');assert.ok(tokens[0].children.length);assert.equal(releaseInline(tokens),true);retired(stores,backings);assert.equal(releaseInline(tokens),false);
}));
test('a successful extension replacement keeps its orphaned private child charged until owner release',()=>captured(stores=>{
 const rules=md.inline.ruler2.__rules__.map(rule=>({...rule})),borrowedBytes=new Uint8Array([7,8]),borrowed=[{type:'text',content:'caller replacement',bytes:borrowedBytes}];
 md.inline.ruler2.before('balance_pairs','replace_nested_success',state=>{if(state.src===input)state.tokens[0].children=borrowed;});
 let tokens;try{tokens=parseInline(input,md,{});const backings=buffers(stores);assert.equal(tokens[0].children,borrowed);assert.ok(backings.every(value=>value.byteLength>0));assert.equal(releaseInline(tokens),true);retired(stores,backings);assert.deepEqual(borrowedBytes,new Uint8Array([7,8]));}finally{if(tokens)releaseInline(tokens);md.inline.ruler2.__rules__=rules;md.inline.ruler2.__cache__=null;}
}));
