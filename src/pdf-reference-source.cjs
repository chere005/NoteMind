const fs=require('node:fs/promises'),raw=require('node:fs'),{createHash}=require('node:crypto');
const MAX=150*1024*1024;
async function inspectSource(store,file,{signal}={}){
 const resolved=await fs.realpath(file),stat=await fs.stat(resolved);if(!stat.isFile()||stat.size<1||stat.size>MAX)throw Error('Open PDFs up to 150 MB.');
 const hash=createHash('sha256');let bytes=0;for await(const chunk of raw.createReadStream(resolved,{signal,highWaterMark:196608})){bytes+=chunk.length;if(bytes>MAX)throw Error('Open PDFs up to 150 MB.');hash.update(chunk);}signal?.throwIfAborted();if(bytes!==stat.size)throw Error('The PDF changed while it was opened.');
 const sourceHash=hash.digest('hex'),original=await store.ensureOriginal(sourceHash,{sourcePath:resolved});signal?.throwIfAborted();return{file:resolved,sourceHash,size:bytes,sourceFile:{file:original,root:store.root,bytes,sha256:sourceHash}};
}
module.exports={inspectSource};
