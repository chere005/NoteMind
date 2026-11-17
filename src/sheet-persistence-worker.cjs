const {parentPort,workerData}=require('node:worker_threads'),{randomUUID}=require('node:crypto');
const graphics=require('./graphics-pane.js'),{readLimited}=require('./read-limited.cjs'),{sheetRevision,sameSheetRevision}=require('./sheet-revision.cjs');
const {fingerprint,hashText}=require('./stroke-signature.js');
const LIMIT=100*1024*1024,MAX_POINTS=2000000;
let loaded=false,hasFile=false,initialModels,rows=[],strokes=new Map(),backgrounds=new Map(),version=0,nextStroke=1,nextBackdrop=1;
let session=randomUUID(),fileRevision=null;const recent=new Map(),candidates=new Map();
const validId=id=>Number.isSafeInteger(id)&&id>0;
function metadata(value){
 if(!value||typeof value!=='object'||typeof value.name!=='string')throw Error('Invalid drawing sheet.');
 graphics.validate({...value,strokes:[],backdrop:null});const result={...value};delete result.strokes;delete result.backdrop;return result;
}
function strokeRecord(stroke){graphics.validate({aspect:1,strokes:[stroke]});const canonical=JSON.stringify(stroke),hash=hashText(canonical),negativeZero=stroke.points.some(point=>Object.is(point.x,-0)||Object.is(point.y,-0))||stroke.pressures?.some(value=>Object.is(value,-0));const json=negativeZero?JSON.stringify(stroke,(_key,value)=>typeof value==='number'&&Object.is(value,-0)?JSON.rawJSON('-0'):value):canonical;return {json,hash,bytes:Buffer.byteLength(json),points:stroke.points.length};}
function backgroundRecord(data){
 if(typeof data!=='string'||!/^data:image\/(png|jpeg|webp|gif|bmp|avif|svg\+xml);base64,[a-z0-9+/=\r\n]+$/i.test(data)||Buffer.byteLength(data)>LIMIT)throw Error('Invalid drawing background.');
 const json=JSON.stringify(data);return {json,hash:fingerprint(data),bytes:Buffer.byteLength(json)};
}
function cache(data){
 if(!Array.isArray(data)||!data.length)throw Error('Invalid drawing sheets.');
 const nextStrokes=new Map(),nextBackgrounds=new Map(),strokeObjects=new WeakMap(),backgroundIds=new Map(),nextRows=[];
 for(const sheet of data){
  const meta=metadata(sheet);if(!Array.isArray(sheet.strokes))throw Error('Invalid drawing strokes.');const ids=[];let pointCount=0;
  for(const stroke of sheet.strokes){let id=strokeObjects.get(stroke),record;if(!id){id=nextStroke++;record=strokeRecord(stroke);strokeObjects.set(stroke,id);nextStrokes.set(id,record);}else record=nextStrokes.get(id);pointCount+=record.points;if(pointCount>MAX_POINTS)throw Error('This graphics pane has too many points.');ids.push(id);}
  let backdrop=0;if(sheet.backdrop!=null){backdrop=backgroundIds.get(sheet.backdrop);if(!backdrop){backdrop=nextBackdrop++;backgroundIds.set(sheet.backdrop,backdrop);nextBackgrounds.set(backdrop,backgroundRecord(sheet.backdrop));}}
  nextRows.push({metadata:meta,strokeIds:ids,backdropId:backdrop});
 }return {rows:nextRows,strokes:nextStrokes,backgrounds:nextBackgrounds};
}
async function load(){
 if(loaded)return;const before=await sheetRevision(workerData.file);let data=null;try{data=JSON.parse((await readLimited(workerData.file,LIMIT,'Saved drawing sheets exceed 100 MB.')).toString('utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}const after=await sheetRevision(workerData.file);if(!sameSheetRevision(before,after))throw Error('Saved drawing sheets changed while loading.');fileRevision=after;
 if(data!==null){const next=cache(data);rows=next.rows;strokes=next.strokes;backgrounds=next.backgrounds;hasFile=true;initialModels=data;}loaded=true;
}
// Immutable stroke fragments are encoded once. A checkpoint copies their UTF8 bytes,
// without walking millions of unchanged point objects or building another giant JSON string.
function serialize(state){
 const chunks=[];let length=0;const add=(text,bytes=Buffer.byteLength(text))=>{length+=bytes;if(length>LIMIT)throw Error('Sheet data is too large.');chunks.push(text);};
 add('[');state.rows.forEach((row,index)=>{const prefix=JSON.stringify(row.metadata).slice(0,-1);add((index?',':'')+prefix+',"strokes":[');row.strokeIds.forEach((id,position)=>{if(position)add(',');const record=state.strokes.get(id);add(record.json,record.bytes);});add('],"backdrop":');const background=row.backdropId?state.backgrounds.get(row.backdropId):null;if(background)add(background.json,background.bytes);else add('null');add('}');});add(']');
 const bytes=new Uint8Array(length),target=Buffer.from(bytes.buffer);let offset=0;for(const text of chunks)offset+=target.write(text,offset,'utf8');if(offset!==length)throw Error('Drawing checkpoint encoding failed.');return bytes;
}
function models(){if(initialModels!==undefined){const data=initialModels;initialModels=undefined;return data;}return hasFile?JSON.parse(Buffer.from(serialize({rows,strokes,backgrounds})).toString('utf8')):null;}
function state(){return {session,version,sheets:models(),strokeIds:rows.map(row=>row.strokeIds),strokeHashes:rows.map(row=>row.strokeIds.map(id=>strokes.get(id).hash)),backdropIds:rows.map(row=>row.backdropId),backdropHashes:rows.map(row=>row.backdropId?backgrounds.get(row.backdropId).hash:null)};}
function prepare(next,requestId,extra={}){
 if(candidates.size)throw Error('A drawing checkpoint is already pending.');const bytes=serialize(next),token=randomUUID(),answer={session,version:version+1,requestId,bytes:bytes.length,...extra};candidates.set(token,{next,answer});return {prepared:true,token,bytes,answer,expectedRevision:fileRevision};
}
async function prepareDelta(delta){
 await load();if(!delta||typeof delta!=='object'||typeof delta.requestId!=='string'||!delta.requestId||delta.requestId.length>128)throw Error('Invalid drawing save request.');
 if(recent.has(delta.requestId))return {done:true,answer:{...recent.get(delta.requestId),idempotent:true,currentVersion:version}};
 if(delta.session!==session||delta.baseVersion!==version)return {resync:true,session,version};
 if(delta.unchanged){if(!sameSheetRevision(fileRevision,await sheetRevision(workerData.file)))throw Error('Saved drawing data changed outside this window. Current drawings remain open.');return {done:true,answer:{session,version,requestId:delta.requestId,unchanged:true,bytes:fileRevision?.size||0,addedStrokes:0,addedPoints:0}};}
 if(!Array.isArray(delta.sheets)||!delta.sheets.length||!Array.isArray(delta.addStrokes)||!Array.isArray(delta.addBackdrops))throw Error('Invalid drawing delta.');
 const availableStrokes=delta.full?new Map():new Map(strokes),availableBackgrounds=delta.full?new Map():new Map(backgrounds);let addedPoints=0;
 for(const entry of delta.addStrokes){if(!entry||!validId(entry.id)||availableStrokes.has(entry.id))throw Error('Duplicate drawing stroke identity.');const record=strokeRecord(entry.stroke);addedPoints+=record.points;availableStrokes.set(entry.id,record);}
 for(const entry of delta.addBackdrops){if(!entry||!validId(entry.id)||availableBackgrounds.has(entry.id))throw Error('Duplicate drawing background identity.');availableBackgrounds.set(entry.id,backgroundRecord(entry.data));}
 const nextRows=[],usedStrokes=new Map(),usedBackgrounds=new Map();
 for(const row of delta.sheets){
  if(!row||!Array.isArray(row.strokeIds)||!Number.isSafeInteger(row.backdropId)||row.backdropId<0||!row.metadata||Object.hasOwn(row.metadata,'strokes')||Object.hasOwn(row.metadata,'backdrop'))throw Error('Invalid drawing sheet references.');
  const meta=metadata(row.metadata);let points=0;
  for(const id of row.strokeIds){const record=availableStrokes.get(id);if(!validId(id)||!record)throw Error('Unknown drawing stroke identity.');points+=record.points;if(points>MAX_POINTS)throw Error('This graphics pane has too many points.');usedStrokes.set(id,record);}
  if(row.backdropId){const record=availableBackgrounds.get(row.backdropId);if(!record)throw Error('Unknown drawing background identity.');usedBackgrounds.set(row.backdropId,record);}
  nextRows.push({metadata:meta,strokeIds:row.strokeIds.slice(),backdropId:row.backdropId});
 }return prepare({rows:nextRows,strokes:usedStrokes,backgrounds:usedBackgrounds},delta.requestId,{addedStrokes:delta.addStrokes.length,addedPoints});
}
function commit(value){const token=value.token,candidate=candidates.get(token);if(!candidate)throw Error('Unknown drawing save transaction.');rows=candidate.next.rows;strokes=candidate.next.strokes;backgrounds=candidate.next.backgrounds;version=candidate.answer.version;fileRevision=value.revision;hasFile=true;loaded=true;initialModels=undefined;candidates.delete(token);if(candidate.answer.requestId){recent.set(candidate.answer.requestId,candidate.answer);while(recent.size>16)recent.delete(recent.keys().next().value);}else recent.clear();return candidate.answer;}
let queue=Promise.resolve();
parentPort.on('message',job=>{queue=queue.catch(()=>{}).then(async()=>{try{
 let value;if(job.kind==='loadState'||job.kind==='load'){if(loaded&&!sameSheetRevision(fileRevision,await sheetRevision(workerData.file))){loaded=false;hasFile=false;initialModels=undefined;rows=[];strokes.clear();backgrounds.clear();recent.clear();candidates.clear();session=randomUUID();version=0;}await load();value=job.kind==='loadState'?state():models();}else if(job.kind==='session'){await load();value={session,version};}else if(job.kind==='prepareDelta')value=await prepareDelta(job.value);else if(job.kind==='prepare'){await load();value=prepare(cache(job.value));}else if(job.kind==='commit')value=commit(job.value);else if(job.kind==='abort'){candidates.delete(job.value);value=true;}else throw Error('Invalid drawing persistence operation.');
 if(value?.prepared)parentPort.postMessage({id:job.id,value},[value.bytes.buffer]);else parentPort.postMessage({id:job.id,value});
 }catch(error){parentPort.postMessage({id:job.id,error:error.message});}});});
