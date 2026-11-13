// The project file: `<Name>.wmpr`, a small JSON file listing a project's files and folders.
// A project is a name (the file's own name; no key holds it) plus its files and folders. Paths are written relative to the
// project file's folder when they lie at or under it, absolute otherwise, and a reader takes both. Keys we do not know are kept.
const path=require('node:path');
const EXTENSION='.wmpr',VERSION=2,KNOWN=new Set(['version','folders','excluded','files']);
const isProjectName=name=>/\.wmpr$/i.test(name);
const isRecord=v=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const strings=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'):[];
// A path from the other kind of machine (a POSIX path on Windows, a drive or UNC path elsewhere) is kept exactly as written.
const foreignOn=platform=>p=>platform==='win32'?/^\//.test(p)&&!/^\/\//.test(p):/^[A-Za-z]:[\\/]/.test(p)||/^\\\\/.test(p);
const foldCase=platform=>platform==='win32'||platform==='darwin';
const rules=(platform=process.platform)=>({ops:platform==='win32'?path.win32:path.posix,foreign:foreignOn(platform),fold:foldCase(platform)});

// `{version, folders, excluded, files, extra}` of a project file's text, or null when it is not a JSON object.
function parse(text){
 let given;try{given=JSON.parse(text.charCodeAt(0)===0xfeff?text.slice(1):text);}catch{return null;}
 if(!isRecord(given))return null;
 const extra={};
 for(const [key,value] of Object.entries(given))if(!KNOWN.has(key))Object.defineProperty(extra,key,{value,enumerable:true,writable:true,configurable:true});
 const version=typeof given.version==='number'&&Number.isFinite(given.version)?given.version:1;
 return {version,folders:strings(given.folders),excluded:strings(given.excluded),files:strings(given.files),extra};
}
// Foundation's .prettyPrinted + .sortedKeys + .withoutEscapingSlashes, so a project in git keeps its shape across machines.
function print(value,depth){
 const inner='  '.repeat(depth+1),outer='  '.repeat(depth);
 if(Array.isArray(value))return value.length?`[\n${value.map(one=>inner+print(one,depth+1)).join(',\n')}\n${outer}]`:`[\n\n${outer}]`;
 if(isRecord(value)){const keys=Object.keys(value).sort();return keys.length?`{\n${keys.map(key=>`${inner}${JSON.stringify(key)} : ${print(value[key],depth+1)}`).join(',\n')}\n${outer}}`:`{\n\n${outer}}`;}
 return JSON.stringify(value)??'null';
}
// The file's text. `version` is written as it was read (never raised or lowered); a new project is version 2.
function stringify(data){return print({...data.extra,version:data.version??VERSION,folders:data.folders||[],excluded:data.excluded||[],files:data.files||[]},0);}

// The paths as the app uses them: absolute and tidy, a relative one resolved against the project file's folder.
function resolvePaths(list,file,platform=process.platform){
 const {ops,foreign,fold}=rules(platform),base=file?ops.dirname(ops.resolve(file)):null,seen=new Set(),out=[];
 for(const written of list){
  const full=foreign(written)?written:ops.isAbsolute(written)||base===null?ops.resolve(written):ops.resolve(base,written),key=fold?full.toLowerCase():full;
  if(seen.has(key))continue;seen.add(key);out.push(full);
 }
 return out;
}
// One path as the file writes it: relative and `/`-separated when at or under the project file's folder, else as it is.
function writtenPath(p,file,platform=process.platform){
 const {ops,foreign,fold}=rules(platform);
 if(!file||foreign(p)||!ops.isAbsolute(p))return p;
 const base=ops.dirname(ops.resolve(file)),relative=ops.relative(base,p);
 if(relative==='')return '.';
 if(relative.startsWith('..')||ops.isAbsolute(relative))return p;
 const a=ops.resolve(base,relative),b=ops.resolve(p);
 return (fold?a.toLowerCase()===b.toLowerCase():a===b)?relative.split(ops.sep).join('/'):p;
}
const projectName=file=>path.basename(file,path.extname(file));
// A NoteMind project value (`{id, name, folders, files, excluded, file, …}`) from a file's text.
function read(text,file,id,platform=process.platform){
 const data=parse(text);if(!data)throw Error('This file is not a project.');
 return {id,name:projectName(file),folders:resolvePaths(data.folders,file,platform),files:resolvePaths(data.files,file,platform),excluded:resolvePaths(data.excluded,file,platform),file,version:data.version,extra:data.extra,readOnly:data.version>VERSION};
}
// The text of a NoteMind project value, its paths written as the file rule says. A project with no file keeps absolute paths.
function write(project,platform=process.platform){
 const out=list=>(list||[]).map(p=>writtenPath(p,project.file,platform));
 return stringify({version:project.version??VERSION,folders:out(project.folders),excluded:out(project.excluded),files:out(project.files),extra:project.extra||{}});
}
module.exports={EXTENSION,VERSION,isProjectName,parse,stringify,resolvePaths,writtenPath,projectName,read,write};
