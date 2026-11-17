// PNG scan decoder: one bounded filtered row, final RGB/alpha channels only.
const zlib=require('node:zlib'),{Readable}=require('node:stream'),limits=require('./scan-limits.js');
const PASSES=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^(0xedb88320&-(value&1));return value>>>0});
function crc(bytes){if(typeof zlib.crc32==='function')return zlib.crc32(bytes);let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
async function decodeScanPNG(bytes,{check=()=>{}}={}){
 const info=await limits.validateBytes(bytes,{signal:{get aborted(){check();return false}}});if(info.mime!=='image/png')throw Error('Expected a scan PNG.');check();
 const {width,height}=info,depth=bytes[24],colour=bytes[25],interlace=bytes[28],channels=({0:1,2:3,3:1,4:2,6:4})[colour];
 if(!channels||!(colour===0?[1,2,4,8,16]:colour===3?[1,2,4,8]:[8,16]).includes(depth)||bytes[26]||bytes[27]||interlace>1)throw Error('Unsupported scan PNG encoding.');
 let palette=null,transparent=null,hasData=false,dataEnded=false,dataStart=-1,dataEnd=-1,compressedBytes=0;
 for(let at=8;at+12<=bytes.length;){check();const length=bytes.readUInt32BE(at),kind=bytes.toString('ascii',at+4,at+8),body=bytes.subarray(at+8,at+8+length);if(crc(bytes.subarray(at+4,at+8+length))!==bytes.readUInt32BE(at+8+length))throw Error('Corrupt scan PNG chunk.');
  if(kind==='acTL'||kind==='fcTL'||kind==='fdAT')throw Error('Animated scan PNG images are not supported.');
  if(kind==='PLTE'){if(colour===0||colour===4||hasData||palette||!length||length%3||length>768)throw Error('Invalid scan PNG palette.');palette=body;}
  else if(kind==='tRNS'){if(hasData||transparent||colour===3&&!palette||!(colour===0&&length===2||colour===2&&length===6||colour===3&&length>0&&length<=256))throw Error('Invalid scan PNG transparency.');transparent=body;}
  else if(kind==='IDAT'){if(dataEnded)throw Error('Noncontiguous scan PNG image data.');hasData=true;compressedBytes+=length;if(dataStart<0)dataStart=at;dataEnd=at+12+length;}
  else if(kind!=='IHDR'&&kind!=='IEND'&&kind.charCodeAt(0)<97)throw Error('Unsupported critical scan PNG chunk.');
  if(hasData&&kind!=='IDAT')dataEnded=true;at+=12+length;
 }
 if(colour===3&&(!palette||palette.length/3>1<<depth||transparent&&transparent.length>palette.length/3))throw Error('Invalid scan PNG palette.');
 const max=depth===16?65535:(1<<depth)-1,bits=channels*depth,bpp=Math.max(1,Math.ceil(bits/8)),passes=(interlace?PASSES:[[0,0,1,1]]).map(([x,y,dx,dy])=>({x,y,dx,dy,w:Math.ceil((width-x)/dx),h:Math.ceil((height-y)/dy)})).filter(p=>p.w>0&&p.h>0);
 const expected=passes.reduce((sum,p)=>sum+(Math.ceil(p.w*bits/8)+1)*p.h,0);if(!Number.isSafeInteger(expected)||expected>136*1024*1024)throw Error('Scan PNG decoded data is too large.');
 const color=require('./scan-color.cjs').readPngColor(bytes,{check}),rgbChannel=new Uint8Array(width*height*3),alphaChannel=new Uint8Array(width*height);let hasAlpha=false,passIndex=0,rowIndex=0,rowOffset=0,decoded=0,previous=null,filtered=null;
 function newRow(){const pass=passes[passIndex];if(pass){const stride=Math.ceil(pass.w*bits/8);filtered=new Uint8Array(stride+1);if(!previous||previous.length!==stride)previous=new Uint8Array(stride);}}
 newRow();
 function placeRow(){
  check();const pass=passes[passIndex],row=filtered.subarray(1),filter=filtered[0];if(filter>4)throw Error('Invalid scan PNG filter.');
  for(let x=0;x<row.length;x++){const a=x>=bpp?row[x-bpp]:0,b=previous[x],c=x>=bpp?previous[x-bpp]:0;row[x]=(row[x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?(a+b)>>1:paeth(a,b,c)))&255;}
  const sample=(x,c)=>{const index=x*channels+c;if(depth===16)return row[index*2]*256+row[index*2+1];if(depth===8)return row[index];const bit=index*depth;return(row[bit>>3]>>(8-depth-(bit&7)))&max},byte=value=>depth===16?value>>>8:depth===8?value:Math.round(value*255/max);
  for(let x=0;x<pass.w;x++){const pixel=(pass.y+rowIndex*pass.dy)*width+pass.x+x*pass.dx,o=pixel*3;let r,g,b,a=255;
   if(colour===3){const index=sample(x,0);if(index*3+2>=palette.length)throw Error('Invalid scan PNG palette index.');r=palette[index*3];g=palette[index*3+1];b=palette[index*3+2];a=transparent&&index<transparent.length?transparent[index]:255;}
   else if(colour===0||colour===4){const gray=sample(x,0);r=g=b=byte(gray);a=colour===4?byte(sample(x,1)):transparent&&gray===transparent.readUInt16BE(0)?0:255;}
   else{const rawR=sample(x,0),rawG=sample(x,1),rawB=sample(x,2);r=byte(rawR);g=byte(rawG);b=byte(rawB);a=colour===6?byte(sample(x,3)):transparent&&rawR===transparent.readUInt16BE(0)&&rawG===transparent.readUInt16BE(2)&&rawB===transparent.readUInt16BE(4)?0:255;}
   rgbChannel[o]=r;rgbChannel[o+1]=g;rgbChannel[o+2]=b;alphaChannel[pixel]=a;if(a!==255)hasAlpha=true;
  }
  previous=row;rowOffset=0;rowIndex++;if(rowIndex===pass.h){passIndex++;rowIndex=0;previous=null;}newRow();
 }
 function* chunks(){for(let at=dataStart;at<dataEnd;){const length=bytes.readUInt32BE(at);for(let offset=0;offset<length;offset+=65536){check();yield bytes.subarray(at+8+offset,at+8+Math.min(length,offset+65536));}at+=12+length;}}
 const input=Readable.from(chunks(),{objectMode:false,highWaterMark:65536}),decoder=zlib.createInflate({chunkSize:65536});input.on('error',error=>decoder.destroy(error));input.pipe(decoder);
 try{for await(const chunk of decoder){check();decoded+=chunk.length;if(decoded>expected)throw Error('Scan PNG pixels exceed its declared dimensions.');for(let at=0;at<chunk.length;){if(!filtered)throw Error('Scan PNG has extra pixels.');const take=Math.min(chunk.length-at,filtered.length-rowOffset);filtered.set(chunk.subarray(at,at+take),rowOffset);at+=take;rowOffset+=take;if(rowOffset===filtered.length)placeRow();}}if(decoder.bytesWritten!==compressedBytes)throw Error('Scan PNG has trailing compressed data.');if(decoded!==expected||passIndex!==passes.length||rowOffset)throw Error('Scan PNG pixels do not match its declared dimensions.');}finally{input.destroy();decoder.destroy();}
 return {width,height,color,bitsPerComponent:8,rgbChannel,alphaChannel:hasAlpha?alphaChannel:undefined};
}
module.exports={decodeScanPNG,crc};
