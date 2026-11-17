const graphics=require('./graphics-pane.js'),{primeStrokeFingerprint}=require('./stroke-signature.js');
async function hydrateSheetState(state,options={}){
 if(!Object.hasOwn(state,'encodedSheets'))return state;
 if(state.encodedSheets===null)return {...state,sheets:null,strokeIds:[],strokeHashes:[]};
 if(!Array.isArray(state.encodedSheets)||!state.encodedSheets.length)throw Error('Invalid drawing recovery packet.');
 const sheets=[],strokeIds=[],strokeHashes=[];
 for(let i=0;i<state.encodedSheets.length;i++){
  const packet=state.encodedSheets[i],identity=packet?.identityBytes,ids=[],hashes=[];
  if(!packet?.metadata||(identity!=null&&(!ArrayBuffer.isView(identity)||identity.byteLength%16)))throw Error('Invalid drawing recovery packet.');
  const view=identity?new DataView(identity.buffer,identity.byteOffset,identity.byteLength):null,legacyHashes=state.strokeHashes?.[i],legacyIds=state.strokeIds?.[i];
  if(!view&&(!Array.isArray(legacyHashes)||!Array.isArray(legacyIds)))throw Error('Invalid drawing recovery fingerprints.');
  const count=view?view.byteLength/16:legacyHashes.length;
  const sheet=await graphics.decodeAsync(packet.bytes,{...options,onStroke:(stroke,index)=>{
   if(index>=count)throw Error('Invalid drawing recovery fingerprints.');const id=view?view.getFloat64(index*16,true):legacyIds[index],hash=view?view.getUint32(index*16+8,true).toString(16).padStart(8,'0')+view.getUint32(index*16+12,true).toString(16).padStart(8,'0'):legacyHashes[index];if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid drawing recovery identity.');primeStrokeFingerprint(stroke,hash);ids.push(id);hashes.push(hash);
  }});
  if(sheet.strokes.length!==count)throw Error('Invalid drawing recovery fingerprints.');
  let backdrop=packet.metadata.backdrop||null;
  if(packet.backdropBytes){backdrop='';const bytes=packet.backdropBytes,decode=new TextDecoder('utf-8',{fatal:true});for(let at=0;at<bytes.length;at+=65536){if(options.signal?.aborted){const error=Error('Drawing recovery cancelled.');error.name='AbortError';throw error;}backdrop+=decode.decode(bytes.subarray(at,at+65536));await (options.yieldControl||graphics.yieldTask)();}}
  sheets.push({...sheet,...packet.metadata,backdrop,strokes:sheet.strokes});strokeIds.push(ids);strokeHashes.push(hashes);
 }
 const {encodedSheets,...metadata}=state;return {...metadata,sheets,strokeIds,strokeHashes};
}
function mergeRecoveredSheets(recovered,current){return [...recovered,...current.filter(sheet=>sheet.page.strokes.length>0||sheet.page.backdrop)];}
module.exports={hydrateSheetState,mergeRecoveredSheets};
