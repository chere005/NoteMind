// Read-only diagnostic instrumentation. It never imports a runtime or loads a binding.
const fs=require('node:fs'),Module=require('node:module');
function installImportAttribution(){
 const originals={readFileSync:fs.readFileSync,openSync:fs.openSync,readSync:fs.readSync,closeSync:fs.closeSync,nodeExtension:Module._extensions['.node']},fds=new Map(),loads=[],wholeReads=[],bindings=[],totals={wholeReadCalls:0,wholeReadBytes:0,maxWholeReadBytes:0,streamReadCalls:0,streamReadBytes:0,maxStreamReadBytes:0},load=Module._load;
 fs.readFileSync=function(file,...args){const value=originals.readFileSync.call(this,file,...args),bytes=typeof value==='string'?Buffer.byteLength(value):value.byteLength;totals.wholeReadCalls++;totals.wholeReadBytes+=bytes;totals.maxWholeReadBytes=Math.max(totals.maxWholeReadBytes,bytes);if(wholeReads.length<512)wholeReads.push({file:String(file),bytes});return value;};
 fs.openSync=function(file,...args){const fd=originals.openSync.call(this,file,...args);fds.set(fd,String(file));return fd;};
 fs.readSync=function(fd,...args){const count=originals.readSync.call(this,fd,...args);totals.streamReadCalls++;totals.streamReadBytes+=count;totals.maxStreamReadBytes=Math.max(totals.maxStreamReadBytes,count);return count;};
 fs.closeSync=function(fd,...args){try{return originals.closeSync.call(this,fd,...args);}finally{fds.delete(fd);}};
 Module._load=function(name,parent,isMain){if(loads.length<4096)loads.push({name,parent:parent?.filename||null});return load.call(this,name,parent,isMain);};
 Module._extensions['.node']=function(_module,file){bindings.push(file);throw Error('Native binding load is forbidden in this parent import diagnostic: '+file);};
 let restored=false;return{snapshot(){return{totals:{...totals},wholeReads:wholeReads.map(row=>({...row})),loads:loads.map(row=>({...row})),bindingAttempts:[...bindings],openDescriptors:fds.size};},restore(){if(restored)return;restored=true;Object.assign(fs,{readFileSync:originals.readFileSync,openSync:originals.openSync,readSync:originals.readSync,closeSync:originals.closeSync});Module._load=load;Module._extensions['.node']=originals.nodeExtension;}};
}
module.exports={installImportAttribution};
