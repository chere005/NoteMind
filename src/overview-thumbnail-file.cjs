const fs=require('node:fs/promises'),path=require('node:path'),{isRawAsset}=require('./document-asset-sessions.cjs'),{spoolImageInput,acquireImageWorking}=require('./word-export-media.cjs'),{createWordTemp,cleanupWordTemps,closeWordCleanup}=require('./word-temp.cjs');
async function thumbnail(doc,{storage,convertImageFile,directory,signal}={}){
 const names=Object.keys(doc?.assets||{});if(doc?.text!==''||names.length!==1||!/^assets\/.+\.svg$/i.test(names[0]))throw Error('Choose one SVG page background.');
 const check=()=>signal?.throwIfAborted();check();await fs.mkdir(directory,{recursive:true});await cleanupWordTemps(directory);check();let lease,working;
 try{
  lease=await createWordTemp(path.join(directory,'overview-source.svg'));const value=doc.assets[names[0]],source=await spoolImageInput(value,lease.temp,storage,signal,{handle:lease.handle});await lease.assert();await lease.handle.close();lease.handle=null;check();
  if(isRawAsset(value))await storage.unpinScopedRawAssets([value]);working=await acquireImageWorking(storage,signal,128*1024*1024);check();
  const converted=await convertImageFile(source.file,'image/svg+xml',{root:directory,bytes:source.bytes,sha256:source.sha256,signal,maxDimension:256,maxRSSBytes:384*1024*1024,timeoutMs:30000,dimensions:{width:source.info.width,height:source.info.height}});check();
  const bytes=converted.bytes;if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>1024*1024||!Number.isSafeInteger(converted.width)||!Number.isSafeInteger(converted.height)||converted.width<1||converted.height<1||converted.width>256||converted.height>256)throw Error('Invalid SVG page preview.');
  const info=require('image-size').imageSize(bytes);if(info.type!=='png'||info.width!==converted.width||info.height!==converted.height)throw Error('Invalid SVG page preview.');
  const data=await storage.importRawAssetBytes(bytes);check();return{text:'',assets:{'assets/overview.png':data},meta:{width:converted.width,height:converted.height}};
 }finally{await lease?.handle?.close().catch(()=>{});try{await lease?.finish();}finally{try{await working?.();}finally{await closeWordCleanup(directory);}}}
}
module.exports={thumbnail};
