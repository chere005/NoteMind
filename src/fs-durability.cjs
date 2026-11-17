// Node/libuv's Windows fsync uses FlushFileBuffers, which requires GENERIC_WRITE;
// fs.open(path,'r') supplies only FILE_GENERIC_READ (libuv v1.52.1 src/win/fs.c).
// Directory flushing has no portable Node Windows contract. Skip that capability
// explicitly; never suppress a real POSIX open/sync/close failure.
const fs=require('node:fs/promises');
const unsupported=Object.freeze({synced:false,unsupported:true,capability:'directory-and-read-only-fsync'}),synced=Object.freeze({synced:true,unsupported:false});
async function syncDirectory(directory,{platform=process.platform,io=fs}={}){
 if(platform==='win32'){if(!(await io.stat(directory)).isDirectory())throw Error('Durability path is not a directory.');return unsupported;}
 const handle=await io.open(directory,'r');try{if(!(await handle.stat()).isDirectory())throw Error('Durability path is not a directory.');await handle.sync();return synced;}finally{await handle.close();}
}
async function syncReadOnlyHandle(handle,{platform=process.platform}={}){if(platform==='win32')return unsupported;await handle.sync();return synced;}
module.exports={syncDirectory,syncReadOnlyHandle};
