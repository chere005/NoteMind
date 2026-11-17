// PNG color definitions follow W3C PNG3 §11.3.2; PDF uses ISO32000 §8.6.5.
const zlib=require('node:zlib'),{createHash}=require('node:crypto');
const MAX_ICC=4*1024*1024;
function profile(bytes,expected){
 if(bytes.length<132||bytes.length>MAX_ICC||bytes.readUInt32BE(0)!==bytes.length||bytes.toString('ascii',36,40)!=='acsp')throw Error('Invalid scan ICC profile.');const space=bytes.toString('ascii',16,20),components=space==='GRAY'?1:space==='RGB '?3:space==='CMYK'?4:0;if(!components||components!==expected)throw Error('Scan ICC profile does not match its image.');const count=bytes.readUInt32BE(128);if(!count||count>4096||132+count*12>bytes.length)throw Error('Invalid scan ICC tag table.');for(let i=0;i<count;i++){const at=132+i*12,offset=bytes.readUInt32BE(at+4),length=bytes.readUInt32BE(at+8);if(offset<132||length<8||offset+length>bytes.length)throw Error('Invalid scan ICC tag.');}return{icc:bytes,components};
}
function readPngColor(bytes,{check=()=>{}}={}){
 let gamma=null,chrm=null,srgb=null,icc=null,ended=false;const colour=bytes[25];
 for(let at=8;at+12<=bytes.length;){check();const length=bytes.readUInt32BE(at),kind=bytes.toString('ascii',at+4,at+8),body=bytes.subarray(at+8,at+8+length);if(kind==='PLTE'||kind==='IDAT')ended=true;
  if(['gAMA','cHRM','sRGB','iCCP'].includes(kind)){if(ended)throw Error('Scan PNG color metadata is out of order.');
   if(kind==='gAMA'){if(gamma!==null||length!==4||!body.readUInt32BE(0))throw Error('Invalid scan PNG gamma.');gamma=body.readUInt32BE(0)/100000;}
   else if(kind==='cHRM'){if(chrm||length!==32)throw Error('Invalid scan PNG chromaticities.');chrm=[];for(let i=0;i<8;i++)chrm.push(body.readUInt32BE(i*4)/100000);for(let i=0;i<8;i+=2)if(chrm[i]<0||chrm[i+1]<=0||chrm[i]+chrm[i+1]>1)throw Error('Invalid scan PNG chromaticities.');}
   else if(kind==='sRGB'){if(srgb!==null||icc||length!==1||body[0]>3)throw Error('Invalid scan PNG sRGB intent.');srgb=body[0];}
   else{if(icc||srgb!==null)throw Error('Invalid duplicate scan PNG profile.');const zero=body.subarray(0,80).indexOf(0);if(zero<1||zero>79||zero+2>=body.length||body[zero+1]!==0)throw Error('Invalid compressed scan ICC profile.');let decoded;try{const compressed=body.subarray(zero+2),result=zlib.inflateSync(compressed,{maxOutputLength:MAX_ICC,info:true});if(result.engine.bytesWritten!==compressed.length)throw Error('Trailing ICC profile data.');decoded=result.buffer;}catch{throw Error('Scan ICC profile is invalid or exceeds 4 MiB.');}icc=profile(decoded,[0,4].includes(colour)?1:3);}
  }at+=12+length;
 }
 if(!icc&&srgb===null&&gamma===null&&!chrm)return null;const result={...icc,gamma,chrm,srgb};if(!icc&&srgb===null)calibration(result);return result;
}
function calibration(color){
 const c=color.chrm||[.3127,.329,.64,.33,.3,.6,.15,.06],white=[c[0]/c[1],1,(1-c[0]-c[1])/c[1]],columns=[];for(let i=2;i<8;i+=2)columns.push([c[i]/c[i+1],1,(1-c[i]-c[i+1])/c[i+1]]);const determinant=m=>m[0][0]*(m[1][1]*m[2][2]-m[2][1]*m[1][2])-m[1][0]*(m[0][1]*m[2][2]-m[2][1]*m[0][2])+m[2][0]*(m[0][1]*m[1][2]-m[1][1]*m[0][2]),base=determinant(columns);if(!Number.isFinite(base)||Math.abs(base)<1e-12)throw Error('Invalid scan PNG color primaries.');const matrix=[];for(let i=0;i<3;i++){const replaced=columns.slice();replaced[i]=white;const scale=determinant(replaced)/base;for(const value of columns[i])matrix.push(value*scale);}const gamma=color.gamma===null||color.gamma===undefined?2.2:1/color.gamma;if(!matrix.every(Number.isFinite)||!Number.isFinite(gamma)||gamma<=0)throw Error('Invalid scan PNG calibration.');return['CalRGB',{WhitePoint:white,Gamma:[gamma,gamma,gamma],Matrix:matrix}];
}
function pdfColorSpace(doc,color,cache){
 if(!color||color.srgb!==null&&color.srgb!==undefined)return null;
 if(color.icc){const hash=createHash('sha256').update(color.icc).digest('hex');let ref=cache.get(hash);if(!ref){ref=doc.context.register(doc.context.flateStream(color.icc,{N:color.components,Alternate:color.components===1?'DeviceGray':color.components===4?'DeviceCMYK':'DeviceRGB'}));cache.set(hash,ref);}return doc.context.obj(['ICCBased',ref]);}
 // Chromaticities alone do not define a transfer curve. Chromium leaves these
 // samples untagged; inventing gamma2.2 changes dark scans and their previews.
 if(color.gamma===null||color.gamma===undefined)return null;
 return doc.context.obj(calibration(color));
}
function pngColorChunks(color){
 if(!color)return[];if(color.icc)return[{type:'iCCP',bytes:Buffer.concat([Buffer.from('NoteMind\0\0'),zlib.deflateSync(color.icc)])}];if(color.srgb!==null&&color.srgb!==undefined)return[{type:'sRGB',bytes:Buffer.from([color.srgb])}];const chunks=[];if(color.gamma!==null&&color.gamma!==undefined){const bytes=Buffer.alloc(4);bytes.writeUInt32BE(Math.round(color.gamma*100000));chunks.push({type:'gAMA',bytes});}if(color.chrm){const bytes=Buffer.alloc(32);color.chrm.forEach((value,i)=>bytes.writeUInt32BE(Math.round(value*100000),i*4));chunks.push({type:'cHRM',bytes});}return chunks;
}
function jpegProfile(bytes){
 const parts=new Map();let count=0,total=0;for(let at=2;at+4<=bytes.length;){if(bytes[at++]!==255)throw Error('Invalid scan JPEG marker.');while(bytes[at]===255)at++;const marker=bytes[at++];if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;const length=bytes.readUInt16BE(at),end=at+length;if(length<2||end>bytes.length)throw Error('Invalid scan JPEG segment.');if(marker===226&&length>=16&&bytes.toString('ascii',at+2,at+14)==='ICC_PROFILE\0'){const index=bytes[at+14],expected=bytes[at+15];if(!index||!expected||index>expected||count&&count!==expected||parts.has(index))throw Error('Invalid JPEG ICC segments.');count=expected;const part=bytes.subarray(at+16,end);total+=part.length;if(total>MAX_ICC)throw Error('Scan ICC profile exceeds 4 MiB.');parts.set(index,part);}at=end;}
 if(!count)return null;if(parts.size!==count)throw Error('Incomplete JPEG ICC profile.');return Buffer.concat(Array.from({length:count},(_,i)=>parts.get(i+1)),total);
}
function cmykColorSpace(doc,bytes,cache){
 const icc=jpegProfile(bytes);if(icc)return pdfColorSpace(doc,profile(icc,4),cache);
 // Unprofiled JPEG decoders use the standard subtractive C/M/Y×K mapping.
 // A sampled DeviceN tint function preserves that RGB appearance, rather than
 // substituting a printer's DeviceCMYK gamut. JPEG data stays byte-for-byte.
 const samples=[];for(let k=0;k<2;k++)for(let y=0;y<2;y++)for(let m=0;m<2;m++)for(let c=0;c<2;c++)samples.push((1-c)*(1-k)*255,(1-m)*(1-k)*255,(1-y)*(1-k)*255);const functionRef=doc.context.register(doc.context.stream(Uint8Array.from(samples),{FunctionType:0,Domain:[0,1,0,1,0,1,0,1],Range:[0,1,0,1,0,1],Size:[2,2,2,2],BitsPerSample:8,Order:1}));return doc.context.obj(['DeviceN',['Cyan','Magenta','Yellow','Black'],'DeviceRGB',functionRef]);
}
module.exports={MAX_ICC,readPngColor,pdfColorSpace,pngColorChunks,calibration,jpegProfile,cmykColorSpace};
