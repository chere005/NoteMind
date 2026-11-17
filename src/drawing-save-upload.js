const graphics=require('./graphics-pane.js'),CHUNK=262144,THRESHOLD=1024*1024;
const descriptor=data=>{if(typeof data!=='string'||!data.length||data.length%4)throw Error('Invalid drawing save data.');return {chars:data.length,bytes:data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0)};};
async function saveDrawingPane(api,sheet,image,file,options){
 if(!sheet?.encodedGraphics||Math.max(sheet.encodedGraphics.length,image?.length||0)<THRESHOLD||!api.beginDrawingSave||!api.writeDrawingSave||!api.cancelDrawingSave)return api.savePane(sheet,image,file,options);
 if(Object.keys(sheet).length!==1)throw Error('Invalid drawing save data.');const capturedOptions=options?{...options,...(options.expected?{expected:{...options.expected}}:{})}:options;
 const values={graphics:sheet.encodedGraphics,image},header=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,descriptor(value)])),opened=await api.beginDrawingSave(header),token=opened?.token;if(typeof token!=='string')throw Error('Could not prepare the drawing save.');
 try{for(const stream of ['graphics','image']){const data=values[stream];for(let offset=0;offset<data.length;offset+=CHUNK){const part=data.slice(offset,offset+CHUNK),answer=await api.writeDrawingSave(token,{stream,offset,data:part});if(answer?.received!==offset+part.length)throw Error('The drawing upload was interrupted.');await graphics.yieldTask();}}return await api.savePane({drawingUpload:token},null,file,capturedOptions);}finally{await Promise.resolve().then(()=>api.cancelDrawingSave(token)).catch(()=>{});}
}
module.exports={saveDrawingPane,CHUNK};
