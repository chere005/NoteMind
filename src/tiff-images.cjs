const UTIF=require('utif'),{deflateSync}=require('node:zlib');
const table=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data){const name=Buffer.from(type),body=Buffer.concat([name,data]),out=Buffer.alloc(body.length+8);out.writeUInt32BE(data.length);body.copy(out,4);let crc=0xffffffff;for(const byte of body)crc=table[(crc^byte)&255]^(crc>>>8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
function png(rgba,width,height){const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(rows,y*(width*4+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
function tiffToPng(bytes){
 const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),page=UTIF.decode(buffer)[0];
 if(!page)throw Error('The Word TIFF image contains no image.');
 const width=page.t256?.[0],height=page.t257?.[0];if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000)throw Error('Word TIFF images must contain at most 40 million pixels.');
 UTIF.decodeImage(buffer,page);const rgba=UTIF.toRGBA8(page);if(rgba.length!==width*height*4)throw Error('The Word TIFF image could not be decoded.');
 const orientation=page.t274?.[0]||1;if(orientation===1)return png(rgba,width,height);
 const turned=orientation>=5&&orientation<=8,outWidth=turned?height:width,outHeight=turned?width:height,out=new Uint8Array(rgba.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let dx=x,dy=y;if(orientation===2)dx=width-1-x;else if(orientation===3){dx=width-1-x;dy=height-1-y;}else if(orientation===4)dy=height-1-y;else if(orientation===5){dx=y;dy=x;}else if(orientation===6){dx=height-1-y;dy=x;}else if(orientation===7){dx=height-1-y;dy=width-1-x;}else if(orientation===8){dx=y;dy=width-1-x;}out.set(rgba.subarray((y*width+x)*4,(y*width+x+1)*4),(dy*outWidth+dx)*4);}
 return png(out,outWidth,outHeight);
}
module.exports={tiffToPng};
