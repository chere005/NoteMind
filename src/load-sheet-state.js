const {yieldTask}=require('./graphics-pane.js');
function check(signal){if(signal?.aborted){const error=Error('Drawing recovery cancelled.');error.name='AbortError';throw error;}}
async function loadSheetState(api,options={}){
 check(options.signal);const chunked=!!(api.loadSheetChunk&&api.finishSheetLoad),state=await api.loadSheetState(chunked?{chunks:true}:undefined);return pullSheetState(api,state,options);
}
async function pullSheetState(api,state,{signal,yieldControl=yieldTask,maxBytes=256*1024*1024}={}){
 const chunked=!!(api.loadSheetChunk&&api.finishSheetLoad);
 if(!state.transferSession){check(signal);return state;}
 const session=state.transferSession;
 try{
  check(signal);
  if(!chunked||!Array.isArray(state.encodedSheets)||!Number.isSafeInteger(state.chunkBytes)||state.chunkBytes<=0||state.chunkBytes>1024*1024)throw Error('Invalid drawing recovery transfer.');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>256*1024*1024)throw Error('Invalid drawing recovery budget.');let total=0;for(const sheet of state.encodedSheets)for(const field of ['bytes','backdropBytes','identityBytes']){const descriptor=sheet[field];if(descriptor==null)continue;if(!descriptor.chunked||typeof descriptor.key!=='string'||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||(total+=descriptor.bytes)>maxBytes)throw Error('Invalid drawing recovery size.');}
  const encodedSheets=[];for(const source of state.encodedSheets){const sheet={...source};for(const field of ['bytes','backdropBytes','identityBytes']){const descriptor=source[field];if(descriptor==null)continue;const bytes=new Uint8Array(descriptor.bytes);for(let offset=0;offset<bytes.length;){check(signal);const chunk=await api.loadSheetChunk(session,descriptor.key,offset);check(signal);if(!ArrayBuffer.isView(chunk)||chunk.byteLength!==Math.min(state.chunkBytes,bytes.length-offset))throw Error('Invalid drawing recovery chunk.');bytes.set(new Uint8Array(chunk.buffer,chunk.byteOffset,chunk.byteLength),offset);offset+=chunk.byteLength;await yieldControl();}sheet[field]=bytes;}encodedSheets.push(sheet);}
  const {transferSession,chunkBytes,...metadata}=state;return {...metadata,encodedSheets};
 }finally{try{await api.finishSheetLoad(session);}catch{}}
}
module.exports={loadSheetState,pullSheetState};
