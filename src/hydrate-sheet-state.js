const graphics=require('./graphics-pane.js'),{primeStrokeFingerprint}=require('./stroke-signature.js'),{ownedStoredId,knownOwnedFingerprint}=require('./owned-ink-metadata.js');
function releasePacket(packet){for(const field of ['bytes','identityBytes','backdropBytes']){const bytes=packet?.[field],backing=bytes?.buffer;if(ArrayBuffer.isView(bytes)&&bytes.byteOffset===0&&bytes.byteLength===backing.byteLength&&typeof backing.transfer==='function'){try{backing.transfer(0);}catch{}}}}
async function hydrateSheetState(state,options={}){
 if(!Object.hasOwn(state,'encodedSheets'))return state;
 if(state.encodedSheets===null)return {...state,sheets:null,strokeIds:[],strokeHashes:[]};
 if(!Array.isArray(state.encodedSheets)||!state.encodedSheets.length)throw Error('Invalid drawing recovery packet.');
 const sheets=[],idsBySheet=[],hashesBySheet=[],namespace=state.session;let allOwned=true;
 try{
  for(let i=0;i<state.encodedSheets.length;i++){
   const packet=state.encodedSheets[i],identity=packet?.identityBytes;
   if(!packet?.metadata||(identity!=null&&(!ArrayBuffer.isView(identity)||identity.byteLength%16)))throw Error('Invalid drawing recovery packet.');
   const view=identity?new DataView(identity.buffer,identity.byteOffset,identity.byteLength):null,owned=!!view&&typeof state.session==='string'&&!!state.session;
   let sheet,count,ids,hashes;
   if(owned){
    count=view.byteLength/16;
    sheet=await graphics.decodeAsync(packet.bytes,{...options,owned:true,ownedIdentity:{namespace:state.session,bytes:identity},onStroke:undefined,pressuresForStroke:undefined});
   }else{
    allOwned=false;ids=[];hashes=[];const legacyHashes=state.strokeHashes?.[i],legacyIds=state.strokeIds?.[i];
    if(!view&&(!Array.isArray(legacyHashes)||!Array.isArray(legacyIds)))throw Error('Invalid drawing recovery fingerprints.');
    count=view?view.byteLength/16:legacyHashes.length;
    sheet=await graphics.decodeAsync(packet.bytes,{...options,onStroke:(stroke,index)=>{
     if(index>=count)throw Error('Invalid drawing recovery fingerprints.');const id=view?view.getFloat64(index*16,true):legacyIds[index],hash=view?view.getUint32(index*16+8,true).toString(16).padStart(8,'0')+view.getUint32(index*16+12,true).toString(16).padStart(8,'0'):legacyHashes[index];if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid drawing recovery identity.');primeStrokeFingerprint(stroke,hash);ids.push(id);hashes.push(hash);
    }});
   }
   if(sheet.strokes.length!==count)throw Error('Invalid drawing recovery fingerprints.');
   let backdrop=packet.metadata.backdrop||null;
   if(packet.backdropBytes){backdrop='';const bytes=packet.backdropBytes,decode=new TextDecoder('utf-8',{fatal:true});for(let at=0;at<bytes.length;at+=65536){if(options.signal?.aborted){const error=Error('Drawing recovery cancelled.');error.name='AbortError';throw error;}backdrop+=decode.decode(bytes.subarray(at,at+65536));await (options.yieldControl||graphics.yieldTask)();}}
   sheets.push({...sheet,...packet.metadata,backdrop,strokes:sheet.strokes});idsBySheet.push(ids);hashesBySheet.push(hashes);
   if(options.consume===true)releasePacket(packet);
  }
  if(options.signal?.aborted){const error=Error('Drawing recovery cancelled.');error.name='AbortError';throw error;}
  const {encodedSheets,strokeIds:oldIds,strokeHashes:oldHashes,...metadata}=state,result={...metadata,sheets};
  // Public compatibility columns are materialized only for explicit legacy callers.
  let ids,hashes;Object.defineProperties(result,{
   ownedIdentities:{value:allOwned},
   strokeIds:{enumerable:true,get:()=>ids ||=sheets.map((sheet,index)=>idsBySheet[index]||sheet.strokes.map(stroke=>ownedStoredId(stroke,namespace)))},
   strokeHashes:{enumerable:true,get:()=>hashes ||=sheets.map((sheet,index)=>hashesBySheet[index]||sheet.strokes.map(knownOwnedFingerprint))}
  });return result;
 }finally{if(options.consume===true)for(const packet of state.encodedSheets)releasePacket(packet);}
}
function mergeRecoveredSheets(recovered,current){return [...recovered,...current.filter(sheet=>sheet.page.strokes.length>0||sheet.page.backdrop)];}
module.exports={hydrateSheetState,mergeRecoveredSheets};
