const zlib=require('node:zlib'),{crc}=require('../../src/scan-png.cjs');
function chunk(type,body){const out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);out.write(type,4);body.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;}
function png(width,height,raw,{depth=8,colour=6,interlace=0,extras=[]}={}){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=depth;h[9]=colour;h[12]=interlace;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),...extras,chunk('IDAT',zlib.deflateSync(Buffer.from(raw))),chunk('IEND',Buffer.alloc(0))]);}
module.exports={png,chunk};
