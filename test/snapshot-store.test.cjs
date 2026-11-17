const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash,randomBytes}=require('node:crypto');
const snapshots=require('../src/snapshot-store.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-snapshot-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const document=(assets={})=>({id:'note',title:'Snapshot',created:'2026-01-01T00:00:00.000Z',text:'![Image](assets/a.bin)',meta:{tags:['test']},assets});
async function objectFiles(root){const dir=path.join(root,'objects');try{return (await Promise.all((await fs.readdir(dir)).map(async name=>(await fs.readdir(path.join(dir,name))).map(file=>path.join(dir,name,file))))).flat();}catch(error){if(error.code==='ENOENT')return [];throw error;}}

test('snapshot history shares unchanged binary assets across names, versions and restart',async t=>{
 const root=await fixture(t),data=randomBytes(64*1024).toString('base64'),doc=document({'assets/a.bin':data,'assets/copy.bin':data}),first=snapshots.prepareSnapshot(doc),cache=new Map();
 assert.equal(first.objects.length,1);await snapshots.publishSnapshot(root,'first',first,cache);assert.deepEqual(await snapshots.readSnapshot(root,'first'),doc);
 const hints=await snapshots.readSnapshot(root,'first',{referencesOnly:true});assert.equal(hints.knownHashes.length,1);
 const next=snapshots.prepareSnapshot({...doc,text:'Changed text'},{knownHashes:hints.knownHashes,previousHash:first.contentHash});assert.equal(next.objects.length,0);assert.equal(next.unchanged,false);await snapshots.publishSnapshot(root,'next',next,new Map());
 assert.equal((await objectFiles(root)).length,1);assert.equal((await snapshots.readSnapshot(root,'first')).text,doc.text);assert.equal((await snapshots.readSnapshot(root,'next')).text,'Changed text');
 for(const value of cache.values())assert.deepEqual(Object.keys(value).sort(),['ctimeMs','dev','ino','mtimeMs','size']);
});
test('snapshot fingerprints skip unchanged and legacy-identical documents without returning blobs',()=>{
 const doc=document({'assets/a.bin':randomBytes(4096).toString('base64')}),first=snapshots.prepareSnapshot(doc),unchanged=snapshots.prepareSnapshot(doc,{previousHash:first.contentHash}),legacy=hash(JSON.stringify({text:doc.text,assets:doc.assets,meta:doc.meta}));
 assert.equal(unchanged.unchanged,true);assert.equal(unchanged.objects.length,0);const migrated=snapshots.prepareSnapshot(doc,{previousHash:legacy});assert.equal(migrated.unchanged,true);assert.equal(migrated.objects.length,0);
 const changed=snapshots.prepareSnapshot({...doc,assets:{'assets/a.bin':Buffer.from('different').toString('base64')}},{previousHash:first.contentHash});assert.equal(changed.unchanged,false);assert.notEqual(changed.contentHash,first.contentHash);
});
test('prepared manifest bytes are complete and version reads reject altered text, metadata, identity and asset refs',async t=>{
 const root=await fixture(t),doc=document({'assets/a.bin':Buffer.from('protected asset').toString('base64')}),prepared=snapshots.prepareSnapshot(doc);
 assert.deepEqual(JSON.parse(Buffer.from(prepared.manifestBytes)),prepared.manifest);assert.equal(prepared.manifestBytes.byteOffset,0);assert.equal(prepared.manifestBytes.byteLength,prepared.manifestBytes.buffer.byteLength);
 for(const [i,mutate]of [m=>m.document.text='altered',m=>m.document.meta.tags=['changed'],m=>m.document.id='another-note',m=>m.document.title='another title',m=>m.document.created='another date',m=>m.assets['assets/renamed.bin']=m.assets['assets/a.bin']].entries()){
  const id='tamper-'+i;await snapshots.publishSnapshot(root,id,prepared);const altered=JSON.parse(Buffer.from(prepared.manifestBytes));mutate(altered);await fs.writeFile(snapshots.manifestFile(root,id),JSON.stringify(altered));await assert.rejects(snapshots.readSnapshot(root,id),/metadata is damaged/);await assert.rejects(snapshots.readSnapshot(root,id,{referencesOnly:true}),/metadata is damaged/);
 }
});
test('snapshot object publication survives concurrent publishers without replacing existing data',async t=>{
 const root=await fixture(t),doc=document({'assets/a.bin':randomBytes(16*1024).toString('base64')}),prepared=snapshots.prepareSnapshot(doc);
 await Promise.all([snapshots.publishSnapshot(root,'one',prepared),snapshots.publishSnapshot(root,'two',prepared)]);assert.equal((await objectFiles(root)).length,1);assert.deepEqual(await snapshots.readSnapshot(root,'one'),doc);assert.deepEqual(await snapshots.readSnapshot(root,'two'),doc);
 await assert.rejects(snapshots.publishSnapshot(root,'one',snapshots.prepareSnapshot({...doc,text:'overwrite'})),{code:'EEXIST'});assert.equal((await snapshots.readSnapshot(root,'one')).text,doc.text);
});
test('snapshot reads reject missing, corrupted and forged asset references',async t=>{
 const root=await fixture(t),doc=document({'assets/a.bin':Buffer.from('original').toString('base64')}),prepared=snapshots.prepareSnapshot(doc);await snapshots.publishSnapshot(root,'one',prepared);const ref=prepared.manifest.assets['assets/a.bin'],file=snapshots.objectFile(root,ref.hash),original=await fs.readFile(file);
 await fs.writeFile(file,Buffer.alloc(original.length,1));await assert.rejects(snapshots.readSnapshot(root,'one'),/damaged/);
 await fs.unlink(file);await assert.rejects(snapshots.readSnapshot(root,'one'));assert.equal((await snapshots.readSnapshot(root,'one',{referencesOnly:true})).knownHashes.length,0);
 const bad=structuredClone(prepared.manifest);bad.assets['assets/a.bin'].hash='../escape';await fs.writeFile(snapshots.manifestFile(root,'bad'),JSON.stringify(bad));await assert.rejects(snapshots.readSnapshot(root,'bad'),/Invalid version asset/);
 const sizes=structuredClone(prepared.manifest);sizes.assets['assets/copy.bin']={hash:ref.hash,bytes:ref.bytes+1};assert.throws(()=>snapshots.validateManifest(sizes),/Invalid version asset/);
 await assert.rejects(snapshots.publishSnapshot(root,'../escape',prepared),/Invalid snapshot identity/);assert.throws(()=>snapshots.prepareSnapshot(document({'assets/../escape':'AA=='})),/Invalid version asset/);
});
test('corrupt pre-existing objects fail closed rather than publishing a new manifest',async t=>{
 const root=await fixture(t),doc=document({'assets/a.bin':Buffer.from('correct').toString('base64')}),prepared=snapshots.prepareSnapshot(doc),ref=prepared.manifest.assets['assets/a.bin'],file=snapshots.objectFile(root,ref.hash);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.from('corrupt'));
 await assert.rejects(snapshots.publishSnapshot(root,'one',prepared),/damaged/);await assert.rejects(fs.access(snapshots.manifestFile(root,'one')),{code:'ENOENT'});assert.equal((await fs.readFile(file)).toString(),'corrupt');
});
test('interrupted manifest publication leaves earlier versions readable',async t=>{
 const root=await fixture(t),doc=document({'assets/a.bin':Buffer.from('asset').toString('base64')}),first=snapshots.prepareSnapshot(doc);await snapshots.publishSnapshot(root,'first',first);const link=fs.link;
 t.mock.method(fs,'link',async(from,to)=>{if(to===snapshots.manifestFile(root,'interrupted'))throw Object.assign(Error('interrupted'),{code:'EIO'});return link(from,to);});
 await assert.rejects(snapshots.publishSnapshot(root,'interrupted',snapshots.prepareSnapshot({...doc,text:'new'})),/interrupted/);assert.equal((await snapshots.readSnapshot(root,'first')).text,doc.text);await assert.rejects(fs.access(snapshots.manifestFile(root,'interrupted')),{code:'ENOENT'});
});
test('CAS ACK follows file sync, immutable publication and the full parent-directory sync chain',async t=>{
 const root=await fixture(t),prepared=snapshots.prepareSnapshot(document({'assets/a.bin':Buffer.from('durable').toString('base64')})),ref=prepared.manifest.assets['assets/a.bin'],object=snapshots.objectFile(root,ref.hash),manifest=snapshots.manifestFile(root,'durable'),events=[],open=fs.open,link=fs.link;
 t.mock.method(fs,'open',async(file,...args)=>{const handle=await open(file,...args),sync=handle.sync.bind(handle);handle.sync=async()=>{events.push(['sync',file]);return sync();};return handle;});t.mock.method(fs,'link',async(from,to)=>{events.push(['link',to]);return link(from,to);});
 await snapshots.publishSnapshot(root,'durable',prepared);events.push(['ack','']);const index=(kind,name)=>events.findIndex(([what,file])=>what===kind&&(typeof name==='string'?file===name:name(file)));
 assert.ok(index('sync',name=>name.startsWith(object+'.'))<index('link',object));assert.ok(index('link',object)<index('sync',path.dirname(object)));assert.ok(index('sync',path.dirname(object))<index('sync',name=>name.startsWith(manifest+'.')));assert.ok(index('sync',name=>name.startsWith(manifest+'.'))<index('link',manifest));assert.ok(index('link',manifest)<index('sync',path.dirname(manifest)));assert.ok(index('sync',path.dirname(manifest))<index('ack',''));assert.ok(events.some(([kind,file])=>kind==='sync'&&file===path.dirname(root)));
});
test('CAS file and directory fsync faults never acknowledge an unsafe version',async t=>{
 for(const phase of ['object-file','object-directory','manifest-file','manifest-directory']){
  const root=await fixture(t),doc=document({'assets/a.bin':Buffer.from('durable '+phase).toString('base64')}),prepared=snapshots.prepareSnapshot(doc),object=snapshots.objectFile(root,prepared.manifest.assets['assets/a.bin'].hash),manifest=snapshots.manifestFile(root,'failure'),open=fs.open;let failed=false;
  const selected=file=>phase==='object-file'?file.startsWith(object+'.'):phase==='object-directory'?file===path.dirname(object):phase==='manifest-file'?file.startsWith(manifest+'.'):file===path.dirname(manifest);
  const mock=t.mock.method(fs,'open',async(file,...args)=>{const handle=await open(file,...args),sync=handle.sync.bind(handle);handle.sync=async()=>{if(!failed&&selected(file)){failed=true;throw Object.assign(Error('fsync '+phase),{code:'EIO'});}return sync();};return handle;});
  await assert.rejects(snapshots.publishSnapshot(root,'failure',prepared),error=>error.code==='EIO');assert.equal(failed,true);mock.mock.restore();if(phase==='manifest-directory')assert.deepEqual(await snapshots.readSnapshot(root,'failure'),doc);else await assert.rejects(fs.access(manifest),{code:'ENOENT'});await snapshots.publishSnapshot(root,'safe-retry',prepared);assert.deepEqual(await snapshots.readSnapshot(root,'safe-retry'),doc);
 }
});
