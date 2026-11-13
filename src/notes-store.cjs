const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const format = require('./notepad-format.cjs');
const digest = data => createHash('sha256').update(data).digest('hex');
const keyPath = p => path.resolve(p).toLowerCase();
const titleOf = text => String(text || '').split(/\r?\n/).map(s => s.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ x]\]\s*)?)/i, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[*_`=]/g, '').trim()).find(Boolean)?.slice(0, 100) || 'Untitled';
const metadata = value => ({tags: [...new Set((Array.isArray(value?.tags) ? value.tags : []).map(t => String(t).trim().replace(/^#/, '').slice(0, 60)).filter(Boolean))].slice(0, 100), pinned: !!value?.pinned, collapsed: Array.isArray(value?.collapsed) ? value.collapsed.filter(x => typeof x === 'string').slice(0, 1000) : [], attachments: value?.attachments && typeof value.attachments==='object' ? value.attachments : {}, graphicsPanes: Object.fromEntries(Object.entries(value?.graphicsPanes||{}).filter(([,pane])=>pane?.version===1).map(([name])=>[name,{version:1}]))});
async function atomic(file, data) {
 await fs.mkdir(path.dirname(file), {recursive:true});
 const temp = file + '.' + randomUUID() + '.tmp';
 try { await fs.writeFile(temp, data, {flag:'wx'}); await fs.rename(temp, file); }
 finally { await fs.unlink(temp).catch(() => {}); }
}
class NotesStore {
 constructor(root, recoveryRoot = path.join(root, 'recovery')) { this.root = root; this.recoveryRoot = recoveryRoot; this.pending = Promise.resolve(); }
 async readIndex() { try { return JSON.parse(await fs.readFile(path.join(this.root, 'index.json'), 'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; return {records:{}, smartFolders:[], deleted:[], sort:'manual'}; } }
 async transaction(fn) {
  const run = async () => {
   await fs.mkdir(this.root, {recursive:true}); const lock = path.join(this.root, '.lock'); let handle;
   for(let n=0; n<250; n++) { try { handle = await fs.open(lock, 'wx');await handle.writeFile(JSON.stringify({pid:process.pid}));break; } catch(e) { if(e.code!=='EEXIST') throw e; const st=await fs.stat(lock).catch(()=>null);let alive=true;try{const owner=JSON.parse(await fs.readFile(lock,'utf8'));try{process.kill(owner.pid,0)}catch(error){if(error.code==='ESRCH')alive=false;}}catch{} if(st && (!alive||Date.now()-st.mtimeMs>120000)) await fs.unlink(lock).catch(()=>{}); await new Promise(r=>setTimeout(r,40)); } }
   if(!handle) throw Error('The Notepad library is busy. Try again.');
   try { const index = await this.readIndex(); const result = await fn(index); await atomic(path.join(this.root, 'index.json'), JSON.stringify(index)); return result; }
   finally { await handle.close(); await fs.unlink(lock).catch(()=>{}); }
  };
  const result = this.pending.catch(()=>{}).then(run); this.pending=result; return result;
 }
 async register(doc, options={}) {
  return this.transaction(async index => {
   const existing = doc.path && Object.values(index.records).find(r=>r.path && keyPath(r.path)===keyPath(doc.path));
   let id=existing?.id || doc.id || randomUUID();
   if(!/^[\w-]{1,80}$/.test(id)) id=randomUUID();
   const other=index.records[id];
   if(other?.path && doc.path && keyPath(other.path)!==keyPath(doc.path) && await fs.stat(other.path).catch(()=>null)) id=randomUUID();
   const previous=index.records[id] || {}, now=new Date().toISOString();
   const meta=metadata(options.meta || previous.meta || doc.meta);
   const entry={...previous, id, path:doc.path || null, title:doc.title || titleOf(doc.text), text:doc.text, meta, created:previous.created || doc.created || now, modified:options.modified || (previous.text===doc.text && JSON.stringify(previous.meta)===JSON.stringify(meta) ? previous.modified || now : now), attachments:Object.keys(doc.assets || {}).filter(n=>!n.endsWith('.json'))};
   if(!doc.path)entry.recoveryRoot=this.recoveryRoot;index.records[id]=entry;
   return {...doc, id, title:entry.title, meta, created:entry.created};
  });
 }
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
 async draft(doc) { const registered=await this.register(doc,{meta:doc.meta}); await atomic(path.join(this.recoveryRoot, registered.id+'.wm'), format.encode(require('./markdown-files.cjs').canonical(registered))); await atomic(path.join(this.recoveryRoot, registered.id+'.json'),JSON.stringify({path:registered.path,visual:doc.visual!==false,dirty:!!doc.dirty,revision:doc.revision,initialFolder:doc.initialFolder})); return registered; }
 async loadDraft(id) { if(!/^[\w-]{1,80}$/.test(id))throw Error('Invalid Notepad identity.'); let folder=this.recoveryRoot;try{await fs.access(path.join(folder,id+'.wm'));}catch{folder=(await this.readIndex()).records[id]?.recoveryRoot||folder;}const parsed=format.decode(await fs.readFile(path.join(folder,id+'.wm'))); const {files,kind,...doc}=parsed; let state={};try{state=JSON.parse(await fs.readFile(path.join(folder,id+'.json'),'utf8'))}catch{} return {...doc,...state,id}; }
 async session(value) { if(value) {if(!Array.isArray(value.tabs)||value.tabs.length>500)throw Error('Too many open Notepads.');await atomic(path.join(this.recoveryRoot,'session.json'),JSON.stringify(value));return;}try{return JSON.parse(await fs.readFile(path.join(this.recoveryRoot,'session.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e;} }
 async recover() { const session=await this.session();if(!session)return null; const tabs=[];for(const t of session.tabs){try{tabs.push({...await this.loadDraft(t.id),visual:t.visual,scroll:t.scroll})}catch(e){tabs.push({recoveryError:e.message,id:t.id,path:t.path})}}return {...session,tabs}; }
 async version(doc, label='Saved') { if(!doc.id) return; doc=require('./markdown-files.cjs').canonical(doc);const bytes=format.encode(doc),contentHash=digest(Buffer.from(JSON.stringify({text:doc.text,assets:doc.assets,meta:doc.meta}))); return this.transaction(async index=>{const r=index.records[doc.id];if(!r)return;const history=r.versions || [];if(history.at(-1)?.hash===contentHash)return;const id=randomUUID(),created=new Date().toISOString();await atomic(path.join(this.root,'versions',id+'.wm'),bytes);r.versions=history.concat({id,created,label,hash:contentHash});return id;}); }
 async versions(id) { return (await this.readIndex()).records[id]?.versions || []; }
 async versionDoc(id, version) {const list=await this.versions(id);if(!list.some(v=>v.id===version))throw Error('This version is unavailable.');const {files,kind,...doc}=format.decode(await fs.readFile(path.join(this.root,'versions',version+'.wm')));return doc;}
 async indexText(id, values) { return this.transaction(index=>{const r=index.records[id];if(r){r.imageText=Object.values(values).map(x=>x.text || '').join('\n');r.ocr=values;}}); }
 async ocrCache(id) { return (await this.readIndex()).records[id]?.ocr || {}; }
 async captureDeleted(source) { const id=randomUUID(),saved=path.join(this.root,'deleted',id);await fs.mkdir(path.dirname(saved),{recursive:true});await fs.cp(source,saved,{recursive:true,errorOnExist:true,force:false});return {id,path:source,name:path.basename(source),deletedAt:new Date().toISOString(),saved}; }
 async finishDeleted(item) {return this.transaction(index=>{index.deleted.push(item);for(const r of Object.values(index.records))if(r.path && (keyPath(r.path)===keyPath(item.path)||keyPath(r.path).startsWith(keyPath(item.path)+path.sep)))r.deleted=item.id;});}
 async deleted() {return (await this.readIndex()).deleted.map(({saved,...r})=>r);}
 async restoreDeleted(id, alternate) {return this.transaction(async index=>{const item=index.deleted.find(x=>x.id===id);if(!item)throw Error('This deleted item is unavailable.');const target=alternate || item.path;try{await fs.lstat(target);throw Error('An item already exists at '+target);}catch(e){if(e.code!=='ENOENT')throw e;}await fs.mkdir(path.dirname(target),{recursive:true});await fs.cp(item.saved,target,{recursive:true,force:false,errorOnExist:true});index.deleted=index.deleted.filter(x=>x.id!==id);for(const r of Object.values(index.records))if(r.deleted===id){delete r.deleted;if(alternate)r.path=target+r.path.slice(item.path.length);}return target;});}
 async reconcileDeleted(restored) {return this.transaction(async index=>{for(const item of [...index.deleted])if(restored&&keyPath(item.path)===keyPath(restored)){index.deleted=index.deleted.filter(x=>x.id!==item.id);for(const r of Object.values(index.records))if(r.deleted===item.id)delete r.deleted;}});}
}
module.exports={NotesStore,titleOf,metadata,atomic,digest};
