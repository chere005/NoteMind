const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {keyPath}=require('./path-key.cjs');
const LIMIT=12;
const same=(a,b)=>keyPath(a)===keyPath(b);
const rows=list=>(Array.isArray(list)?list:[]).filter(x=>x&&typeof x.path==='string').map(x=>({path:x.path,at:Number(x.at)||0}));
// Recent files and recent projects, most recent first, twelve of each: `{version:1, files:[{path,at}], projects:[…]}`.
// An older list (one array of `{path,name,kind}`) is read once and split.
function recents(file){
 let serial=Promise.resolve();const listeners=[];
 const lock=file+'.lock';
 async function acquire(){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const candidate=lock+'-'+randomUUID();await fs.writeFile(candidate,JSON.stringify({pid:process.pid}),{flag:'wx'});
  try{
   for(let attempt=0;attempt<250;attempt++){
    try{await fs.link(candidate,lock);return async()=>{await fs.unlink(lock).catch(()=>{});};}catch(error){if(error.code!=='EEXIST')throw error;}
    const before=await fs.stat(lock).catch(()=>null);let abandoned=false;
    try{const owner=JSON.parse(await fs.readFile(lock,'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<=0)abandoned=true;else try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')abandoned=true;}}
    catch{abandoned=!!before&&Date.now()-before.mtimeMs>1000;}
    if(abandoned&&before){const current=await fs.stat(lock).catch(()=>null);if(current&&current.ino===before.ino&&current.dev===before.dev)await fs.unlink(lock).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   throw Error('Recent files are busy. Try again.');
  }finally{await fs.unlink(candidate).catch(()=>{});}
 }
 const read=async()=>{
  try{
   const value=JSON.parse(await fs.readFile(file,'utf8'));
   if(Array.isArray(value))return {version:1,files:rows(value.filter(x=>x?.kind!=='project')).slice(0,LIMIT),projects:rows(value.filter(x=>x?.kind==='project')).slice(0,LIMIT)};
   return {version:1,files:rows(value.files).slice(0,LIMIT),projects:rows(value.projects).slice(0,LIMIT)};
  }catch{return {version:1,files:[],projects:[]};}
 };
 const update=fn=>{serial=serial.catch(()=>{}).then(async()=>{const release=await acquire();let next;try{next=fn(await read());const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(next),{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}finally{await release();}for(const listener of listeners)try{listener(next);}catch{}return next;});return serial;};
 const key=kind=>kind==='project'?'projects':'files';
 const remember=(target,kind='file')=>update(all=>{const k=key(kind);all[k]=[{path:target,at:Date.now()},...all[k].filter(x=>!same(x.path,target))].slice(0,LIMIT);return all;});
 const forget=target=>update(all=>({...all,files:all.files.filter(x=>!same(x.path,target)),projects:all.projects.filter(x=>!same(x.path,target))}));
 // A file or project that was renamed or moved keeps its place in the list.
 const moved=(from,to)=>update(all=>{const follow=list=>list.map(x=>same(x.path,from)?{...x,path:to}:x);return {...all,files:follow(all.files),projects:follow(all.projects)};});
 const clear=()=>update(()=>({version:1,files:[],projects:[]}));
 return {read,remember,forget,moved,clear,onChange:fn=>listeners.push(fn),LIMIT};
}
module.exports=recents;
