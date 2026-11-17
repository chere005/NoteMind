const {parentPort}=require('node:worker_threads'),{createHash}=require('node:crypto');
const format=require('./notepad-format.cjs'),{ArchiveAssetWorker}=require('./archive-assets.cjs');
let assets;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const view=bytes=>Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const owned=bytes=>bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?new Uint8Array(bytes.buffer):Uint8Array.from(bytes);
function decode(bytes,options,transfers){
 const value=format.decode(view(bytes),{asset:(_name,bytes,info)=>assets.resolve(bytes,info)}),mode=options?.files??'metadata';
 if(mode===false)delete value.files;
 else value.files=Object.fromEntries(Object.entries(value.files).filter(([name])=>mode===true||!name.startsWith('assets/')).map(([name,bytes])=>{const copy=Uint8Array.from(bytes);transfers.push(copy.buffer);return [name,copy];}));
 return value;
}
parentPort.on('message',async packet=>{
 let {id,op,args,assetPacket,knownAssets=[],assetLimits}=packet;packet=null;
 try{
  assets ||= new ArchiveAssetWorker(assetLimits);let received=assets.receive(assetPacket?{document:args[0],...assetPacket}:null);
  if(received.missing){parentPort.postMessage({id,missingAssets:received.missing});return;}
  if(assetPacket)args[0]=received.doc;
  const transfers=[],known=new Set(knownAssets);let value,output;
  if(op==='encode'||op==='encodeWithDigest'){
   const bytes=format.encode(...args,{asset:(name,bytes,info)=>assets.observe(received.refs[name],bytes,info)}),encoded=owned(bytes);transfers.push(encoded.buffer);value=op==='encode'?encoded:{bytes:encoded,revision:digest(bytes)};
  }else if(op==='inspectDrawingOwned'){
   const original=view(args[0]),parsed=format.decode(original,{asset:()=>''}),files=parsed.files,info=files['drawing.json']?JSON.parse(files['drawing.json'].toString('utf8')):{},name=info.sheet||(files['assets/drawing.svg.json']?'assets/drawing.svg.json':'assets/drawing.json');
   if(typeof name!=='string'||!name.startsWith('assets/')||!files[name])throw Error('This Notepad does not contain an editable drawing sheet.');
   const encodedSheet=owned(files[name]);transfers.push(encodedSheet.buffer);value={encodedSheet,fileRevision:{sha256:digest(original),bytes:original.byteLength}};
  }else if(op==='decode'||op==='decodeOwned'||op==='inspectOwned'){
   const doc=decode(args[0],args[1],transfers),packed=assets.pack(doc,known);output=packed.wire;
   value=op==='inspectOwned'?{doc:packed.document,revision:digest(view(args[0])),bytes:args[0].byteLength}:packed.document;
  }else if(op==='prepareSnapshot'){
   value=require('./snapshot-store.cjs').prepareSnapshot(...args);
   for(const object of value.objects){object.bytes=owned(object.bytes);transfers.push(object.bytes.buffer);}
   if(value.manifestBytes)transfers.push(value.manifestBytes.buffer);
  }else if(op==='publishVersion')value=await require('./version-publisher.cjs').publishVersion(...args);
  else if(op==='readSnapshot'){
   value=await require('./snapshot-store.cjs').readSnapshot(args[0],args[1],{...args[2],assetResolver:(bytes,info)=>assets.resolve(bytes,info)});const packed=assets.pack(value,known);value=packed.document;output=packed.wire;
  }else if(op==='readCommitted'){
   value=await require('./recovery-commit.cjs').readCommitted(...args,{asset:(_name,bytes,info)=>assets.resolve(bytes,info)});const packed=assets.pack(value,known);value=packed.document;output=packed.wire;
  }else if(op==='parseJson')value=JSON.parse(view(args[0]).toString('utf8'));
  else if(op==='stringifyJson'){value=new TextEncoder().encode(JSON.stringify(args[0]));transfers.push(value.buffer);}
  else throw Error('Unknown archive operation.');
  assets.trim();const usage=process.memoryUsage();parentPort.postMessage({id,value,assetResult:{accepted:received.accepted,output},assetStats:assets.stats(),workerBytes:usage.heapUsed+usage.external},transfers);
 }catch(error){assets?.trim();const usage=process.memoryUsage();parentPort.postMessage({id,error:{name:error.name,message:error.message,stack:error.stack},assetStats:assets?.stats(),workerBytes:usage.heapUsed+usage.external});}
 finally{assets?.trim();args=null;assetPacket=null;}
});
