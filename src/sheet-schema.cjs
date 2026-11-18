const graphics=require('./graphics-pane.js'),{hashText,hashWriter,removeSuffix}=require('./stroke-signature.js');
const validId=id=>Number.isSafeInteger(id)&&id>0;
function metadata(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.name!=='string')throw Error('Invalid drawing sheet.');
 if(value.paper!=null&&(!['blank','dots','lines','grid','isometric','cornell'].includes(value.paper.kind)||!['small','medium','large'].includes(value.paper.spacing)||!['white','cream','dark'].includes(value.paper.colour)))throw Error('Invalid drawing paper.');
 graphics.validate({...value,strokes:[],backdrop:null});const result={...value};for(const key of ['strokes','backdrop','pageId','geometryRevision','loaded'])delete result[key];if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw Error('Drawing metadata is too large.');return result;
}
const nonunit=extent=>extent&&(extent.x!==0||extent.y!==0||extent.width!==1||extent.height!==1);
const suffix=(meta,backdropHash)=>'],'+JSON.stringify([backdropHash,JSON.stringify(meta.paper),...(nonunit(meta.extent)?[JSON.stringify(meta.extent)]:[])]).slice(1);
function signatureWriter(meta,backdropHash){const value=hashWriter().write('['+JSON.stringify(meta.name)+','+JSON.stringify(meta.aspect)+',[');let at=0;return{add:record=>value.write(at++?',"':'"').write(record.hash).write('"'),addWords:(high,low)=>value.write(at++?',"':'"').writeHexWords(high,low).write('"'),finish:()=>'nm2:'+value.write(suffix(meta,backdropHash)).digest()};}
async function signature(meta,root,index,backdropHash,options={}){const check=()=>{if(options.signal?.aborted)throw Object.assign(Error('Drawing signature cancelled.'),{name:'AbortError'});options.work?.check();};check();const value=signatureWriter(meta,backdropHash);if(typeof index.visitFingerprintWords==='function')await index.visitFingerprintWords(root,(high,low)=>value.addWords(high,low),options);else for await(const record of index.records(root,undefined,options)){check();value.add(record);}check();return value.finish();}
function appendSignature(meta,old,records,backdropHash){if(meta.name!==old.metadata.name||meta.aspect!==old.metadata.aspect)return null;let value=removeSuffix(old.signature.slice(4),suffix(old.metadata,old.backdrop?.hash||null)),count=old.order.count;for(const record of records)value=hashText((count++?',':'')+JSON.stringify(record.hash),value);return 'nm2:'+hashText(suffix(meta,backdropHash),value);}
module.exports={metadata,validId,signature,signatureWriter,appendSignature,suffix,nonunit};
