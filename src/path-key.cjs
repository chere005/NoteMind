const fs=require('node:fs'),path=require('node:path');

// Resolve existing spelling (and aliases), while retaining distinct names on case-sensitive volumes.
function physicalPath(file){
 const absolute=path.resolve(file);let resolved=absolute;
 try{resolved=fs.realpathSync.native(absolute);}catch{
  let parent=path.dirname(absolute),tail=[path.basename(absolute)];
  while(parent!==path.dirname(parent)){
   try{resolved=path.join(fs.realpathSync.native(parent),...tail);break;}
   catch{tail.unshift(path.basename(parent));parent=path.dirname(parent);}
  }
 }
 return resolved;
}
function keyPath(file,platform=process.platform){const resolved=physicalPath(file);return platform==='win32'?resolved.toLowerCase():resolved;}
module.exports={keyPath,physicalPath};
