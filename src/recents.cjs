const fs=require('node:fs/promises'),path=require('node:path');
const LIMIT=12;
const folded=file=>process.platform==='win32'||process.platform==='darwin'?path.resolve(file).toLowerCase():path.resolve(file);
const same=(a,b)=>folded(a)===folded(b);
const rows=list=>(Array.isArray(list)?list:[]).filter(x=>x&&typeof x.path==='string').map(x=>({path:x.path,at:Number(x.at)||0}));
// Recent files and recent projects, most recent first, twelve of each: `{version:1, files:[{path,at}], projects:[…]}`.
// An older list (one array of `{path,name,kind}`) is read once and split.
function recents(file){
 let serial=Promise.resolve();const listeners=[];
 const read=async()=>{
  try{
   const value=JSON.parse(await fs.readFile(file,'utf8'));
   if(Array.isArray(value))return {version:1,files:rows(value.filter(x=>x?.kind!=='project')).slice(0,LIMIT),projects:rows(value.filter(x=>x?.kind==='project')).slice(0,LIMIT)};
   return {version:1,files:rows(value.files).slice(0,LIMIT),projects:rows(value.projects).slice(0,LIMIT)};
  }catch{return {version:1,files:[],projects:[]};}
 };
 const update=fn=>{serial=serial.catch(()=>{}).then(async()=>{const next=fn(await read()),temp=file+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(temp,JSON.stringify(next));await fs.rename(temp,file);for(const listener of listeners)listener(next);return next;});return serial;};
 const key=kind=>kind==='project'?'projects':'files';
 const remember=(target,kind='file')=>update(all=>{const k=key(kind);all[k]=[{path:target,at:Date.now()},...all[k].filter(x=>!same(x.path,target))].slice(0,LIMIT);return all;});
 const forget=target=>update(all=>({...all,files:all.files.filter(x=>!same(x.path,target)),projects:all.projects.filter(x=>!same(x.path,target))}));
 // A file or project that was renamed or moved keeps its place in the list.
 const moved=(from,to)=>update(all=>{const follow=list=>list.map(x=>same(x.path,from)?{...x,path:to}:x);return {...all,files:follow(all.files),projects:follow(all.projects)};});
 const clear=()=>update(()=>({version:1,files:[],projects:[]}));
 return {read,remember,forget,moved,clear,onChange:fn=>listeners.push(fn),LIMIT};
}
module.exports=recents;
