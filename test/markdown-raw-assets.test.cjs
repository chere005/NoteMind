const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),codec=require('../src/archive-codec.cjs'),markdown=require('../src/markdown-files.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-markdown-raw-')),original=codec.withRawAssetBytes;t.after(async()=>{codec.withRawAssetBytes=original;await fs.rm(dir,{recursive:true,force:true});});return dir;}
test('raw descriptors canonicalize and write the exact legacy preview/sidecar filenames and bytes',async t=>{
 const dir=await fixture(t),file=path.join(dir,'note.md'),preview=Buffer.from('preview'),sidecar=Buffer.from('editable'),raw={rawAssetToken:'owned-preview'},ink={rawAssetToken:'owned-ink'},data=new Map([[raw,preview],[ink,sidecar]]);let reads=0;
 codec.withRawAssetBytes=async(value,run)=>{assert.ok(data.has(value));reads++;return run(data.get(value));};
 const common={text:'![Drawing](image.png)',meta:{graphicsPanes:{'image.png':{version:1}}}},legacy={...common,assets:{'image.png':preview.toString('base64'),'image.png.json':sidecar.toString('base64')}},doc={...common,assets:{'image.png':raw,'image.png.json':ink}},expected=markdown.canonical(legacy),canonical=await markdown.canonicalAsync(doc);
 assert.equal(canonical.text,expected.text);assert.deepEqual(Object.keys(canonical.assets),Object.keys(expected.assets));assert.equal(Object.values(canonical.assets)[0],raw);
 const saved=await markdown.prepare(doc,file,{metadata:false}),again=await markdown.prepare(doc,file,{metadata:false});assert.equal(again.text,saved.text);assert.equal(Object.values(saved.assets)[0],raw);for(const [name,value]of Object.entries(saved.assets))assert.deepEqual(await fs.readFile(path.join(dir,name)),data.get(value));assert.ok(reads>=8);assert.equal(preview.toString(),'preview');assert.equal(sidecar.toString(),'editable');
});
test('failed raw reads publish no partial immutable attachment and retry remains possible',async t=>{
 const dir=await fixture(t),file=path.join(dir,'note.md'),raw={rawAssetToken:'owned'},doc={text:'![Image](assets/image.png)',assets:{'assets/image.png':raw}};let reads=0;
 codec.withRawAssetBytes=async(_value,run)=>{await run(Buffer.from('payload'));if(++reads===2)throw Error('Worker reset');};
 await assert.rejects(markdown.prepare(doc,file,{metadata:false}),/Worker reset/);const folder=path.join(dir,markdown.sidecarFolder(file));assert.deepEqual(await fs.readdir(folder),[]);
 codec.withRawAssetBytes=async(_value,run)=>run(Buffer.from('payload'));const saved=await markdown.prepare(doc,file,{metadata:false});assert.equal((await fs.readdir(folder)).length,1);assert.equal((await fs.readFile(path.join(dir,Object.keys(saved.assets)[0]))).toString(),'payload');
});
test('Markdown legacy base64 supports unpadded data and refuses occupied mismatched companions',async t=>{
 const dir=await fixture(t),file=path.join(dir,'note.md'),doc={text:'![Image](assets/image.png)',assets:{'assets/image.png':'YQ'}},saved=await markdown.prepare(doc,file,{metadata:false}),target=path.join(dir,Object.keys(saved.assets)[0]);assert.equal((await fs.readFile(target)).toString(),'a');await fs.writeFile(target,'different');await assert.rejects(markdown.prepare(doc,file,{metadata:false}),/already exists/);assert.equal((await fs.readFile(target)).toString(),'different');assert.equal((await fs.readdir(path.dirname(target))).filter(name=>name.endsWith('.tmp')).length,0);
});
