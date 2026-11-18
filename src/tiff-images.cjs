const UTIF=require('utif'),zlib=require('node:zlib'),{isMarkedAsUntransferable}=require('node:worker_threads');
const table=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function backing(value){return value instanceof ArrayBuffer?value:value?.buffer;}
function retire(value,borrowed){const buffer=backing(value);if(!(buffer instanceof ArrayBuffer)||buffer===borrowed||isMarkedAsUntransferable?.(buffer))return;try{buffer.transfer?.(0);}catch{}}
function crc(bytes){if(zlib.crc32)return zlib.crc32(bytes)>>>0;let value=0xffffffff;for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
function writeChunk(output,at,type,data){output.writeUInt32BE(data.length,at);output.write(type,at+4,4,'ascii');data.copy(output,at+8);output.writeUInt32BE(crc(output.subarray(at+4,at+8+data.length)),at+8+data.length);return at+12+data.length;}
// rgba is private conversion scratch. Consume it only after all rows have copied;
// zlib's synchronous call has completed before its possibly partial output retires.
function png(rgba,width,height,consume){let rows,compressed,header,output;try{rows=Buffer.allocUnsafeSlow((width*4+1)*height);const view=Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength),stride=width*4+1;for(let y=0;y<height;y++){rows[y*stride]=0;view.copy(rows,y*stride+1,y*width*4,(y+1)*width*4);}consume(rgba);try{compressed=zlib.deflateSync(rows);}finally{retire(rows);rows=null;}header=Buffer.allocUnsafeSlow(13);header.fill(0);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;output=Buffer.allocUnsafeSlow(8+25+12+compressed.length+12);output.set([137,80,78,71,13,10,26,10]);let at=writeChunk(output,8,'IHDR',header);at=writeChunk(output,at,'IDAT',compressed);writeChunk(output,at,'IEND',Buffer.alloc(0));const result=output;output=null;return result;}finally{retire(rows);retire(compressed);retire(header);retire(output);}}
function tiffToPng(bytes){
 const borrowed=bytes.buffer,owned=new Set(),own=value=>{const buffer=backing(value);if(buffer instanceof ArrayBuffer&&buffer!==borrowed)owned.add(buffer);return value;},consume=value=>retire(value,borrowed);let page;
 try{const input=own(new Uint8Array(bytes.byteLength));input.set(bytes);const buffer=input.buffer;page=UTIF.decode(buffer)[0];if(!page)throw Error('The Word TIFF image contains no image.');
  const width=page.t256?.[0],height=page.t257?.[0],orientation=page.t274?.[0]||1;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000)throw Error('Word TIFF images must contain at most 40 million pixels.');
  try{UTIF.decodeImage(buffer,page);}finally{own(page.data);}const rgba=own(UTIF.toRGBA8(page));if(rgba.length!==width*height*4)throw Error('The Word TIFF image could not be decoded.');
  // All metadata needed below is scalar; neither TIFF bytes nor decoded samples
  // are consulted after RGBA conversion, including an aliased private backing.
  if(backing(page.data)!==backing(rgba))consume(page.data);if(buffer!==backing(rgba))consume(buffer);
  if(orientation===1)return png(rgba,width,height,consume);
  const turned=orientation>=5&&orientation<=8,outWidth=turned?height:width,outHeight=turned?width:height,out=own(new Uint8Array(rgba.length));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){let dx=x,dy=y;if(orientation===2)dx=width-1-x;else if(orientation===3){dx=width-1-x;dy=height-1-y;}else if(orientation===4)dy=height-1-y;else if(orientation===5){dx=y;dy=x;}else if(orientation===6){dx=height-1-y;dy=x;}else if(orientation===7){dx=height-1-y;dy=width-1-x;}else if(orientation===8){dx=y;dy=width-1-x;}const from=(y*width+x)*4,to=(dy*outWidth+dx)*4;out[to]=rgba[from];out[to+1]=rgba[from+1];out[to+2]=rgba[from+2];out[to+3]=rgba[from+3];}
  consume(rgba);return png(out,outWidth,outHeight,consume);
 }finally{for(const buffer of owned)consume(buffer);}
}
module.exports={tiffToPng};
