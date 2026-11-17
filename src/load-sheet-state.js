const {yieldTask}=require('./graphics-pane.js');
function check(signal){if(signal?.aborted){const error=Error('Drawing recovery cancelled.');error.name='AbortError';throw error;}}
let nextRead=0;
const requestId=()=>globalThis.crypto?.randomUUID?.()||'read-'+Date.now().toString(36)+'-'+(++nextRead);
async function readSheet(api,method,pageId,options){
 check(options.signal);const signal=options.signal,canCancel=typeof api.cancelSheetPageLoad==='function',id=options.requestId??(canCancel?requestId():undefined),chunked=!!(api.loadSheetChunk&&api.finishSheetLoad),callOptions={...(chunked?{chunks:true}:{}),...(id?{requestId:id}:{})};if(id!==undefined&&(typeof id!=='string'||!/^[a-z0-9_.:-]{1,128}$/i.test(id)))throw Error('Invalid drawing read request.');let dispatched=false,rejectCancelled;const cancelled=new Promise((_,reject)=>rejectCancelled=reject),onAbort=()=>{if(dispatched&&canCancel&&id)try{void Promise.resolve(api.cancelSheetPageLoad(id)).catch(()=>{});}catch{}const error=Error('Drawing recovery cancelled.');error.name='AbortError';rejectCancelled(error);};signal?.addEventListener('abort',onAbort,{once:true});
 const task=(async()=>{check(signal);dispatched=true;const state=await(method==='loadSheetPage'?api[method](pageId,Object.keys(callOptions).length?callOptions:undefined):api[method](Object.keys(callOptions).length?callOptions:undefined));if(signal?.aborted){if(state?.transferSession)try{await api.finishSheetLoad?.(state.transferSession)}catch{}check(signal);}return pullSheetState(api,state,options)})();
 try{return await Promise.race([task,cancelled]);}catch(error){check(signal);throw error;}finally{signal?.removeEventListener('abort',onAbort);}
}
async function loadSheetState(api,options={}){return readSheet(api,'loadSheetState',undefined,options);}
async function loadSheetPage(api,pageId,options={}){check(options.signal);if(typeof pageId!=='string'||!/^[a-f0-9-]{36}$/i.test(pageId))throw Error('Invalid drawing page identity.');return readSheet(api,'loadSheetPage',pageId,options);}
async function pullSheetState(api,state,{signal,yieldControl=yieldTask,maxBytes=256*1024*1024}={}){
 const chunked=!!(api.loadSheetChunk&&api.finishSheetLoad);
 if(!state.transferSession){check(signal);return state;}
 const session=state.transferSession;
 try{
  check(signal);
  if(!chunked||!Array.isArray(state.encodedSheets)||!Number.isSafeInteger(state.chunkBytes)||state.chunkBytes<=0||state.chunkBytes>1024*1024)throw Error('Invalid drawing recovery transfer.');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>256*1024*1024)throw Error('Invalid drawing recovery budget.');let total=0;for(const sheet of state.encodedSheets)for(const field of ['bytes','backdropBytes','identityBytes']){const descriptor=sheet[field];if(descriptor==null)continue;if(!descriptor.chunked||typeof descriptor.key!=='string'||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||(total+=descriptor.bytes)>maxBytes)throw Error('Invalid drawing recovery size.');}
  const encodedSheets=[];for(const source of state.encodedSheets){const sheet={...source};for(const field of ['bytes','backdropBytes','identityBytes']){const descriptor=source[field];if(descriptor==null)continue;check(signal);const bytes=new Uint8Array(descriptor.bytes);for(let offset=0;offset<bytes.length;){check(signal);const chunk=await api.loadSheetChunk(session,descriptor.key,offset);check(signal);if(!ArrayBuffer.isView(chunk)||chunk.byteLength!==Math.min(state.chunkBytes,bytes.length-offset))throw Error('Invalid drawing recovery chunk.');bytes.set(new Uint8Array(chunk.buffer,chunk.byteOffset,chunk.byteLength),offset);offset+=chunk.byteLength;await yieldControl();check(signal);}sheet[field]=bytes;}encodedSheets.push(sheet);}
  check(signal);const {transferSession,chunkBytes,...metadata}=state;return {...metadata,encodedSheets};
 }finally{try{await api.finishSheetLoad(session);}catch{}}
}
module.exports={loadSheetState,loadSheetPage,pullSheetState};
