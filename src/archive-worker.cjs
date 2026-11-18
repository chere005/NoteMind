const {parentPort}=require('node:worker_threads'),{createHash}=require('node:crypto');
const format=require('./notepad-format.cjs'),{ArchiveAssetWorker}=require('./archive-assets.cjs'),{RawAssetStore,isRawAsset}=require('./archive-raw-assets.cjs'),snapshots=require('./snapshot-store.cjs');
const {releaseArchiveInput}=require('./archive-input-ownership.cjs');
let assets,raw;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const view=bytes=>Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const owned=bytes=>bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?new Uint8Array(bytes.buffer):Uint8Array.from(bytes);
function decode(bytes,options,transfers,context){
 if(context&&options?.files===true)throw Error('Raw archive scopes read attachment bytes individually.');
 const value=format.decode(view(bytes),{asset:(_name,bytes,info)=>context?raw.decoded(bytes,info,context):assets.resolve(bytes,info)}),mode=options?.files??'metadata';
 if(mode===false)delete value.files;
 else value.files=Object.fromEntries(Object.entries(value.files).filter(([name])=>mode===true||!name.startsWith('assets/')).map(([name,bytes])=>{const copy=Uint8Array.from(bytes);transfers.push(copy.buffer);return [name,copy];}));
 return value;
}
function packOutput(doc,known,context){
 if(context&&doc&&typeof doc.text==='string'&&doc.assets)for(const name of Object.keys(doc.assets)){const value=doc.assets[name];if(typeof value==='string'){const bytes=Buffer.from(value,'base64');doc.assets[name]=raw.decoded(bytes,{sha256:digest(bytes)},context);}}
 return assets.pack(doc,known);
}
async function handlePacket(packet){
 let {id,op,args,assetPacket,knownAssets=[],assetLimits,rawLimits,rawContext,codecEpoch,inspectionCleanup}=packet;packet=null;let rawPacket;
 const cleanup=()=>{let failure;try{releaseArchiveInput(op,args)}catch(error){failure=error;}const scope=rawPacket;rawPacket=null;try{raw?.endPacket(scope)}catch(error){failure ||=error;}try{assets?.trim()}catch(error){failure ||=error;}try{raw?.trim()}catch(error){failure ||=error;}if(failure)throw failure;};
 try{
  assets ||= new ArchiveAssetWorker(assetLimits);raw ||= new RawAssetStore({epoch:codecEpoch,...rawLimits,legacy:assets});assets.raw=raw;
  if(codecEpoch!==raw.epoch)throw Error('Invalid archive worker epoch.');rawPacket=raw.beginPacket();
  const transfers=[],known=new Set(knownAssets);let value,output,received={accepted:{},refs:{}};
  if(op==='rawBegin')value=raw.begin(args[0]);
  else if(op==='rawAppend')value=raw.append(args[0]);
  else if(op==='rawFinish')value=raw.finish(args[0],rawContext);
  else if(op==='rawCancel')value=raw.cancel(args[0]);
  else if(op==='rawPin')value=raw.preflight(args[0]);
  else if(op==='rawLeaseRelease')value=raw.releaseLease(args[0]);
  else if(op==='rawRetain')value=raw.retain(args[0]);
  else if(op==='rawRelease')value=raw.release(args[0]);
  else if(op==='rawScopedRelease'){raw.releaseScoped(args[0],rawContext);value=inspectionCleanup?{inspectionCleanup}:undefined;}
  else if(op==='rawAcquireWorking')value=raw.acquireWorking(args[0],rawContext);
  else if(op==='rawResizeWorking')value=raw.resizeWorking(args[0]);
  else if(op==='rawReleaseWorking')value=raw.releaseWorking(args[0]);
  else if(op==='rawInfo')value=raw.info(args[0].descriptor,rawContext);
  else if(op==='rawRead'){value=raw.read(args[0],rawContext);transfers.push(value.buffer);}
  else if(op==='rawReadWhole'){value=raw.readWhole(args[0].descriptor,rawContext);transfers.push(value.bytes.buffer);}
  else if(op==='rawReleaseRead')value=raw.releaseRead(args[0]);
  else{
   if(rawContext)raw.context(rawContext);
   received=assets.receive(assetPacket?{document:args[0],...assetPacket}:null,rawContext);
   if(received.missing){cleanup();parentPort.postMessage({id,missingAssets:received.missing});return;}
   if(assetPacket)args[0]=received.doc;raw.claim(0);
   const hooks={assetBytes:(_name,value)=>isRawAsset(value)?raw.resolve(value,rawContext):undefined,assetInfo:name=>isRawAsset(received.refs[name])?raw.info(received.refs[name],rawContext):undefined,assetSource:(_name,value)=>isRawAsset(value)?raw.source(value,rawContext):undefined,validateAsset:name=>isRawAsset(received.refs[name])?raw.validate(name,received.refs[name],rawContext):false,asset:(name,bytes,info)=>assets.observe(received.refs[name],bytes,info)};
   value=await snapshots.withAssetContext(hooks,async()=>{
    if(op==='encodeDrawingOwned'){const bytes=format.encodeDrawingOwned(args[0]),encoded=owned(bytes);transfers.push(encoded.buffer);return {bytes:encoded,revision:digest(bytes)};}
    if(op==='duplicateArchiveOwned'){const bytes=owned(format.duplicateArchiveOwned(view(args[0]),args[1]));transfers.push(bytes.buffer);return bytes;}
    if(op==='encodeFile'){const flag=args[1]?.cancel instanceof SharedArrayBuffer&&args[1].cancel.byteLength===4?new Int32Array(args[1].cancel):null;if(!flag)throw Error('Archive file output cancellation ownership is missing.');const check=()=>{if(Atomics.load(flag,0))throw Object.assign(Error('Archive file output cancelled.'),{name:'AbortError'});if(rawContext)raw.context(rawContext);};check();return require('./notepad-file.cjs').writeNotepadFile(args[0],args[2],args[1],{hooks:{...hooks,assetSource:(name,value)=>isRawAsset(value)?raw.source(value,rawContext,{check}):undefined},check});}
    if(op==='validateNotepad'){const flag=args[1]?.cancel instanceof SharedArrayBuffer&&args[1].cancel.byteLength===4?new Int32Array(args[1].cancel):null;if(!flag)throw Error('Notepad validation cancellation ownership is missing.');const check=()=>{if(Atomics.load(flag,0))throw Object.assign(Error('Notepad validation cancelled.'),{name:'AbortError'});if(rawContext)raw.context(rawContext);};check();return require('./notepad-validation.cjs').validateNotepad(args[0],args[1],{hooks:{...hooks,validateAsset:name=>{check();return isRawAsset(received.refs[name])?raw.validateScoped(name,received.refs[name],rawContext):false;}},check});}
    if(op==='encode'||op==='encodeWithDigest'){const bytes=format.encode(...args,hooks),encoded=owned(bytes);transfers.push(encoded.buffer);return op==='encode'?encoded:{bytes:encoded,revision:digest(bytes)};}
    if(op==='pdfInk'){const result=await require('./pdf-ink-archive.cjs').run(args[0],args[1],{assetBytes:hooks.assetBytes,makeAsset:(bytes,info)=>rawContext?raw.decoded(bytes,info,rawContext):bytes.toString('base64')});if(result?.assets){const packed=packOutput(result,known,rawContext);output=packed.wire;return packed.document;}return result;}
    if(op==='wordImageNames'){const doc=args[0];if(!doc||typeof doc.text!=='string'||Buffer.byteLength(doc.text)>16*1024*1024||Object.keys(doc.assets||{}).length>9998)throw Error('Invalid Word export metadata.');return require('./word-markdown.cjs').imageNames(doc);}
    if(op==='exportWordFile'){
     const flag=args[3]?.cancel instanceof SharedArrayBuffer&&args[3].cancel.byteLength===4?new Int32Array(args[3].cancel):null;if(!flag)throw Error('Word export cancellation ownership is missing.');const check=()=>{if(Atomics.load(flag,0))throw Object.assign(Error('Word export cancelled.'),{name:'AbortError'});if(rawContext)raw.context(rawContext);};check();return require('./word-file.cjs').exportWordFile(args[0],args[1],args[2],args[3],{hooks,check});
    }
    if(op==='exportWord'){
     const images=args[1];if(!images||typeof images!=='object'||Array.isArray(images)||Object.keys(images).length>9998)throw Error('Invalid Word image metadata.');let total=0;const entries=Object.create(null);for(const [name,image]of Object.entries(images)){if(!image||!['png','jpg','gif','bmp'].includes(image.type)||!Number.isFinite(image.width)||image.width<=0||image.width>1000000||!Number.isFinite(image.height)||image.height<=0||image.height>1000000||/\.json$/i.test(name)||!Object.hasOwn(args[0].assets||{},name))throw Error('Invalid Word image metadata.');let data;entries[name]={width:image.width,height:image.height,type:image.type,get data(){if(!data){const value=args[0].assets[name],resolved=hooks.assetBytes(name,value);data=resolved===undefined?Buffer.from(value,'base64'):Buffer.from(resolved.buffer,resolved.byteOffset,resolved.byteLength);if((total+=data.length)>require('./archive-limits.cjs').TOTAL_BYTES)throw Error('Word images are too large.');}return data;}};}const bytes=owned(await require('./documents.cjs').exportWord(args[0],entries,args[2]));transfers.push(bytes.buffer);return bytes;
    }
    if(op==='importWordFile'){
     if(!rawContext)throw Error('Word import requires its document owner.');const flag=args[1]?.cancel instanceof SharedArrayBuffer&&args[1].cancel.byteLength===4?new Int32Array(args[1].cancel):null;if(!flag)throw Error('Word import cancellation ownership is missing.');const check=()=>{if(Atomics.load(flag,0))throw Object.assign(Error('Word import cancelled.'),{name:'AbortError'});raw.context(rawContext);},lease=raw.context(rawContext),before=new Set(lease.tokens),issued=()=>[...lease.tokens].filter(token=>!before.has(token)).map(token=>raw.entries.get(token)?.descriptor).filter(Boolean),rollback=()=>{const descriptors=issued();if(descriptors.length)raw.releaseScoped({descriptors},rawContext);};
     try{check();const doc=await require('./word-import-file.cjs').importWordFile(args[0],{check,expectedRevision:args[1]?.expectedRevision},{adoptAsset:(_name,bytes,info)=>{check();return raw.decoded(bytes,info,rawContext,{reuse:false});},retainsAssetBacking:(descriptor,bytes)=>raw.retainsBacking(descriptor,bytes,rawContext),releaseAssets:rollback,admitDocument:doc=>require('./notepad-validation.cjs').validateNotepad(doc,{}, {check,hooks:{assetInfo:name=>raw.info(doc.assets[name],rawContext),assetSource:(_name,value)=>raw.source(value,rawContext,{check}),validateAsset:name=>raw.validateScoped(name,doc.assets[name],rawContext)}}),reserveAsset:bytes=>{check();const reservation=raw.acquireWorking({bytes},rawContext);let released=false;return()=>{if(released)return;released=true;raw.releaseWorking({...reservation,...rawContext});};}});check();const packed=packOutput(doc,known,rawContext);output=packed.wire;return{doc:packed.document,issuedRawTokens:issued().map(value=>value.rawAssetToken)};}catch(error){try{rollback();}catch(cleanup){throw Object.assign(Error('Word import rollback could not be confirmed: '+cleanup.message),{code:'WORD_IMPORT_CLEANUP_FAILED',cause:error});}throw error;}
    }
    if(op==='inspectFile'){
     const options=args[1],flag=options?.cancel instanceof SharedArrayBuffer&&options.cancel.byteLength===4?new Int32Array(options.cancel):null;if(!flag)throw Error('Archive file inspection cancellation ownership is missing.');const check=()=>{if(Atomics.load(flag,0))throw Object.assign(Error('Archive open cancelled.'),{name:'AbortError'});if(rawContext)raw.context(rawContext);},lease=rawContext?raw.context(rawContext):null,before=new Set(lease?.tokens||[]);
     const issued=()=>[...(lease?.tokens||[])].filter(token=>!before.has(token)).map(token=>raw.entries.get(token)?.descriptor).filter(Boolean);
     try{check();const result=await require('./archive-file-inspection.cjs').inspectArchiveFile(args[0],{files:options.files},{check,withEntry:(entry,run)=>raw.withWorking(entry.original,run),...(rawContext?{asset:(_name,result)=>{const descriptor=raw.decoded(result.bytes,result,rawContext);raw.markValidated(_name,descriptor,rawContext,result.bytes);if(!raw.retainsBacking(descriptor,result.bytes,rawContext))raw.discardBacking(result.bytes);return descriptor;}}:{})});check();const packed=packOutput(result.doc,known,rawContext);output=packed.wire;for(const bytes of Object.values(packed.document.files||{}))transfers.push(bytes.buffer);return{...result,doc:packed.document,issuedRawTokens:issued().map(value=>value.rawAssetToken)};}catch(error){const descriptors=issued();if(descriptors.length)raw.releaseScoped({descriptors},rawContext);throw error;}
    }
    if(op==='inspectDrawingOwned'){
     const original=view(args[0]),parsed=format.decode(original,{asset:()=>''}),files=parsed.files,info=files['drawing.json']?JSON.parse(files['drawing.json'].toString('utf8')):{},name=info.sheet||(files['assets/drawing.svg.json']?'assets/drawing.svg.json':'assets/drawing.json');
     if(typeof name!=='string'||!name.startsWith('assets/')||!files[name])throw Error('This Notepad does not contain an editable drawing sheet.');
     const encodedSheet=owned(files[name]);transfers.push(encodedSheet.buffer);return {encodedSheet,fileRevision:{sha256:digest(original),bytes:original.byteLength}};
    }
    if(op==='decode'||op==='decodeOwned'||op==='inspectOwned'){const doc=decode(args[0],args[1],transfers,rawContext),packed=packOutput(doc,known,rawContext);output=packed.wire;return op==='inspectOwned'?{doc:packed.document,revision:digest(view(args[0])),bytes:args[0].byteLength}:packed.document;}
    if(op==='prepareSnapshot'){
     if(Object.values(args[0].assets||{}).some(isRawAsset))throw Error('Raw asset snapshots must be published inside the archive worker.');
     const prepared=snapshots.prepareSnapshot(...args);for(const object of prepared.objects){object.bytes=owned(object.bytes);transfers.push(object.bytes.buffer);}if(prepared.manifestBytes)transfers.push(prepared.manifestBytes.buffer);return prepared;
    }
    if(op==='publishVersion')return require('./version-publisher.cjs').publishVersion(...args);
    if(op==='readRecoveryState')return require('./archive-version-source.cjs').readRecoveryState(...args);
    if(op==='importRawAssetFile')return raw.importFile(args[0],args[1],rawContext);
    if(op==='publishVersionFromFile')return require('./archive-version-source.cjs').publishVersionFromFile(...args,{withEntry:(entry,run)=>entry.name.startsWith('assets/')?raw.withWorking(entry.original,run):run()});
    if(op==='publishMarkdownVersionFromFile')return require('./markdown-version-source.cjs').publishMarkdownVersionFromFile(...args,{withEntry:(entry,run)=>raw.withWorking(entry.original,run)});
    if(op==='readSnapshot'){const doc=await snapshots.readSnapshot(args[0],args[1],{...args[2],assetResolver:(bytes,info)=>rawContext?raw.decoded(bytes,info,rawContext):assets.resolve(bytes,info)}),packed=packOutput(doc,known,rawContext);output=packed.wire;return packed.document;}
    if(op==='readCommitted'){const doc=await require('./recovery-commit.cjs').readCommitted(...args,{asset:(_name,bytes,info)=>rawContext?raw.decoded(bytes,info,rawContext):assets.resolve(bytes,info)}),packed=packOutput(doc,known,rawContext);output=packed.wire;return packed.document;}
    if(op==='parseJson')return JSON.parse(view(args[0]).toString('utf8'));
    if(op==='stringifyJson'){const bytes=new TextEncoder().encode(JSON.stringify(args[0]));transfers.push(bytes.buffer);return bytes;}
    throw Error('Unknown archive operation.');
   });
  }
  cleanup();const usage=process.memoryUsage();parentPort.postMessage({id,value,assetResult:{accepted:received.accepted,output},assetStats:assets.stats(),rawStats:raw.stats(),validationStats:require('./archive-entry-validation.cjs').validationStats(),workerBytes:usage.heapUsed+usage.external},transfers);
 }catch(error){try{cleanup()}catch(failure){error.rawCleanupError=failure.message;}const usage=process.memoryUsage();parentPort.postMessage({id,error:{name:error.name,message:error.message,stack:error.stack,code:error.code,missing:error.missing},assetStats:assets?.stats(),rawStats:raw?.stats(),workerBytes:usage.heapUsed+usage.external});}
 finally{args=null;assetPacket=null;}
}
// Failed reply/cleanup reporting closes only this owned worker; Main joins its exit before retirement.
parentPort.on('message',packet=>{void handlePacket(packet).catch(()=>process.exit(1));});
