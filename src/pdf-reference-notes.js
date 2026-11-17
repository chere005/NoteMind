(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={create:factory};else root.NoteMindPDFReferences=factory({getTabs:()=>tabs,uuid:()=>crypto.randomUUID(),encode:value=>window.NoteMindPDFInkCodec.encodeAsync(value,{yieldControl:()=>NoteMindGraphics.yieldTask?.()||new Promise(resolve=>setTimeout(resolve,0))}),save:(binding,value,bytes)=>window.notemind.reference.save(binding.serviceId,{page:value.page,bytes,expectedRevision:binding.revisions.get(value.page)||null,noteRevision:value.noteRevision}),serialize:bytes=>window.notemind.reference.serialize(bytes),reconcileDocument:value=>window.NoteMindNotes.api.pdfReconcile(value),onDirty:tab=>{tab.dirty=true;if(tab===activeTab)dirty=true;window.NoteMindNotes.changed(tab,{history:false});updateTitle();},onPrepared:tab=>{window.NoteMindHistory?.ownedChanged?.(tab);window.NoteMindNotes.schedule();},onError:error=>{$('status').textContent=error.message;}});})(typeof window==='undefined'?this:window,function({getTabs,uuid,encode,save,serialize,reconcileDocument,onDirty=()=>{},onPrepared=()=>{},onError=()=>{}}){
 const bindings=new Map(),captures=new WeakMap(),reconciling=new WeakMap();let generation=0;
 function assetName(doc,binding,sourceData){if(doc.assets?.[binding.assetName]===sourceData)return binding.assetName;return Object.keys(doc.assets||{}).find(name=>/\.pdf$/i.test(name)&&doc.assets[name]===sourceData&&(doc.meta?.attachments?.[name]?.reference?.id===binding.logicalId||!doc.meta?.attachments?.[name]?.reference));}
 function owner(binding){const original=binding.owner.deref();if(original&&getTabs().includes(original)&&original.doc.id===binding.noteId&&assetName(original.doc,binding,binding.sourceData))return original;return getTabs().find(tab=>tab.doc.id===binding.noteId&&assetName(tab.doc,binding,binding.sourceData));}
 function captureAttachment(tab,name){const sourceData=tab.doc.assets?.[name];if(typeof sourceData!=='string'||!/\.pdf$/i.test(name))throw Error('The PDF attachment is no longer available.');for(const binding of bindings.values())if(binding.noteId===tab.doc.id&&binding.sourceData===sourceData&&assetName(tab.doc,binding,sourceData)===name)return{bindingId:binding.id,attachment:{noteId:binding.noteId,logicalId:binding.logicalId}};const id=uuid(),logicalId=tab.doc.meta?.attachments?.[name]?.reference?.id||name,binding={id,noteId:tab.doc.id,logicalId,assetName:name,sourceData,owner:new WeakRef(tab),pages:new Map(),revisions:new Map(),stored:new Map(),writes:Promise.resolve(),timer:null,serviceId:null,sourceHash:null,pageCount:0};bindings.set(id,binding);return{bindingId:id,attachment:{noteId:binding.noteId,logicalId}};}
 function register(id,source){const binding=bindings.get(id);if(!binding)throw Error('The PDF attachment owner is closed.');binding.serviceId=source.id;binding.sourceHash=source.sourceHash;binding.pageCount=source.pageCount;binding.revisions=new Map(Object.entries(source.index?.pages||{}).map(([page,value])=>[Number(page),value.revision]));return binding;}
 function merge(snapshot,binding,sourceData,values){
  const name=assetName(snapshot,binding,sourceData);if(!name)return snapshot;const assets={...snapshot.assets},meta=structuredClone(snapshot.meta||{});meta.attachments ||= {};const info=meta.attachments[name] ||= {},previous=info.reference,reference=previous?.sourceHash===binding.sourceHash?{...previous,pages:{...previous.pages}}:{version:1,id:binding.logicalId,sourceHash:binding.sourceHash,pages:{}};
  for(const value of values){if(value.sourceHash!==binding.sourceHash)continue;assets[value.asset]=value.data;reference.pages[value.page]={asset:value.asset,revision:value.revision,generation:value.generation};}info.reference=reference;return{...snapshot,assets,meta};
 }
 function applyCurrent(binding,value){const tab=owner(binding);if(!tab||binding.pages.get(value.page)?.generation!==value.generation)return;const next=merge(tab.doc,binding,binding.sourceData,[value]);if(next===tab.doc)return;tab.doc.assets=next.assets;tab.doc.meta=next.meta;binding.pages.get(value.page).applied=true;onPrepared(tab);}
 function recover(binding,value){
  if(value.recovery&&!value.recoveryFailed)return;
  value.recoveryFailed=false;
  value.recovery=binding.writes.catch(()=>{}).then(async()=>{
   await value.promise;if(value.generation<(binding.stored.get(value.page)||0))return;
   const result=await save(binding,value,value.bytes);binding.stored.set(value.page,value.generation);binding.revisions.set(value.page,result.revision);value.bytes=null;value.strokes=null;
  }).catch(error=>{value.recoveryFailed=true;throw error;});
  binding.writes=value.recovery;void value.recovery.catch(error=>{try{onError(error);}catch{}});
 }
 function ensure(binding,value){
  if(!value.promise){
   // Capture encoding is independent of the recovery queue: later ink cannot hold
   // an older immutable note snapshot hostage to its own persistence work.
   value.promise=Promise.resolve().then(()=>encode({sourceHash:value.sourceHash,page:value.page,aspect:value.aspect,strokes:value.strokes})).then(async bytes=>{
    const result=await serialize(bytes),encoded={page:value.page,sourceHash:value.sourceHash,asset:value.asset,data:result.data,revision:result.revision,generation:value.generation};
    value.bytes=bytes;applyCurrent(binding,encoded);return encoded;
   }).catch(error=>{value.promise=null;throw error;});
  }
  recover(binding,value);return value.promise;
 }
 function edited(id,page,strokes,aspect){const binding=bindings.get(id);if(!binding?.sourceHash||!Number.isInteger(page)||page<1||page>binding.pageCount)throw Error('The PDF reference is not ready.');const tab=owner(binding),existing=binding.pages.get(page),name=tab&&assetName(tab.doc,binding,binding.sourceData),ref=name&&tab.doc.meta?.attachments?.[name]?.reference,asset=existing?.asset||(ref?.sourceHash===binding.sourceHash&&ref.pages?.[page]?.asset)||'assets/pdf-ink-'+uuid()+'.json',value={page,strokes:[...strokes],aspect,sourceHash:binding.sourceHash,asset,generation:++generation,noteRevision:tab?.doc.revision,promise:null,applied:false};binding.pages.set(page,value);if(tab)onDirty(tab);clearTimeout(binding.timer);binding.timer=setTimeout(()=>{binding.timer=null;void flush(id).catch(onError);},300);return value.generation;}
 function captureSnapshot(tab,snapshot){const values=[];for(const binding of bindings.values()){if(binding.noteId!==snapshot.id)continue;const name=assetName(snapshot,binding,binding.sourceData);if(!name)continue;const pending=[...binding.pages.values()].filter(value=>!value.applied);if(pending.length)values.push({binding,sourceData:snapshot.assets[name],pending});}captures.set(snapshot,values);return snapshot;}
 function copyCapture(from,to){const values=captures.get(from);if(values)captures.set(to,values);return to;}
 async function prepareSnapshot(tab,snapshot){const selected=captures.get(snapshot)||captures.get(captureSnapshot(tab,snapshot));let next=snapshot;for(const capture of selected){const values=await Promise.all(capture.pending.map(value=>ensure(capture.binding,value)));next=merge(next,capture.binding,capture.sourceData,values);}return next;}
 async function flush(id){const chosen=id?[bindings.get(id)].filter(Boolean):[...bindings.values()];for(const binding of chosen){clearTimeout(binding.timer);binding.timer=null;const values=[...binding.pages.values()];await Promise.all(values.map(value=>ensure(binding,value)));await Promise.all(values.map(value=>value.recovery));}}
 function portablePage(id,page){const binding=bindings.get(id),tab=binding&&owner(binding),name=tab&&assetName(tab.doc,binding,binding.sourceData),reference=name&&tab.doc.meta?.attachments?.[name]?.reference,entry=reference?.sourceHash===binding?.sourceHash&&reference.pages?.[page];return entry&&tab.doc.assets[entry.asset]?{data:tab.doc.assets[entry.asset],revision:entry.revision}:null;}
 function historyView(tab){const owned=new Set(),meta=structuredClone(tab.doc.meta||{});for(const info of Object.values(meta.attachments||{})){for(const page of Object.values(info?.reference?.pages||{}))if(typeof page?.asset==='string')owned.add(page.asset);if(info&&typeof info==='object')delete info.reference;}return{assets:Object.fromEntries(Object.entries(tab.doc.assets||{}).filter(([name])=>!owned.has(name))),meta};}
 function preserveHistory(tab,next){let result=next;for(const [name,info]of Object.entries(tab.doc.meta?.attachments||{})){const reference=info?.reference;if(!reference||next.assets?.[name]!==tab.doc.assets?.[name])continue;const values=Object.entries(reference.pages||{}).flatMap(([page,entry])=>typeof tab.doc.assets[entry.asset]==='string'?[{page:Number(page),asset:entry.asset,data:tab.doc.assets[entry.asset],revision:entry.revision,generation:entry.generation,sourceHash:reference.sourceHash}]:[]),binding={assetName:name,logicalId:reference.id||name,sourceHash:reference.sourceHash};result=merge(result,binding,tab.doc.assets[name],values);}return result;}
 async function reconcileTab(tab){
  if(!reconcileDocument||!tab?.doc?.id||reconciling.has(tab))return reconciling.get(tab);
  if(!Object.keys(tab.doc.assets||{}).some(name=>/\.pdf$/i.test(name)))return;
  const snapshot={...tab.doc,assets:{...tab.doc.assets},meta:structuredClone(tab.doc.meta||{})},run=Promise.resolve().then(()=>reconcileDocument(snapshot)).then(saved=>{
   if(!getTabs().includes(tab)||tab.doc.id!==snapshot.id||tab.doc.revision!==snapshot.revision)return;let changed=false;
   for(const [name,info]of Object.entries(saved.meta?.attachments||{})){
    const reference=info?.reference;if(!reference||tab.doc.assets[name]!==snapshot.assets[name])continue;const live=tab.doc.meta?.attachments?.[name]?.reference,captured=snapshot.meta?.attachments?.[name]?.reference,pages={...live?.pages},assets={...tab.doc.assets};
    for(const [page,entry]of Object.entries(reference.pages||{})){
     if(entry.revision===captured?.pages?.[page]?.revision||live?.pages?.[page]?.revision!==captured?.pages?.[page]?.revision)continue;
     if([...bindings.values()].some(binding=>owner(binding)===tab&&binding.pages.has(Number(page))&&assetName(tab.doc,binding,binding.sourceData)===name))continue;
     if(typeof saved.assets[entry.asset]!=='string')continue;assets[entry.asset]=saved.assets[entry.asset];pages[page]=entry;changed=true;
    }
    if(changed){const meta=structuredClone(tab.doc.meta||{});meta.attachments ||= {};meta.attachments[name]={...meta.attachments[name],reference:{...reference,pages}};tab.doc.assets=assets;tab.doc.meta=meta;}
   }
   if(changed){onDirty(tab);onPrepared(tab);}
  }).finally(()=>reconciling.delete(tab));reconciling.set(tab,run);return run;
 }
 function dispose(id){const binding=bindings.get(id);if(!binding)return;clearTimeout(binding.timer);bindings.delete(id);}
 return{isOwnerOpen:tab=>getTabs().includes(tab),captureAttachment,reconcileTab,register,edited,captureSnapshot,copyCapture,prepareSnapshot,flush,portablePage,historyView,preserveHistory,dispose,get:id=>bindings.get(id),stats:()=>({bindings:bindings.size})};
});

if(typeof window!=='undefined')window.addEventListener('notemind-document',()=>{if(typeof activeTab!=='undefined')void window.NoteMindPDFReferences.reconcileTab(activeTab).catch(error=>{$('status').textContent=error.message;});});
