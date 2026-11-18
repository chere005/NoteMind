const {randomUUID}=require('node:crypto');
const {isMarkedAsUntransferable}=require('node:worker_threads');
const {mime}=require('./document-renderer.cjs');
const {prepareIndexSources,check}=require('./image-index-source.cjs');
const {releaseDocumentInputs}=require('./document-continuation.cjs');
const {waitWorking}=require('./image-index-working.cjs');
const discard=value=>{if(ArrayBuffer.isView(value)&&!value.byteOffset&&value.byteLength===value.buffer.byteLength&&!isMarkedAsUntransferable(value.buffer))try{value.buffer.transfer(0)}catch{}};

// The document transport owns encoded input admission. A verified spool lets
// that admission end before conversion, while a separate workspace owns every
// pixel and model byte until the reader's actual worker has exited.
async function readAsset(event,doc,options,{storage,documentIO,directory,prepare=prepareIndexSources,releaseInputs=releaseDocumentInputs,acquire=waitWorking}={}){
 const {assetName,signal,id,language='auto'}=options||{};
 if(typeof assetName!=='string'||!Object.hasOwn(doc.assets||{},assetName)||Object.keys(doc.assets).length!==1||!mime(assetName)||!['auto','en'].includes(language))throw Error('Choose one supported picture to read.');
 const extension=assetName.split('.').pop(),name='assets/ocr-source.'+extension,source={text:'',assets:{[name]:doc.assets[assetName]},meta:{}};
 let sources,lease,working,converted;const owner=randomUUID(),controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let off=()=>{};
 try{
  check(controller.signal);sources=await prepare(source,{storage,signal:controller.signal,tempRoot:directory});check(controller.signal);
  if(sources.rows.length!==1||!sources.rows[0].source)throw Error('The picture source is unavailable.');
  await releaseInputs();check(controller.signal);
  const row=sources.rows[0],plan=row.source.workingPlan;lease=await storage.preflightRawAssets([],{owner});check(controller.signal);
  return await lease.run(async()=>{
   working=await acquire(storage,controller.signal,plan.convertBytes);const lost=()=>controller.abort(working.signal.reason);working.signal?.addEventListener('abort',lost,{once:true});off=()=>working.signal?.removeEventListener('abort',lost);if(working.signal?.aborted)lost();check(controller.signal);
   const convert=documentIO.convertIndexImageFile||documentIO.convertImageFile;converted=await convert.call(documentIO,row.source.file,row.type,{...row.source,signal:controller.signal,maxDimension:2400,maxRSSBytes:384*1024*1024,timeoutMs:30000},event.sender);check(controller.signal);
   const pixels=converted?.pixels,bytes=pixels?.data||converted?.bytes||converted?.data;if(!ArrayBuffer.isView(bytes)||bytes.byteLength>plan.maxOutputBytes)throw Error('Picture conversion exceeded its admitted workspace.');
   await working.resize(bytes.byteLength+plan.ocrBytes+plan.modelBytes,{preserve:true});check(controller.signal);
   const settings={id:'asset-ocr-'+owner,language,signal:controller.signal,retireOnCompletion:true,onProgress:phase=>{if(!event.sender.isDestroyed())event.sender.send('document-progress',{id,phase});}};
   const result=pixels?await documentIO.reader.readPixels(pixels,{...settings,takeOwnership:true}):await documentIO.reader.read(bytes,settings);check(controller.signal);return result;
  });
 }finally{
  signal?.removeEventListener('abort',abort);off();
  // A rejected terminate() or fulfilled-but-live worker retains this operation's
  // admission until its actual exit receipt; cancellation never fabricates it.
  await documentIO.reader.awaitStopped();discard(converted?.pixels?.data||converted?.bytes||converted?.data);converted=null;
  try{await working?.();}finally{try{await lease?.release();}finally{try{if(lease)await storage.releaseRawAssets(owner);}finally{await sources?.cleanup();}}}
 }
}
module.exports={readAsset};
