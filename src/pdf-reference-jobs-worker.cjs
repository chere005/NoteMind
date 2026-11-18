const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto'),{PDFInkStore}=require('./pdf-ink-store.cjs'),graphics=require('./graphics-pane.js'),inkCodec=require('./pdf-ink-codec.cjs'),{annotatePDF}=require('./pdf-reference-export.cjs'),{readLimited}=require('./read-limited.cjs');
const store=new PDFInkStore(workerData.root,{exportLeaseOptions:{owner:workerData.leaseOwner}}),controllers=new Map(),scanSessions=new Map(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
parentPort.on('message',async packet=>{
 if(packet.cancel){controllers.get(packet.cancel)?.abort();return;}const {id,operation,args}=packet,controller=new AbortController();controllers.set(id,controller);
 try{
  let value,transfers=[];controller.signal.throwIfAborted();
  if(operation==='inspect')value=await require('./pdf-reference-source.cjs').inspectSource(store,args.file,{signal:controller.signal});
  else if(operation==='state')value={index:await store.read(args.identity,args.sourceHash),previous:await store.previous(args.identity,args.sourceHash)};
  else if(operation==='page'){const page=await store.page(args.identity,args.sourceHash,args.page);value=page?{revision:page.revision,data:page.bytes.toString('base64')}:null;}
  else if(operation==='scanBegin'){if(scanSessions.size)throw Error('A scan is already being assembled.');scanSessions.set(args.id,await require('./scan-pdf.cjs').createAssembler());value=true;}
  else if(operation==='scanAppend'){const session=scanSessions.get(args.id);if(!session)throw Error('Scan assembly expired.');await session.add(args.page,{signal:controller.signal});value=session.pages;}
  else if(operation==='scanFinish'){const session=scanSessions.get(args.id);if(!session)throw Error('Scan assembly expired.');scanSessions.delete(args.id);const bytes=await session.finish({signal:controller.signal});value={data:Buffer.from(bytes).toString('base64'),bytes:bytes.length};}
  else if(operation==='scanAbort'){scanSessions.delete(args.id);value=true;}
  else if(operation==='reconcile'){value=await require('./pdf-reference-reconcile.cjs').reconcile(store,args);}
  else if(operation==='hash'){if(typeof args.data!=='string'||args.data.length>200*1024*1024)throw Error('Invalid PDF source bytes.');value=sha(Buffer.from(args.data,'base64'));}
  else if(operation==='match'){if(typeof args.data!=='string'||args.data.length>200*1024*1024||!/^[a-f0-9]{64}$/.test(args.sourceHash))throw Error('Invalid PDF source check.');value=sha(Buffer.from(args.data,'base64'))===args.sourceHash;}
  else if(operation==='attachment'){if(typeof args.data!=='string'||args.data.length>200*1024*1024)throw Error('The attachment is too large.');const bytes=Buffer.from(args.data,'base64'),file=path.join(args.directory,sha(bytes).slice(0,20)+path.extname(args.name));await require('./pdf-ink-store.cjs').atomic(file,bytes);value={path:file,name:path.basename(args.name)};}
  else if(operation==='serialize'){inkCodec.validate(args.bytes);value={revision:sha(args.bytes),data:Buffer.from(args.bytes.buffer,args.bytes.byteOffset,args.bytes.byteLength).toString('base64')};}
  else if(operation==='save'){
   try{const result=await store.save(args);value={revision:result.revision,original:result.original,durabilityWarning:result.durabilityWarning};}
   catch(error){if(error.code!=='PDF_OPENED_BYTES_REQUIRED')throw error;value={needsSource:true,bytes:args.bytes};transfers=[args.bytes.buffer];}
  }else if(operation==='captureExport')value=await store.captureExport(args.identity,args.sourceHash);
  else if(operation==='releaseExport'){try{value=await store.releaseExport(args.id);}finally{if(!store.exportLeases.active.has(args.id))controller.releasedExport=args.id;}}
  else if(operation==='targetRevision'){let stat;try{stat=await fs.stat(args.file);}catch(error){if(error.code!=='ENOENT')throw error;}if(!stat)value=null;else{const hash=require('node:crypto').createHash('sha256');for await(const chunk of require('node:fs').createReadStream(args.file))hash.update(chunk);value={bytes:stat.size,sha256:hash.digest('hex')};}}
  else if(operation==='export'){
   const source=args.sourceBytes||await readLimited(store.original(args.sourceHash),150*1024*1024,'The PDF is too large.'),result=await annotatePDF(source,{format:'notemind-pdf-ink',version:1,sourceHash:args.sourceHash,pageCount:args.pageCount,pages:{}},{loadPage:page=>args.lease?store.exportPage(args.lease,page,{signal:controller.signal}):[],signal:controller.signal,onProgress:value=>parentPort.postMessage({id,progress:value})});controller.signal.throwIfAborted();
   const target=args.file,warnings=[];try{await require('./guarded-write.cjs').replaceIfUnchanged(target,result.bytes,args.expectedRevision,{beforeCommit:()=>controller.signal.throwIfAborted()});}catch(error){if(!error.notemindFileCommitted)throw error;warnings.push(error.message);}controller.committed=true;value={file:target,pageCount:result.pageCount,strokesWritten:result.strokesWritten,committed:true,...(warnings.length?{warnings}:{})};
  }else throw Error('Unknown PDF file operation.');
  if(!controller.committed)controller.signal.throwIfAborted();parentPort.postMessage({id,value,...(controller.releasedExport?{releasedExport:controller.releasedExport}:{})},transfers);
 }catch(error){parentPort.postMessage({id,error:{name:error.name,message:error.message,code:error.code,recovery:error.recovery},...(controller.releasedExport?{releasedExport:controller.releasedExport}:{})});}
 finally{controllers.delete(id);}
});
