const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
// A PDF import opens the existing bounded reference source; it never rasterizes
// every page before the user can choose or cancel.
async function pdfImportRequest(file,{mode='both',language='auto',password,signal}={}){
 if(path.extname(file).toLowerCase()!=='.pdf')return null;
 signal?.throwIfAborted();if(!['both','text','images'].includes(mode))throw Error('Choose pictures, text, or both for PDF import.');
 const stat=await fs.stat(file);signal?.throwIfAborted();if(!stat.isFile()||stat.size<1||stat.size>150*1024*1024)throw Error('Import PDFs up to150MB.');
 return{pdfImport:{id:randomUUID(),path:file,title:path.basename(file,path.extname(file)),mode,language:language==='en'?'en':'auto',...(typeof password==='string'&&password?{password}:{})}};
}
module.exports={pdfImportRequest};
