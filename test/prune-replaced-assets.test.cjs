const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {md}=require('../src/document-renderer.cjs'),prune=require('../src/prune-replaced-assets.js');
const old='assets/old image.png',pair=old+'.json',other='assets/unrelated.png';
function document(text,meta={}){return {text,assets:{[old]:'old',[pair]:'geometry',[other]:'unrelated','assets/new.png':'new'},meta};}

test('replacement prunes only its old pair and decoration without mutating Undo ownership',()=>{
 const original=document('![New](assets/new.png)',{graphicsPanes:{[old]:{width:1},'assets/new.png':{width:2}},attachments:{}}),before=structuredClone(original),result=prune(md,original,[old]);
 assert.deepEqual(result.removed,[old,pair]);assert.equal(result.assets[other],'unrelated');assert.equal(result.assets['assets/new.png'],'new');assert.equal(result.meta.graphicsPanes[old],undefined);assert.deepEqual(result.meta.graphicsPanes['assets/new.png'],{width:2});assert.deepEqual(original,before);assert.equal(result.meta.attachments,original.meta.attachments);
});
test('real parsed references retain the entire source/sidecar pair',()=>{
 for(const text of ['![Old](assets/old%20image.png)','[Drawing](<./assets/old image.png>)','> **![Nested][ink]**\n\n[ink]: <assets/old image.png>','[Geometry](assets/old%20image.png.json)','![![nested](assets/old%20image.png)](assets/new.png)']){
  const original=document(text),result=prune(md,original,old);assert.deepEqual(result.removed,[],text);assert.equal(result.assets,original.assets);assert.equal(result.meta,original.meta);
 }
});
test('code, unused definitions, plain text and external lookalikes do not retain removed sources',()=>{
 const text='`![old](assets/old%20image.png)`\n\n```md\n![old](assets/old%20image.png)\n```\n\n[unused]: <assets/old image.png>\n\nassets/old image.png\n\n![remote](https://example.test/assets/old%20image.png)';
 assert.deepEqual(prune(md,document(text),[old,pair]).removed,[old,pair]);
});
test('attachment metadata sources and shared thumbnails keep candidate pairs',()=>{
 for(const attachments of [{[old]:{title:'Source'}},{'assets/manual.pdf':{thumbnail:old}},{[pair]:{title:'Geometry'}}])assert.deepEqual(prune(md,document('',{attachments,graphicsPanes:{[old]:{}}}),old).removed,[]);
});
test('normalized entities, Unicode, escapes and recursive image children retain exact assets',()=>{
 for(const [name,text]of [['assets/a&b.png','![ink](assets/a&amp;b.png)'],['assets/日本.png','![ink](assets/%E6%97%A5%E6%9C%AC.png)'],['assets/a(1).png','![ink](assets/a\\(1\\).png)']]){
  const doc={text,assets:{[name]:'a',[name+'.json']:'b'},meta:{}};assert.deepEqual(prune(md,doc,name).removed,[]);
 }
});
test('empty candidates avoid parsing, duplicate/missing candidates preserve all unrelated state',()=>{
 const original=document('');assert.equal(prune({parse(){throw Error('Unexpected parse');}},original,[]).assets,original.assets);assert.deepEqual(prune(md,original,['missing.png']).removed,[]);assert.deepEqual(prune(md,original,[old,old,pair]).removed,[old,pair]);
});
test('browser UMD accepts the existing injected document parser',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/prune-replaced-assets.js'),'utf8'),context);const result=context.NoteMindPruneReplacedAssets(md,document(''),[old]);assert.deepEqual([...result.removed],[old,pair]);
});
