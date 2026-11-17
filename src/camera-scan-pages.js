const {yieldTask}=require('./graphics-pane.js'),{ENTRY_BYTES,TOTAL_BYTES}=require('./archive-limits.cjs'),limits=require('./scan-limits.js');
const abort=()=>Object.assign(Error('Camera scan preparation cancelled.'),{name:'AbortError'});
function check(signal){if(signal?.aborted)throw abort();}
async function loadCameraScanPage(api,pageId,{signal,yieldControl=yieldTask}={}){
 check(signal);const requestId=globalThis.crypto.randomUUID(),chunked=!!(api.loadSheetChunk&&api.finishSheetLoad);let stop,dispatched=false,session,cleanup;
 const finish=()=>{if(!session)return Promise.resolve();return cleanup||=Promise.resolve().then(()=>api.finishSheetLoad(session)).catch(()=>{});};
 const loading=Promise.resolve().then(()=>{check(signal);dispatched=true;return api.loadCameraPage(pageId,{chunks:chunked,requestId});});
 const cancelled=new Promise((_resolve,reject)=>{stop=()=>{if(dispatched)try{void Promise.resolve(api.cancelCameraPageLoad?.(requestId)).catch(()=>{});}catch{}void finish();reject(abort());};signal?.addEventListener('abort',stop,{once:true});});
 const task=(async()=>{try{
  const state=await loading;session=state.transferSession;check(signal);
  if(!Array.isArray(state.encodedSheets)||state.encodedSheets.length!==1)throw Error('Invalid saved camera page.');
  if(!session)return state;
  if(!chunked||!Number.isSafeInteger(state.chunkBytes)||state.chunkBytes<=0||state.chunkBytes>1024*1024)throw Error('Invalid camera scan transfer.');
  const source=state.encodedSheets[0],page={metadata:source.metadata};let total=0;
  for(const field of ['bytes','backdropBytes','identityBytes']){const part=source[field];if(part==null)continue;if(!part.chunked||typeof part.key!=='string'||!Number.isSafeInteger(part.bytes)||part.bytes<0||(total+=part.bytes)>256*1024*1024)throw Error('Invalid camera scan size.');}
  for(const field of ['bytes','backdropBytes']){
   check(signal);const part=source[field];if(part==null){page[field]=null;continue;}const bytes=new Uint8Array(part.bytes);
   for(let at=0;at<bytes.length;){check(signal);const chunk=await api.loadSheetChunk(session,part.key,at);check(signal);if(!(chunk instanceof Uint8Array)||chunk.byteLength!==Math.min(state.chunkBytes,bytes.length-at))throw Error('Invalid camera scan chunk.');bytes.set(chunk,at);at+=chunk.length;await yieldControl();check(signal);}
   page[field]=bytes;
  }
  const {transferSession,chunkBytes,...metadata}=state;return {...metadata,encodedSheets:[page]};
 }finally{await finish();}})();
 try{return await Promise.race([task,cancelled]);}finally{signal?.removeEventListener('abort',stop);}
}
async function collectCameraScansOwned(api,{render,encode,signal,onProgress=()=>{},selectPages,maxBytes=TOTAL_BYTES,maxChars=limits.MAX_DATA_URL_CHARS}={}){
 check(signal);const catalog=await api.listCameraPages();check(signal);let pages=catalog.pages.filter(page=>page.backdropId);const result=[];let bytes=0,characters=0;
 if(pages.length&&selectPages){const ids=await selectPages(pages,{signal});check(signal);if(!Array.isArray(ids)||new Set(ids).size!==ids.length)throw Error('Invalid camera scan selection.');const available=new Map(pages.map(page=>[page.pageId,page]));pages=ids.map(id=>{const page=available.get(id);if(!page)throw Error('A selected camera page is no longer available.');return page;});}
 limits.assertPageCount(pages.length);if(!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>limits.MAX_DATA_URL_CHARS)throw Error('Invalid scan size limit.');
 for(let at=0;at<pages.length;at++){
  check(signal);const row=pages[at];onProgress({done:at,total:pages.length,name:row.metadata.name});
  const state=await loadCameraScanPage(api,row.pageId,{signal}),packet=state.encodedSheets[0];check(signal);
  const {pageId,geometryRevision,backdrop,...metadata}=packet.metadata;
  if(state.session!==catalog.session||pageId!==row.pageId||geometryRevision!==row.geometryRevision||JSON.stringify(metadata)!==JSON.stringify(row.metadata)||state.signatures?.[0]!==row.signature)throw Error('A camera page changed while the scan was preparing. Try preparing it again.');
  const rendered=await render(packet,{owned:true,signal,thumbnail:true});check(signal);
  if(!rendered?.blob||rendered.blob.size>ENTRY_BYTES)throw Error('A camera image exceeds the 50 MiB image limit.');
  bytes+=rendered.blob.size;characters+=limits.imageDataURLChars(rendered.blob.size);if(bytes>maxBytes||characters>maxChars)throw Error('The selected camera pages exceed the scan size limit. Choose fewer pages.');
  const data=await encode(rendered.blob,{signal}),thumbnail=rendered.thumbnail?await encode(rendered.thumbnail,{signal}):undefined;check(signal);result.push({name:metadata.name,data,...(thumbnail?{thumbnail}:{})});
 }
 onProgress({done:pages.length,total:pages.length});return result;
}
async function collectCameraScans(api,options={}){
 const {signal}=options;check(signal);if(!signal)return collectCameraScansOwned(api,options);let stop;
 const cancelled=new Promise((_resolve,reject)=>{stop=()=>reject(abort());signal.addEventListener('abort',stop,{once:true});}),task=Promise.resolve().then(()=>collectCameraScansOwned(api,options));
 try{return await Promise.race([task,cancelled]);}finally{signal.removeEventListener('abort',stop);}
}
module.exports={collectCameraScans,loadCameraScanPage};
