const {yieldTask}=require('./graphics-pane.js'),MAX_BYTES=50*1024*1024;
const abort=()=>Object.assign(Error('Scan image preparation cancelled.'),{name:'AbortError'});
function check(signal){if(signal?.aborted)throw abort();}
async function scanImageBlob(data,type,{chunks,signal,yieldControl=yieldTask}={}){
 check(signal);if(typeof data!=='string'||!/^image\/(png|jpeg|gif|webp|bmp|avif|svg\+xml)$/.test(type))throw Error('Choose a supported scan image.');
 if(chunks!==undefined&&(!Array.isArray(chunks)||chunks.length>32768||chunks.some(part=>typeof part!=='string')))throw Error('Invalid scan image chunks.');
 const length=chunks?chunks.reduce((size,part)=>size+part.length,0):data.length;if(!length||length!==data.length||length%4||length>4*Math.ceil(MAX_BYTES/3))throw Error('A scan image must be 50 MiB or smaller.');
 const parts=[];let carry='',padded=false,bytes=0;
 try{
  const sources=chunks||[data];
  for(const source of sources)for(let at=0;at<source.length;at+=65536){
   check(signal);const combined=carry+source.slice(at,at+65536);if(padded||!/^[A-Za-z0-9+/]*={0,2}$/.test(combined))throw Error('Invalid scan image encoding.');const size=Math.floor(combined.length/4)*4,part=combined.slice(0,size);carry=combined.slice(size);
   if(part){if(part.includes('=')&&carry)throw Error('Invalid scan image encoding.');let decoded;if(typeof Uint8Array.fromBase64==='function')decoded=Uint8Array.fromBase64(part,{lastChunkHandling:'strict'});else{const raw=atob(part);decoded=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)decoded[i]=raw.charCodeAt(i);const tail=part.endsWith('==')?2:part.endsWith('=')?1:0;if(tail&&'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(part[part.length-tail-1])&(tail===2?15:3))throw Error('Invalid scan image padding.');}padded=part.endsWith('=');bytes+=decoded.length;if(bytes>MAX_BYTES)throw Error('A scan image must be 50 MiB or smaller.');parts.push(decoded);}
   await yieldControl();check(signal);
  }
  if(carry||!bytes)throw Error('Invalid scan image encoding.');return new Blob(parts,{type});
 }finally{parts.length=0;}
}
module.exports={scanImageBlob};
