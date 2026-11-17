const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {legacyTokens,CanonicalJSON,JSONValue}=require('../src/sheet-json-tokens.cjs');
async function fixture(t,text){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-sheet-json-')),file=path.join(root,'legacy.json');await fs.writeFile(file,text);t.after(()=>fs.rm(root,{recursive:true,force:true}));return file;}
test('streamed canonical JSON matches JSON.stringify without losing negative-zero source numbers',async t=>{
 const raw=' {"name":"日本語 🖊️","points":[{"x":-0,"y":1e-7}],"text":"line\\nquote\\\""} ',file=await fixture(t,raw),parts=[],numbers=[],canonical=new CanonicalJSON(piece=>parts.push(piece));for await(const token of legacyTokens(file)){canonical.token(token);if(token.name==='numberValue')numbers.push(Number(token.value));}assert.equal(parts.join(''),JSON.stringify(JSON.parse(raw)));assert.equal(Object.is(numbers[0],-0),true);
});
test('bounded metadata assembly preserves nested fields and handles prototype keys as data',async t=>{
 const raw='{"paper":{"kind":"grid"},"__proto__":{"safe":true},"tags":["a",2]}',file=await fixture(t,raw),value=new JSONValue();for await(const token of legacyTokens(file))value.token(token);assert.equal(JSON.stringify(value.root),raw);assert.equal(Object.getPrototypeOf(value.root),null);assert.equal(value.root.__proto__.safe,true);
});
test('malformed syntax, duplicate properties and oversized metadata fail closed',async t=>{
 const broken=await fixture(t,'[{"points":]');await assert.rejects(Array.fromAsync(legacyTokens(broken)));const repeated=await fixture(t,'{"x":1,"x":2}'),canonical=new CanonicalJSON(()=>{});await assert.rejects(async()=>{for await(const token of legacyTokens(repeated))canonical.token(token);},/Duplicate/);const large=await fixture(t,JSON.stringify({name:'x'.repeat(100)})),value=new JSONValue({maxBytes:50});await assert.rejects(async()=>{for await(const token of legacyTokens(large))value.token(token);},/too large/);
});
