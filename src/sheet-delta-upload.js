const {measureHeaderAsync}=require('./sheet-delta-header.js');
const {yieldTask}=require('./graphics-pane.js');
const PART_BYTES=512*1024,ID_BATCH=16384;
const idsOf=row=>row.appendStrokeIds||row.strokeIds;
function shouldUploadDelta(value){return !!value?.sheets&&((value.addChunks||[]).some(packet=>packet.bytes?.byteLength>=PART_BYTES)||value.sheets.some(row=>idsOf(row)?.length>=ID_BATCH)||(value.addBackdrops||[]).some(value=>value.data?.length>=PART_BYTES));}
function headerOf(value){return {...value,addChunks:(value.addChunks||[]).map(packet=>({byteLength:packet.bytes.byteLength,identityLength:packet.identityBytes.byteLength})),addBackdrops:(value.addBackdrops||[]).map(value=>({id:value.id,length:value.data.length})),sheets:value.sheets.map(row=>{const {strokeIds,appendStrokeIds,...header}=row;return {...header,...(strokeIds?{strokeIdsLength:strokeIds.length}:{}),...(appendStrokeIds?{appendStrokeIdsLength:appendStrokeIds.length}:{})};})};}
async function sendDeltaParts(value,write,{check=()=>{},yieldControl=yieldTask}={}){
 const send=async part=>{check();await write(part);check();await yieldControl();};
 for(let index=0;index<(value.addChunks||[]).length;index++)for(const [kind,key]of [['geometry','bytes'],['identity','identityBytes']]){const source=value.addChunks[index][key];for(let offset=0;offset<source.byteLength;offset+=PART_BYTES){check();const data=Uint8Array.from(source.subarray(offset,Math.min(source.byteLength,offset+PART_BYTES)));await send({kind,index,offset,data});}}
 for(let index=0;index<value.sheets.length;index++){const row=value.sheets[index];for(const kind of ['strokeIds','appendStrokeIds']){const source=row[kind];if(!source)continue;for(let start=0;start<source.length;start+=ID_BATCH){check();const count=Math.min(ID_BATCH,source.length-start),data=new Uint8Array(count*8),view=new DataView(data.buffer);for(let at=0;at<count;at++){const id=source[start+at];if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid drawing upload identity.');view.setFloat64(at*8,id,true);}await send({kind,index,offset:start*8,data});}}}
 for(let index=0;index<(value.addBackdrops||[]).length;index++){const source=value.addBackdrops[index].data;for(let offset=0;offset<source.length;offset+=PART_BYTES)await send({kind:'background',index,offset,data:source.slice(offset,offset+PART_BYTES)});}
}
async function uploadSheetDelta(api,value,options={}){
 if(!shouldUploadDelta(value)||!api.beginSheetsDeltaUpload||!api.writeSheetsDeltaUpload||!api.finishSheetsDeltaUpload||!api.cancelSheetsDeltaUpload)return api.saveSheetsDelta(value);
 let token;try{options.check?.();const header=headerOf(value);await measureHeaderAsync(header,{yieldControl:options.yieldControl||yieldTask,check:options.check});token=await api.beginSheetsDeltaUpload(header);await sendDeltaParts(value,part=>api.writeSheetsDeltaUpload(token,part),options);options.check?.();return await api.finishSheetsDeltaUpload(token);}finally{if(token)await api.cancelSheetsDeltaUpload(token).catch(()=>{});}
}
module.exports={shouldUploadDelta,headerOf,sendDeltaParts,uploadSheetDelta,PART_BYTES,ID_BATCH};
