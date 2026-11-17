// Decode a persisted PNG data URI without ever materializing its full ASCII string.
const PREFIX='data:image/png;base64,',MAX_BYTES=200*1024*1024,CHARS=64*1024;
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^(0xedb88320&-(value&1));return value>>>0;});
const digit=code=>code>=65&&code<=90?code-65:code>=97&&code<=122?code-71:code>=48&&code<=57?code+4:code===43?62:code===47?63:-1;
function check(signal){if(signal?.aborted){const error=Error('Camera picture loading cancelled.');error.name='AbortError';throw error;}}
function dimensions(bytes){
 const magic=[137,80,78,71,13,10,26,10];if(bytes.length<33||!magic.every((value,index)=>bytes[index]===value))throw Error('Invalid camera PNG header.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(8)!==13||view.getUint32(12)!==0x49484452)throw Error('Invalid camera PNG header.');
 const width=view.getUint32(16),height=view.getUint32(20),depth=bytes[24],colour=bytes[25],validDepth=colour===0?[1,2,4,8,16]:colour===2||colour===4||colour===6?[8,16]:colour===3?[1,2,4,8]:[];
 if(!width||!height||width>32768||height>32768||width*height>16*1024*1024||!validDepth.includes(depth)||bytes[26]!==0||bytes[27]!==0||bytes[28]>1)throw Error('Invalid camera PNG dimensions or format.');
 let crc=0xffffffff;for(let at=12;at<29;at++)crc=crcTable[(crc^bytes[at])&255]^(crc>>>8);if(((crc^0xffffffff)>>>0)!==view.getUint32(29))throw Error('Invalid camera PNG header checksum.');return {width,height};
}
async function preparePNGBytes(bytes,{signal,yieldControl=require('./graphics-pane.js').yieldTask}={}){
 check(signal);if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_BYTES||bytes.byteLength<PREFIX.length+44)throw Error('Invalid camera picture bytes.');
 for(let at=0;at<PREFIX.length;at++)if(bytes[at]!==PREFIX.charCodeAt(at))throw Error('Invalid camera PNG data prefix.');
 const length=bytes.byteLength-PREFIX.length;if(length%4)throw Error('Invalid camera PNG base64 length.');
 const end=bytes.byteLength,padding=bytes[end-1]===61?(bytes[end-2]===61?2:1):0,decodedLength=length/4*3-padding,parts=[];
 let size=0,shape;const decoder=typeof TextDecoder==='function'?new TextDecoder('utf-8',{fatal:true}):null;
 try{
  check(signal);await yieldControl();check(signal);
  for(let at=PREFIX.length;at<end;at+=CHARS){
   check(signal);const stop=Math.min(end,at+CHARS),chunk=bytes.subarray(at,stop);
   for(let offset=at;offset<stop;offset++)if(offset<end-padding?digit(bytes[offset])<0:bytes[offset]!==61)throw Error('Invalid camera PNG base64 data.');
   if(stop===end&&padding){const value=digit(bytes[end-padding-1]);if(value<0||value&(padding===2?15:3))throw Error('Noncanonical camera PNG base64 padding.');}
   const ascii=decoder?decoder.decode(chunk):String.fromCharCode(...chunk);let part;
   if(typeof Uint8Array.fromBase64==='function')part=Uint8Array.fromBase64(ascii,{alphabet:'base64',lastChunkHandling:'strict'});
   else{const raw=globalThis.atob(ascii);part=new Uint8Array(raw.length);for(let index=0;index<raw.length;index++)part[index]=raw.charCodeAt(index);}
   if(!parts.length)shape=dimensions(part);size+=part.byteLength;if(size>decodedLength)throw Error('Invalid camera PNG decoded length.');parts.push(part);await yieldControl();check(signal);
  }
  if(size!==decodedLength)throw Error('Invalid camera PNG decoded length.');check(signal);const blob=new Blob(parts,{type:'image/png'});parts.length=0;return {blob,...shape};
 }finally{parts.length=0;}
}
module.exports={preparePNGBytes};
