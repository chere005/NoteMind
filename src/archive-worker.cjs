const {parentPort}=require('node:worker_threads'),{createHash}=require('node:crypto');
const format=require('./notepad-format.cjs'),{ArchiveAssetWorker}=require('./archive-assets.cjs'),{RawAssetStore,isRawAsset}=require('./archive-raw-assets.cjs'),snapshots=require('./snapshot-store.cjs');
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
parentPort.on('message',async packet=>{
 let {id,op,args,assetPacket,knownAssets=[],assetLimits,rawLimits,rawContext,codecEpoch}=packet;packet=null;
 try{
  assets ||= new ArchiveAssetWorker(assetLimits);raw ||= new RawAssetStore({epoch:codecEpoch,...rawLimits,legacy:assets});assets.raw=raw;
  if(codecEpoch!==raw.epoch)throw Error('Invalid archive worker epoch.');
  const transfers=[],known=new Set(knownAssets);let value,output,received={accepted:{},refs:{}};
  if(op==='rawBegin')value=raw.begin(args[0]);
  else if(op==='rawAppend')value=raw.append(args[0]);
  else if(op==='rawFinish')value=raw.finish(args[0],rawContext);
  else if(op==='rawCancel')value=raw.cancel(args[0]);
  else if(op==='rawPin')value=raw.preflight(args[0]);
  else if(op==='rawLeaseRelease')value=raw.releaseLease(args[0]);
  else if(op==='rawRetain')value=raw.retain(args[0]);
  else if(op==='rawRelease')value=raw.release(args[0]);
  else if(op==='rawScopedRelease')value=raw.releaseScoped(args[0],rawContext);
  else if(op==='rawInfo')value=raw.info(args[0].descriptor,rawContext);
  else if(op==='rawRead'){value=raw.read(args[0],rawContext);transfers.push(value.buffer);}
  else if(op==='rawReadWhole'){value=raw.readWhole(args[0].descriptor,rawContext);transfers.push(value.bytes.buffer);}
  else if(op==='rawReleaseRead')value=raw.releaseRead(args[0]);
  else{
   if(rawContext)raw.context(rawContext);
   received=assets.receive(assetPacket?{document:args[0],...assetPacket}:null,rawContext);
   if(received.missing){parentPort.postMessage({id,missingAssets:received.missing});return;}
   if(assetPacket)args[0]=received.doc;raw.claim(0);
   const hooks={assetBytes:(_name,value)=>isRawAsset(value)?raw.resolve(value,rawContext):undefined,assetInfo:name=>isRawAsset(received.refs[name])?raw.info(received.refs[name],rawContext):undefined,validateAsset:name=>isRawAsset(received.refs[name])?raw.validate(name,received.refs[name],rawContext):false,asset:(name,bytes,info)=>assets.observe(received.refs[name],bytes,info)};
   value=await snapshots.withAssetContext(hooks,async()=>{
    if(op==='encodeDrawingOwned'){const bytes=format.encodeDrawingOwned(args[0]),encoded=owned(bytes);transfers.push(encoded.buffer);return {bytes:encoded,revision:digest(bytes)};}
    if(op==='duplicateArchiveOwned'){const bytes=owned(format.duplicateArchiveOwned(view(args[0]),args[1]));transfers.push(bytes.buffer);return bytes;}
    if(op==='encode'||op==='encodeWithDigest'){const bytes=format.encode(...args,hooks),encoded=owned(bytes);transfers.push(encoded.buffer);return op==='encode'?encoded:{bytes:encoded,revision:digest(bytes)};}
    if(op==='exportWord'){
     const images=args[1];if(!images||typeof images!=='object'||Array.isArray(images)||Object.keys(images).length>9998)throw Error('Invalid Word image metadata.');let total=0;const entries={};for(const [name,image]of Object.entries(images)){if(!image||!['png','jpg','gif','bmp'].includes(image.type)||!Number.isFinite(image.width)||image.width<=0||image.width>1000000||!Number.isFinite(image.height)||image.height<=0||image.height>1000000||/\.json$/i.test(name)||!Object.hasOwn(args[0].assets||{},name))throw Error('Invalid Word image metadata.');let data;entries[name]={width:image.width,height:image.height,type:image.type,get data(){if(!data){const value=args[0].assets[name],resolved=hooks.assetBytes(name,value);data=resolved===undefined?Buffer.from(value,'base64'):Buffer.from(resolved.buffer,resolved.byteOffset,resolved.byteLength);if((total+=data.length)>require('./archive-limits.cjs').TOTAL_BYTES)throw Error('Word images are too large.');}return data;}};}const bytes=owned(await require('./documents.cjs').exportWord(args[0],entries,args[2]));transfers.push(bytes.buffer);return bytes;
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
  assets.trim();raw.trim();const usage=process.memoryUsage();parentPort.postMessage({id,value,assetResult:{accepted:received.accepted,output},assetStats:assets.stats(),rawStats:raw.stats(),validationStats:require('./archive-entry-validation.cjs').validationStats(),workerBytes:usage.heapUsed+usage.external},transfers);
 }catch(error){assets?.trim();raw?.trim();const usage=process.memoryUsage();parentPort.postMessage({id,error:{name:error.name,message:error.message,stack:error.stack,code:error.code,missing:error.missing},assetStats:assets?.stats(),rawStats:raw?.stats(),workerBytes:usage.heapUsed+usage.external});}
 finally{assets?.trim();raw?.trim();args=null;assetPacket=null;}
});
