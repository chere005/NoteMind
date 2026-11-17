const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {prepareArchiveFile,publishPreparedArchive}=require('../src/prepared-archive-file.cjs'),{writeNotepadFile}=require('../src/notepad-file.cjs'),guard=require('../src/guarded-write.cjs'),format=require('../src/notepad-format.cjs');
const codec={encodeFile:(doc,target,options)=>writeNotepadFile(doc,options,target)},doc={id:'prepared-exact',text:'Exact new contents 😀',assets:{'assets/source.jpg':Buffer.from('preserved image').toString('base64')},meta:{tags:['exact']}};
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-prepared-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'Note.nm');await fs.writeFile(file,'previous');return{directory,file,expected:await guard.fingerprintFile(file)};}
test('Main validates a private prepared archive then owns its exact guarded publication receipt',async t=>{
 const h=await fixture(t),prepared=await prepareArchiveFile(h.file,doc,{}, {codec});assert.equal((await fs.stat(prepared.directory)).mode&0o777,0o700);assert.equal(await fs.readFile(h.file,'utf8'),'previous');let commits=0;const result=await publishPreparedArchive(h.file,prepared,h.expected,{onCommit:()=>commits++});assert.equal(result.committed,true);assert.equal(commits,1);assert.deepEqual(result.revision,await guard.fingerprintFile(h.file));assert.equal(format.decode(await fs.readFile(h.file)).text,doc.text);await prepared.cleanup();assert.deepEqual(await fs.readdir(h.directory),['Note.nm']);
});
test('prepared data, inode, target and directory changes fail before public rename',async t=>{
 for(const mode of ['digest','inode','target','directory']){
  const h=await fixture(t),prepared=await prepareArchiveFile(h.file,doc,{}, {codec});
  if(mode==='digest')prepared.revision.sha256='0'.repeat(64);
  if(mode==='inode'){await fs.rename(prepared.file,prepared.file+'.old');await fs.writeFile(prepared.file,'replacement');}
  if(mode==='target')await fs.writeFile(h.file,'external edit');
  if(mode==='directory'){await fs.rename(prepared.directory,prepared.directory+'.old');await fs.mkdir(prepared.directory);await fs.writeFile(path.join(prepared.directory,'foreign'),'keep');}
  await assert.rejects(publishPreparedArchive(h.file,prepared,h.expected),/digest|identity|ownership|changed/);assert.equal(await fs.readFile(h.file,'utf8'),mode==='target'?'external edit':'previous');
  if(mode==='directory'){await assert.rejects(prepared.cleanup(),/ownership/);assert.equal(await fs.readFile(path.join(prepared.directory,'foreign'),'utf8'),'keep');}else if(mode==='inode'){await assert.rejects(prepared.cleanup(),/ownership/);assert.equal(await fs.readFile(prepared.file,'utf8'),'replacement');}else await prepared.cleanup();
 }
});
test('late source changes and cancellation preserve the target while committed warnings retain the receipt',async t=>{
 for(const mode of ['source','cancel','sync','observer']){
  const h=await fixture(t),prepared=await prepareArchiveFile(h.file,doc,{}, {codec});let canceled=false,syncs=0;
  const pending=publishPreparedArchive(h.file,prepared,h.expected,{check:()=>{if(canceled)throw Error('cancelled');},beforeRename:async()=>{if(mode==='source')await fs.writeFile(prepared.file,'changed');if(mode==='cancel')canceled=true;},onCommit:()=>{if(mode==='observer')throw Error('observer failure');},sync:async()=>{syncs++;if(mode==='sync')throw Error('directory EIO');}});
  if(mode==='source'||mode==='cancel'){await assert.rejects(pending,/identity|ownership|cancelled/);assert.equal(await fs.readFile(h.file,'utf8'),'previous');}
  else{const receipt=await pending;assert.equal(receipt.committed,true);assert.deepEqual(receipt.revision,await guard.fingerprintFile(h.file));assert.equal(receipt.warnings.length,1);assert.equal(syncs,1);}
  if(mode==='source'){await assert.rejects(prepared.cleanup(),/ownership/);assert.equal(await fs.readFile(prepared.file,'utf8'),'changed');}else await prepared.cleanup();
 }
});
test('preparation rejection joins the producer before removing its owned partial files',async t=>{
 const h=await fixture(t);let stopped=false;
 await assert.rejects(prepareArchiveFile(h.file,doc,{}, {codec:{encodeFile:async(_doc,target)=>{const stage=await require('../src/word-temp.cjs').createWordTemp(target.file,{id:target.tempId,lease:async()=>null,io:require('../src/archive-preparation-temps.cjs').archivePreparationServices(target).fs});await stage.handle.writeFile('partial');await new Promise(resolve=>setTimeout(resolve,10));assert.equal((await stage.handle.stat()).size,7);await stage.handle.close();await stage.finish();stopped=true;throw Error('producer failed after stopping');}}}),/producer failed/);
 assert.equal(stopped,true);assert.equal(await fs.readFile(h.file,'utf8'),'previous');assert.deepEqual(await fs.readdir(h.directory),['Note.nm']);
});
test('Main never adopts a same-content foreign replacement between producer receipt and captured preparation identity',async t=>{
 const h=await fixture(t);let target,expected;
 await assert.rejects(prepareArchiveFile(h.file,doc,{}, {codec:{encodeFile:async(value,destination,options)=>{target=destination.file;const receipt=await writeNotepadFile(value,options,destination);expected=await fs.readFile(target);await fs.rename(target,target+'.owned');await fs.writeFile(target,expected);return receipt;}}}),/ownership/);assert.equal(await fs.readFile(h.file,'utf8'),'previous');assert.deepEqual(await fs.readFile(target),expected);assert.deepEqual(await fs.readFile(target+'.owned'),expected);
});
test('publication revalidates its exact journaled output after a prepared result is accepted',async t=>{
 const h=await fixture(t),prepared=await prepareArchiveFile(h.file,doc,{}, {codec}),bytes=await fs.readFile(prepared.file);await fs.rename(prepared.file,prepared.file+'.original');await fs.writeFile(prepared.file,bytes);prepared.identity=Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,'0']));await assert.rejects(publishPreparedArchive(h.file,prepared,h.expected),/ownership|identity/);assert.equal(await fs.readFile(h.file,'utf8'),'previous');await assert.rejects(prepared.cleanup(),/ownership/);assert.deepEqual(await fs.readFile(prepared.file),bytes);
});
