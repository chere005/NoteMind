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

test('scoped Markdown open imports linked preview and editable sidecar without Main base64 reads',async t=>{
 const dir=await fixture(t),file=path.join(dir,'note.md'),name='é drawing.png',preview=Buffer.from('preview'),graphics=require('../src/graphics-pane.js'),sidecar=await graphics.encodeBytesAsync({name:'Ink',aspect:1,strokes:[{colorHex:'#123456',width:2,points:[{x:.2,y:.3}]}]}),owner=require('node:crypto').randomUUID();
 await fs.writeFile(path.join(dir,name),preview);await fs.writeFile(path.join(dir,name+'.json'),sidecar);
 const text='![Ink]('+encodeURIComponent(name)+')',lease=await codec.preflightRawAssets([],{owner}),readFile=fs.readFile;
 t.mock.method(fs,'readFile',async(target,...args)=>{if([path.join(dir,name),path.join(dir,name+'.json')].includes(target))assert.fail('Linked payload was read in Main');return readFile(target,...args);});
 try{await lease.run(async()=>{const doc=await markdown.read(file,text),key=encodeURIComponent(name);assert.equal(doc.assets[key].bytes,preview.length);assert.equal(doc.assets[key+'.json'].bytes,sidecar.length);await codec.withRawAssetBytes(doc.assets[key],bytes=>assert.deepEqual(bytes,preview));await codec.withRawAssetBytes(doc.assets[key+'.json'],bytes=>assert.deepEqual(bytes,Buffer.from(sidecar)));assert.equal(codec.assetStats().raw.working,0);});}
 finally{await lease.release();await codec.releaseRawAssets(owner);}
});

test('scoped Markdown import refuses source races and never hides a lost worker as an empty asset set',async t=>{
 const dir=await fixture(t),file=path.join(dir,'note.md'),asset=path.join(dir,'image.png'),owner=require('node:crypto').randomUUID();await fs.writeFile(asset,'preview');const lease=await codec.preflightRawAssets([],{owner}),importFile=codec.importRawAssetFile;
 t.mock.method(codec,'importRawAssetFile',async()=>{throw Object.assign(Error('The raw archive worker was lost during this operation.'),{code:'ARCHIVE_RAW_LEASE_LOST'});});
 try{await assert.rejects(lease.run(()=>markdown.read(file,'![Ink](image.png)')),error=>error.code==='ARCHIVE_RAW_LEASE_LOST');}
 finally{codec.importRawAssetFile=importFile;await lease.release();await codec.releaseRawAssets(owner);}
});

test.after(()=>codec.dispose());
