const fs=require('node:fs/promises');
async function sheetRevision(file){try{const s=await fs.stat(file);return {dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs};}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const sameSheetRevision=(a,b)=>a===null?b===null:!!b&&['dev','ino','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
module.exports={sheetRevision,sameSheetRevision};
