const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{NotesStore}=require('../src/notes-store.cjs'),codec=require('../src/archive-codec.cjs');
const hash=n=>String(n).repeat(64),prepared=(value,options)=>({contentHash:value,legacyHash:null,unchanged:options.previousHash===value,documentMetadata:{id:options.noteId,title:'Old',created:'created'},objectHashes:[],objectCount:0,sourceRevision:options.expectedRevision});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-version-file-')),store=new NotesStore(dir),doc=await store.register({text:'# Current',assets:{},title:'Current'});const before={file:codec.publishVersionFromFile,doc:codec.publishVersion};t.after(async()=>{codec.publishVersionFromFile=before.file;codec.publishVersion=before.doc;await fs.rm(dir,{recursive:true,force:true});});return {store,doc};}
test('file and in-memory versions share one per-note queue and capture their initiating inputs',async t=>{const {store,doc}=await fixture(t),calls=[];let release,started;const began=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),expected={sha256:hash('a'),bytes:123};
 codec.publishVersionFromFile=async(file,options)=>{calls.push({file,options});started();await gate;return prepared(hash('1'),options);};codec.publishVersion=async(value,options)=>{calls.push({text:value.text,options});return prepared(hash('2'),options);};
 const first=store.versionFromFile('/temporary/original.nm',doc,expected),changed={...doc,text:'# Later'},second=store.version(changed,'Later');expected.sha256=hash('b');changed.text='# Mutated after request';await began;assert.equal(calls.length,1);release();await first;await second;
 assert.equal(calls[0].options.expectedRevision.sha256,hash('a'));assert.equal(calls[0].options.noteId,doc.id);assert.equal(calls[1].text,'# Later');assert.equal(calls[1].options.previousHash,hash('1'));assert.deepEqual((await store.versions(doc.id)).map(item=>item.label),['Before save','Later']);
});
test('failed file publication never changes version index and a retry deduplicates exact content',async t=>{const {store,doc}=await fixture(t);let fail=true;codec.publishVersionFromFile=async(_file,options)=>{if(fail)throw Error('Source replaced');return prepared(hash('3'),options);};await assert.rejects(store.versionFromFile('/source.nm',doc,{sha256:hash('a'),bytes:123}),/Source replaced/);assert.equal((await store.versions(doc.id)).length,0);fail=false;await store.versionFromFile('/source.nm',doc,{sha256:hash('a'),bytes:123});await store.versionFromFile('/source.nm',doc,{sha256:hash('a'),bytes:123});assert.equal((await store.versions(doc.id)).length,1);assert.equal(store.versionPending.size,0);});

test('actual before-save ingestion, raw draft and recovered history preserve paired editable assets',async t=>{
 const {store,doc}=await fixture(t),format=require('../src/notepad-format.cjs'),markdown=require('../src/markdown-files.cjs'),{sourceFileRevision}=require('../src/source-file-revision.cjs'),owner=require('node:crypto').randomUUID(),file=path.join(store.root,'original.nm'),preview=Buffer.from('preview'),ink=Buffer.from('editable sidecar'),original={...doc,text:'![Ink](image.png)',assets:{'image.png':preview.toString('base64'),'image.png.json':ink.toString('base64')}};
 const originalBytes=format.encode(markdown.canonical(original));await fs.writeFile(file,originalBytes);const revision=await sourceFileRevision(file),lease=await codec.preflightRawAssets([],{owner});
 try{await lease.run(async()=>{
  const rawPreview=await codec.importRawAssetFile(file,{name:'assets/source.nm',root:store.root});
  const input={...doc,text:'[Source](source.nm)',assets:{'source.nm':rawPreview},dirty:true};
  await store.draft(input);const probed=await store.recoveryState(doc.id);assert.equal(probed.dirty,true);assert.equal(probed.unknown,undefined);
  await store.versionFromFile(file,doc,revision);await store.versionFromFile(file,doc,revision);assert.equal((await store.versions(doc.id)).length,1);
  const restored=await store.versionDoc(doc.id,(await store.versions(doc.id))[0].id),expected=markdown.canonical(original);assert.equal(restored.text,expected.text);assert.deepEqual(Object.keys(restored.assets),Object.keys(expected.assets));for(const [key,value]of Object.entries(restored.assets))await codec.withRawAssetBytes(value,bytes=>assert.equal(bytes.toString('base64'),expected.assets[key]));
  const recovered=await store.loadDraft(doc.id);assert.equal(recovered.text,'[Source]('+Object.keys(recovered.assets)[0]+')');await codec.withRawAssetBytes(Object.values(recovered.assets)[0],bytes=>assert.deepEqual(bytes,originalBytes));
 });}
 finally{await lease.release();await codec.releaseRawAssets(owner);}
 await fs.writeFile(file,format.encode(markdown.canonical({...original,text:'Changed on disk'})));await assert.rejects(store.versionFromFile(file,doc,revision),/changed/);assert.equal((await store.versions(doc.id)).length,1);
});

test.after(()=>codec.dispose());
