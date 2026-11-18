const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const archiveCodec = require('./archive-codec.cjs');
const {keyPath}=require('./path-key.cjs');
const digest = data => createHash('sha256').update(data).digest('hex');
const titleOf = text => String(text || '').split(/\r?\n/).map(s => s.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ x]\]\s*)?)/i, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[*_`=]/g, '').trim()).find(Boolean)?.slice(0, 100) || 'Untitled';
const resolveTitleOf=async text=>(await require('./notes-title.js').resolveAutomaticTitleInfo(text)).title;
const metadata = value => ({tags: [...new Set((Array.isArray(value?.tags) ? value.tags : []).map(t => String(t).trim().replace(/^#/, '').slice(0, 60)).filter(Boolean))].slice(0, 100), pinned: !!value?.pinned, collapsed: Array.isArray(value?.collapsed) ? value.collapsed.filter(x => typeof x === 'string').slice(0, 1000) : [], attachments: value?.attachments && typeof value.attachments==='object' ? value.attachments : {}, graphicsPanes: Object.fromEntries(Object.entries(value?.graphicsPanes||{}).filter(([,pane])=>pane?.version===1).map(([name])=>[name,{version:1}]))});
async function atomic(file, data, {valid}={}) {
 const directory=path.dirname(file),created=await fs.mkdir(directory, {recursive:true}),temp=file+'.'+randomUUID()+'.tmp';let handle,published=false;
 try {if(valid&&!valid())return false;handle=await fs.open(temp,'wx');await handle.writeFile(data);await handle.sync();await handle.close();handle=null;if(valid&&!valid())return false;await fs.rename(temp,file);published=true;await require('./snapshot-store.cjs').syncHierarchy(created||directory,directory);}
 catch(error){if(published)error.notemindFileCommitted=true;throw error;}
 finally {await handle?.close();await fs.unlink(temp).catch(() => {});}
}
async function atomicEncoded(file,bytes){try{return await atomic(file,bytes);}finally{require('./archive-input-ownership.cjs').discardPrivateArchiveBytes(bytes);}}
async function atomicArchive(file,doc,options){
 if(typeof archiveCodec.encodeFile!=='function')return atomicEncoded(file,await archiveCodec.encode(doc,options));
 const expected=await require('./source-file-revision.cjs').sourceFileRevision(file),prepared=await require('./prepared-archive-file.cjs').prepareArchiveFile(file,doc,options);let committed=false,failure;
 try{const receipt=await require('./prepared-archive-file.cjs').publishPreparedArchive(file,prepared,expected);committed=receipt.committed;if(receipt.warnings.length)throw Object.assign(Error(receipt.warnings.join('; ')),{notemindFileCommitted:true});}
 catch(error){failure=error;throw error;}
 finally{try{await prepared.cleanup();}catch(error){if(failure)failure.archiveCleanupError=error.message;else{if(committed)error.notemindFileCommitted=true;throw error;}}}
}
class NotesStore {
 constructor(root, recoveryRoot = path.join(root, 'recovery')) { this.root = root; this.recoveryRoot = recoveryRoot; this.pending = Promise.resolve(); this.snapshotObjects = new Map(); this.versionPending = new Map(); }
 async readIndexState() { try {const encoded=await fs.readFile(path.join(this.root,'index.json')),index=await archiveCodec.parseJson(encoded);if(!index||typeof index!=='object'||Array.isArray(index)||!index.records||typeof index.records!=='object'||Array.isArray(index.records))throw Error('The Notepad library index is damaged.');Object.setPrototypeOf(index.records,null);return {index,encoded};}catch(e){if(e.code!=='ENOENT')throw e;return {index:{records:Object.create(null),smartFolders:[],deleted:[],sort:'manual'},encoded:null};} }
 async readIndex() { return (await this.readIndexState()).index; }
 async transaction(fn,{valid}={}) {
  const run = () => require('./native-file-lock.cjs').runWithNativeLock(path.join(this.root,'index.json'),async () => {
   await fs.mkdir(this.root, {recursive:true});const lock=path.join(this.root,'.lock'),candidate=lock+'-'+randomUUID();let acquired=false,ownerStat;
   // Publish a complete owner record atomically, including if the app exits during acquisition.
   await fs.writeFile(candidate,JSON.stringify({pid:process.pid}),{flag:'wx'});
   try{
    ownerStat=await fs.stat(candidate);
    for(let n=0;n<250;n++)try{await fs.link(candidate,lock);acquired=true;break;}catch(error){
     if(error.code!=='EEXIST')throw error;const stat=await fs.stat(lock).catch(()=>null);let alive=true;
     try{const owner=JSON.parse(await fs.readFile(lock,'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('Invalid owner');try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}}
     catch{if(stat&&Date.now()-stat.mtimeMs>1000)alive=false;}
     if(stat&&!alive){const current=await fs.stat(lock).catch(()=>null);if(current&&current.ino===stat.ino&&current.dev===stat.dev)await fs.unlink(lock).catch(()=>{});}await new Promise(resolve=>setTimeout(resolve,40));
    }
    if(!acquired)throw Error('The Notepad library is busy. Try again.');
    const {index,encoded}=await this.readIndexState();if(valid&&!valid())return false;const result=await fn(index);if(valid&&!valid())return false;const next=await archiveCodec.stringifyJson(index);if(valid&&!valid())return false;if(encoded===null||!encoded.equals(next)){if(await atomic(path.join(this.root,'index.json'),next,{valid})===false)return false;}return result;
   }finally{await fs.unlink(candidate).catch(()=>{});if(acquired){const current=await fs.stat(lock).catch(()=>null);if(current&&current.ino===ownerStat?.ino&&current.dev===ownerStat?.dev)await fs.unlink(lock).catch(()=>{});}}
  },{maxWaitMs:10000});
  const result = this.pending.catch(()=>{}).then(run); this.pending=result; return result;
 }
 async registerInIndex(index, doc, options={}) {
   const existing = doc.path && Object.values(index.records).find(r=>r.path && keyPath(r.path)===keyPath(doc.path));
   let id=existing?.id || doc.id || randomUUID();
   if(!/^[\w-]{1,80}$/.test(id)) id=randomUUID();
   const other=index.records[id];
   if(other?.deleted){
    if(doc.path&&!existing&&options.adoptDraft!==true)id=randomUUID();
    else throw Error('This Notepad is in Recently Deleted. Restore it before editing.');
   }else if(other&&doc.path&&!other.path&&options.adoptDraft!==true)id=randomUUID();
   else if(other?.path && doc.path && keyPath(other.path)!==keyPath(doc.path) && await fs.stat(other.path).catch(()=>null)) id=randomUUID();
   const previous=index.records[id] || {}, now=new Date().toISOString();
   const meta=metadata(options.meta ?? doc.meta ?? previous.meta),title=doc.title || await resolveTitleOf(doc.text);
   const entry={...previous, id, path:doc.path || null, title, text:doc.text, meta, created:previous.created || doc.created || now, modified:options.modified || (previous.text===doc.text && previous.title===title && JSON.stringify(previous.meta)===JSON.stringify(meta) ? previous.modified || now : now), attachments:Object.keys(doc.assets || {}).filter(n=>!n.endsWith('.json'))};
   if(!doc.path)entry.recoveryRoot=this.recoveryRoot;index.records[id]=entry;
   return {...doc, id, title:entry.title, meta, created:entry.created};
 }
 async register(doc, options={}) { return this.transaction(index=>this.registerInIndex(index,doc,options)); }
 async list(filter={}) {
  const index=await this.readIndex(); let list=Object.values(index.records).filter(r=>!r.deleted);
  if(filter.paths) list=list.filter(r=>!r.path || filter.paths.some(p=>keyPath(r.path)===keyPath(p) || keyPath(r.path).startsWith(keyPath(p)+path.sep)));
  const rule=filter.smartId ? index.smartFolders.find(f=>f.id===filter.smartId) || {} : filter;
  if(rule.pinned) list=list.filter(r=>r.meta?.pinned);
  if(rule.tags?.length) list=list.filter(r=>rule.tags.every(t=>r.meta?.tags.some(v=>v.toLowerCase()===t.toLowerCase())));
  if(rule.attachments) list=list.filter(r=>r.attachments?.length);
  if(rule.days) list=list.filter(r=>Date.parse(r.modified)>=Date.now()-Number(rule.days)*86400000);
  if(rule.checklists) list=list.filter(r=>/^\s*[-*+]\s+\[[ x]\]/im.test(r.text));
  const query=String(filter.query || rule.query || '').trim().toLowerCase();
  if(query) list=list.flatMap(r=>{const text=[r.title,r.text,(r.meta?.tags || []).join(' '),r.imageText || ''].join('\n'),at=text.toLowerCase().indexOf(query);return at<0 ? [] : [{...r,excerpt:text.slice(Math.max(0,at-55),at+query.length+100).replace(/\s+/g,' ')}];});
  const sort=filter.sort || index.sort;
  list.sort((a,b)=>Number(!!b.meta?.pinned)-Number(!!a.meta?.pinned) || (sort==='title'?a.title.localeCompare(b.title):sort==='created'?b.created.localeCompare(a.created):b.modified.localeCompare(a.modified)));
  return list.map(({text,imageText,...r})=>r);
 }
 async settings(patch) { return this.transaction(index=>{if(patch?.sort && ['manual','title','modified','created'].includes(patch.sort)) index.sort=patch.sort; if(patch?.folder){const f=patch.folder;if(typeof f.name!=='string'||!f.name.trim()) throw Error('Give the smart folder a name.'); const entry={id:f.id || randomUUID(),name:f.name.trim().slice(0,80),tags:metadata({tags:f.tags}).tags,query:String(f.query || '').slice(0,200),pinned:!!f.pinned,attachments:!!f.attachments,checklists:!!f.checklists,days:[0,1,7,30,90].includes(+f.days)?+f.days:0};index.smartFolders=index.smartFolders.filter(x=>x.id!==entry.id).concat(entry);} if(patch?.remove) index.smartFolders=index.smartFolders.filter(f=>f.id!==patch.remove); return {sort:index.sort,smartFolders:index.smartFolders};}); }
 async patch(id, meta) { return this.transaction(index=>{const r=index.records[id]; if(!r)throw Error('This Notepad is no longer in the library.'); r.meta=metadata({...r.meta,...meta});return r;}); }
 async record(id) { const r=(await this.readIndex()).records[id]; if(!r || r.deleted) throw Error('This Notepad could not be found. Restore it from Recently Deleted if needed.'); return r; }
 async rename(from,to) { return this.transaction(index=>{for(const r of Object.values(index.records)){if(r.path && (keyPath(r.path)===keyPath(from)||keyPath(r.path).startsWith(keyPath(from)+path.sep))) r.path=to+r.path.slice(from.length);}}); }
 async preflightDraft(doc,{signal}={}) {
  const check=()=>{if(signal?.aborted)throw Object.assign(Error('Import validation cancelled.'),{name:'AbortError'});};check();
  const index=await this.readIndex(),projected={...index,records:Object.assign(Object.create(null),index.records)},registered=await this.registerInIndex(projected,doc,{meta:doc.meta});check();
  const state={recoveryId:'00000000-0000-0000-0000-000000000000',path:registered.path,visual:doc.visual!==false,dirty:!!doc.dirty,revision:doc.revision,initialFolder:doc.initialFolder,manualTitle:!!doc.manualTitle},canonical=await require('./markdown-files.cjs').canonicalAsync(registered);check();
  const result=await archiveCodec.validateNotepad(canonical,{extra:{'recovery.json':state},signal});check();return result;
 }
 async draft(doc) { return this.transaction(async index=>{const registered=await this.registerInIndex(index,doc,{meta:doc.meta,adoptDraft:true}),state={recoveryId:randomUUID(),path:registered.path,visual:doc.visual!==false,dirty:!!doc.dirty,revision:doc.revision,initialFolder:doc.initialFolder,manualTitle:!!doc.manualTitle}; await atomicArchive(path.join(this.recoveryRoot, registered.id+'.wm'), await require('./markdown-files.cjs').canonicalAsync(registered),{extra:{'recovery.json':state}}); await atomic(path.join(this.recoveryRoot, registered.id+'.json'),JSON.stringify(state));index.records[registered.id].recoveryRoot=this.recoveryRoot;return {...registered,recoveryId:state.recoveryId};}); }
 async recordCommitIntent(doc,file,revision) {
  if(!doc||typeof doc.id!=='string'||!/^[\w-]{1,80}$/.test(doc.id)||typeof file!=='string'||!path.isAbsolute(file)||typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw Error('Invalid document commit intent.');
  const id=doc.id,stateFile=path.join(this.recoveryRoot,id+'.json'),archive=path.join(this.recoveryRoot,id+'.wm');let needsDraft=!doc.recoveryId,expectedRecoveryId=doc.recoveryId;
  try{const state=JSON.parse(await fs.readFile(stateFile,'utf8'));if(expectedRecoveryId&&state.recoveryId!==expectedRecoveryId)throw Error('The recovery draft changed before its file could be committed.');needsDraft ||= typeof state.recoveryId!=='string';await fs.access(archive);}
  catch(error){if(error.code==='ENOENT')needsDraft=true;else throw error;}
  // Do not recursively acquire the library transaction. Legacy/missing recovery is upgraded before the short receipt write.
  if(needsDraft)expectedRecoveryId=(await this.draft({...doc,path:file,dirty:true})).recoveryId;
  return this.transaction(async index=>{
   const record=index.records[id];if(!record||record.deleted||!record.path||keyPath(record.path)!==keyPath(file))throw Error('The Notepad changed before its file could be committed.');
   await fs.access(archive);const state=JSON.parse(await fs.readFile(stateFile,'utf8'));if(typeof state.recoveryId!=='string'||state.recoveryId!==expectedRecoveryId)throw Error('The recovery state changed before its file could be committed.');
   const pendingCommit={path:file,revision};await atomic(stateFile,JSON.stringify({...state,pendingCommit}));return {...pendingCommit,recoveryId:expectedRecoveryId};
  });
 }
 async recoveryState(id) {
  if(!/^[\w-]{1,80}$/.test(id))throw Error('Invalid Notepad identity.');const record=(await this.readIndex()).records[id];if(record?.deleted)throw Error('This Notepad is in Recently Deleted. Restore it before opening.');
  let folder=this.recoveryRoot;try{await fs.access(path.join(folder,id+'.wm'));}catch{folder=record?.recoveryRoot||folder;}
  const file=path.join(folder,id+'.wm');
  for(let attempt=0;attempt<3;attempt++)try{
   const probe=await archiveCodec.readRecoveryState(file);let state=probe.state||{};if(probe.state&&(!state||typeof state!=='object'||Array.isArray(state)||typeof state.recoveryId!=='string'))throw Error('Invalid recovery metadata.');
   try{const companion=JSON.parse((await require('./read-limited.cjs').readLimited(path.join(folder,id+'.json'),1024*1024,'Recovery metadata is too large.')).toString('utf8'));if(!probe.state||companion.recoveryId===state.recoveryId)state={...state,...companion};}catch{}
   const current=await fs.stat(file,{bigint:true});if(!probe.sourceIdentity||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>String(current[key])!==String(probe.sourceIdentity[key])))continue;
   const result={...state,id,path:record?.path??state.path,dirty:!!state.dirty},receipt=state.pendingCommit;
   if(receipt?.path&&result.path&&keyPath(receipt.path)===keyPath(result.path)&&/^[a-f0-9]{64}$/.test(receipt.revision)){
    try{const committed=await require('./source-file-revision.cjs').sourceFileRevision(receipt.path);if(committed?.sha256===receipt.revision)return {...result,dirty:false};}catch{}
   }
   return result;
  }catch(error){if(error.code==='ENOENT')return null;return {id,path:record?.path,dirty:true,unknown:true};}
  return {id,path:record?.path,dirty:true,unknown:true};
 }
 async loadDraft(id) { if(!/^[\w-]{1,80}$/.test(id))throw Error('Invalid Notepad identity.');const record=(await this.readIndex()).records[id];if(record?.deleted)throw Error('This Notepad is in Recently Deleted. Restore it before opening.');let folder=this.recoveryRoot;try{await fs.access(path.join(folder,id+'.wm'));}catch{folder=record?.recoveryRoot||folder;}let parsed;if(typeof archiveCodec.inspectFile==='function')parsed=(await archiveCodec.inspectFile(path.join(folder,id+'.wm'),{files:'metadata'})).doc;else{const input=await fs.readFile(path.join(folder,id+'.wm'));parsed=await archiveCodec.decodeOwned(input.byteOffset===0&&input.byteLength===input.buffer.byteLength?input:Uint8Array.from(input),{files:'metadata'});} const {files,kind,...doc}=parsed; let state={};if(files['recovery.json']){state=JSON.parse(files['recovery.json'].toString('utf8'));if(!state||typeof state!=='object'||typeof state.recoveryId!=='string')throw Error('Invalid recovered Notepad state.');}try{const companion=JSON.parse((await require('./read-limited.cjs').readLimited(path.join(folder,id+'.json'),1024*1024,'Recovery metadata is too large.')).toString('utf8'));if(!files['recovery.json']||companion.recoveryId===state.recoveryId)state={...state,...companion};}catch{} const recovered={...doc,...state,id,...(record?{path:record.path}:{} )},receipt=state.pendingCommit;
  if(receipt?.path&&recovered.path&&keyPath(receipt.path)===keyPath(recovered.path)&&/^[a-f0-9]{64}$/.test(receipt.revision)){
   try{const committed=await archiveCodec.readCommitted(receipt.path,receipt.revision);if(committed){const clean={...recovered,...committed,id,path:recovered.path,revision:receipt.revision,dirty:false};delete clean.pendingCommit;return clean;}}catch{}
  }
  return recovered; }
 async session(value) { if(value) {if(!Array.isArray(value.tabs)||value.tabs.length>500)throw Error('Too many open Notepads.');await atomic(path.join(this.recoveryRoot,'session.json'),JSON.stringify(value));return;}try{return JSON.parse(await fs.readFile(path.join(this.recoveryRoot,'session.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e;} }
 async recover() { const session=await this.session();if(!session)return null; const index=await this.readIndex(),tabs=[];for(const t of session.tabs){if(index.records[t.id]?.deleted)continue;try{tabs.push({...await this.loadDraft(t.id),visual:t.visual,scroll:t.scroll})}catch(e){tabs.push({recoveryError:e.message,id:t.id,path:t.path})}}return {...session,tabs}; }
 async deleteDraft(id) {return this.transaction(async index=>{const record=index.records[id];if(!record||record.deleted)throw Error('This draft is no longer available.');if(record.path)throw Error('Use Move to Trash for a saved Notepad.');const item={id:randomUUID(),kind:'draft',noteId:id,path:null,name:record.title,deletedAt:new Date().toISOString(),recoveryRoot:record.recoveryRoot||this.recoveryRoot};item.saved=path.join(this.root,'deleted',item.id);await fs.mkdir(item.saved,{recursive:true});for(const ext of ['.wm','.json'])await fs.copyFile(path.join(item.recoveryRoot,id+ext),path.join(item.saved,id+ext));index.deleted.push(item);record.deleted=item.id;return item.id;});}
 async version(doc, label='Saved') {
  if(!doc.id)return;const captured={...doc,assets:{...(doc.assets||{})},meta:structuredClone(doc.meta||{})};let canonical;
  return this.queueVersion(doc.id,label,async options=>{canonical ||=await require('./markdown-files.cjs').canonicalAsync(captured);return archiveCodec.publishVersion(canonical,options);});
 }
 async versionFromFile(file,doc,expectedRevision,label='Before save') {
  if(!doc?.id)return;
  const noteId=doc.id,titleFallback=doc.title||'',expected=structuredClone(expectedRevision);
  const publish=path.extname(file).toLowerCase()==='.md'?'publishMarkdownVersionFromFile':'publishVersionFromFile';
  return this.queueVersion(noteId,label,options=>archiveCodec[publish](file,{...options,noteId,titleFallback,expectedRevision:expected}));
 }
 async queueVersion(noteId,label,publishVersion) {
  // Keep calls for one note ordered, without holding the whole-library lock during hashing and asset I/O.
  const run=async()=>{
   const record=(await this.readIndex()).records[noteId];if(!record)return;const last=(record.versions||[]).at(-1);
   if(last?.storage==='snapshot-v1'&&last.objectCount&&this.snapshotObjects.size===0){
    // This is an optimization hint only; publication still validates objects before committing a reference.
    try{const info=await archiveCodec.readSnapshot(this.root,last.id,{referencesOnly:true});for(const hash of info.knownHashes){this.snapshotObjects.set(hash,null);while(this.snapshotObjects.size>2048)this.snapshotObjects.delete(this.snapshotObjects.keys().next().value);}}catch{}
   }
   const id=randomUUID(),publish=options=>publishVersion({root:this.root,id,knownHashes:[...this.snapshotObjects.keys()],...options});let prepared=await publish({previousHash:last?.hash||null,existingVersionId:last?.storage==='snapshot-v1'?last.id:undefined}),verifiedLegacyID=null;
   if(prepared.unchanged&&prepared.legacyHash&&!last?.storage){
    let sameMetadata=false;try{const old=await archiveCodec.decode(await fs.readFile(path.join(this.root,'versions',last.id+'.wm')),{files:false}),current=prepared.documentMetadata;sameMetadata=(old.title||'')===current.title&&(old.id??null)===(current.id??null)&&(old.created??null)===(current.created??null);}catch{}
    if(sameMetadata)verifiedLegacyID=last.id;else prepared=await publish({});
   }
   const matches=entry=>entry&&(entry.hash===prepared.contentHash||(verifiedLegacyID===entry.id&&prepared.legacyHash&&entry.hash===prepared.legacyHash));
   if(prepared.unchanged){
    const needed=await this.transaction(index=>{const current=index.records[noteId];return !!current&&!matches((current.versions||[]).at(-1));});
    if(!needed)return;const legacyHash=prepared.legacyHash;prepared=await publish({});prepared.legacyHash=legacyHash;
   }
   for(const hash of prepared.objectHashes){this.snapshotObjects.set(hash,null);while(this.snapshotObjects.size>2048)this.snapshotObjects.delete(this.snapshotObjects.keys().next().value);}
   return this.transaction(index=>{const r=index.records[noteId];if(!r)return;const history=r.versions||[];if(matches(history.at(-1)))return;const created=new Date().toISOString();r.versions=history.concat({id,created,label,hash:prepared.contentHash,storage:'snapshot-v1',objectCount:prepared.objectCount});return id;});
  };
  const next=(this.versionPending.get(noteId)||Promise.resolve()).catch(()=>{}).then(run);this.versionPending.set(noteId,next);
  try{return await next;}finally{if(this.versionPending.get(noteId)===next)this.versionPending.delete(noteId);}
 }
 async versions(id) { return (await this.readIndex()).records[id]?.versions || []; }
 async versionDoc(id, version) {const entry=(await this.versions(id)).find(v=>v.id===version);if(!entry)throw Error('This version is unavailable.');if(entry.storage==='snapshot-v1')return archiveCodec.readSnapshot(this.root,version);if(entry.storage)throw Error('This version format is not supported.');if(!/^[\w-]{1,80}$/.test(version))throw Error('Invalid version identity.');const {files,kind,...doc}=await archiveCodec.decode(await fs.readFile(path.join(this.root,'versions',version+'.wm')),{files:false});return doc;}
 async indexText(id, values, {valid}={}) { return this.transaction(index=>{const r=index.records[id];if(!r||r.deleted)return false;r.imageText=Object.values(values).map(x=>x.text || '').join('\n');r.ocr=values;return true;},{valid}); }
 async ocrCache(id) { return (await this.readIndex()).records[id]?.ocr || {}; }
 async captureDeleted(source) { const id=randomUUID(),saved=path.join(this.root,'deleted',id);await fs.mkdir(path.dirname(saved),{recursive:true});await require('./markdown-files.cjs').capture(source,saved);return {id,path:source,name:path.basename(source),deletedAt:new Date().toISOString(),saved}; }
 async finishDeleted(item) {return this.transaction(index=>{index.deleted.push(item);for(const r of Object.values(index.records))if(r.path && (keyPath(r.path)===keyPath(item.path)||keyPath(r.path).startsWith(keyPath(item.path)+path.sep)))r.deleted=item.id;});}
 async deleted() {return (await this.readIndex()).deleted.map(({saved,...r})=>r);}
 async restoreDeleted(id, alternate) {return this.transaction(async index=>{
  const item=index.deleted.find(x=>x.id===id);if(!item)throw Error('This deleted item is unavailable.');
  if(item.kind==='draft'){
   if(alternate)throw Error('Restore this draft, then use Save As to choose a file.');
   await fs.mkdir(item.recoveryRoot,{recursive:true});
   for(const ext of ['.wm','.json'])await fs.copyFile(path.join(item.saved,item.noteId+ext),path.join(item.recoveryRoot,item.noteId+ext));
   delete index.records[item.noteId].deleted;index.deleted=index.deleted.filter(x=>x.id!==id);return {draft:item.noteId};
  }
  const target=alternate || item.path;try{await fs.lstat(target);throw Error('An item already exists at '+target);}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.mkdir(path.dirname(target),{recursive:true});await require('./markdown-files.cjs').restore(item.saved,target);index.deleted=index.deleted.filter(x=>x.id!==id);
  for(const r of Object.values(index.records))if(r.deleted===id){
   delete r.deleted;if(alternate)r.path=target+r.path.slice(item.path.length);let revision;
   for(const folder of new Set([this.recoveryRoot,r.recoveryRoot].filter(Boolean))){
    const file=path.join(folder,r.id+'.json');let state;try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)continue;throw error;}
    revision??=digest(await fs.readFile(r.path));await atomic(file,JSON.stringify({...state,path:r.path,revision}));
   }
  }return target;
 });}
 async reconcileDeleted(restored) {return this.transaction(async index=>{for(const item of [...index.deleted])if(item.path&&restored&&keyPath(item.path)===keyPath(restored)){index.deleted=index.deleted.filter(x=>x.id!==item.id);for(const r of Object.values(index.records))if(r.deleted===item.id)delete r.deleted;}});}
}
module.exports={NotesStore,titleOf,resolveTitleOf,metadata,atomic,digest};
