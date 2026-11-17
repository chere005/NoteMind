const {test}=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {decodeScanPNG,crc}=require('../src/scan-png.cjs');
const {png,chunk}=require('./helpers/scan-png-fixture.cjs');
test('streaming PNG preserves all row filters and opaque/alpha channels',async()=>{
 const pixels=[21,43,65,255,87,109,131,177],prior=[1,2,3,4,5,6,7,8],paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
 for(let filter=0;filter<5;filter++){const filtered=pixels.map((n,x)=>{const a=x>=4?pixels[x-4]:0,b=prior[x],c=x>=4?prior[x-4]:0;return(n-(filter===0?0:filter===1?a:filter===2?b:filter===3?(a+b)>>1:paeth(a,b,c)))&255}),image=await decodeScanPNG(png(2,2,[0,...prior,filter,...filtered]));assert.deepEqual([...image.rgbChannel],[1,2,3,5,6,7,21,43,65,87,109,131]);assert.deepEqual([...image.alphaChannel],[4,8,255,177]);}
 assert.equal((await decodeScanPNG(png(1,1,[0,1,2,3,255]))).alphaChannel,undefined);
});
test('Adam7, packed gray/palette and16-bit transparent RGB preserve exact samples',async()=>{
 const w=9,h=7,pixels=Array.from({length:w*h*4},(_,i)=>i%4===3?255:(i*37)%256),raw=[];for(const[x0,y0,dx,dy]of[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]])for(let y=y0;y<h;y+=dy){if(x0>=w)continue;raw.push(0);for(let x=x0;x<w;x+=dx)raw.push(...pixels.slice((y*w+x)*4,(y*w+x+1)*4));}
 const adam=await decodeScanPNG(png(w,h,raw,{interlace:1}));assert.deepEqual([...adam.rgbChannel],pixels.filter((_,i)=>i%4!==3));assert.equal(adam.alphaChannel,undefined);
 const gray=await decodeScanPNG(png(4,1,[0,0b00011011],{depth:2,colour:0,extras:[chunk('tRNS',Buffer.from([0,2]))]}));assert.deepEqual([...gray.rgbChannel],[0,0,0,85,85,85,170,170,170,255,255,255]);assert.deepEqual([...gray.alphaChannel],[255,255,0,255]);
 const palette=await decodeScanPNG(png(2,1,[0,0b01000000],{depth:1,colour:3,extras:[chunk('PLTE',Buffer.from([10,20,30,40,50,60])),chunk('tRNS',Buffer.from([255,17]))]}));assert.deepEqual([...palette.rgbChannel],[10,20,30,40,50,60]);assert.deepEqual([...palette.alphaChannel],[255,17]);
 const rgb16=await decodeScanPNG(png(2,1,[0,0x12,0x34,0x56,0x78,0x9a,0xbc,0xff,0xff,0,0,0x80,0],{depth:16,colour:2,extras:[chunk('tRNS',Buffer.from([0x12,0x34,0x56,0x78,0x9a,0xbc]))]}));assert.deepEqual([...rgb16.rgbChannel],[0x12,0x56,0x9a,255,0,128]);assert.deepEqual([...rgb16.alphaChannel],[0,255]);
});
test('malformed, animated and oversized PNGs reject without unbounded inflation',async()=>{
 const valid=png(1,1,[0,1,2,3,255]),bad=Buffer.from(valid);bad[bad.length-1]^=128;await assert.rejects(decodeScanPNG(bad),/Corrupt/);await assert.rejects(decodeScanPNG(png(1,1,Array(100000).fill(0))),/exceed/);await assert.rejects(decodeScanPNG(png(1,1,[0,1])),/match/);await assert.rejects(decodeScanPNG(png(1,1,[0,1,2,3,255],{extras:[chunk('acTL',Buffer.alloc(8))]})),/Animated/);await assert.rejects(decodeScanPNG(png(5000,5000,[0])),/16 Mi pixel/);
 await assert.rejects(decodeScanPNG(png(1,1,[0,128],{depth:1,colour:3,extras:[chunk('PLTE',Buffer.from([1,2,3]))]})),/palette index/);
});
test('cancellation stops row work and does not return partially decoded channels',async()=>{
 let checks=0;await assert.rejects(decodeScanPNG(png(1,10,Array.from({length:10},()=>[0,1,2,3,255]).flat()),{check(){if(++checks>7)throw Object.assign(Error('Cancelled'),{name:'AbortError'})}}),{name:'AbortError'});assert.ok(checks<20);
});
test('many empty/tiny IDAT chunks stream without a retained chunk graph and require contiguous data',async()=>{
 const valid=png(1,1,[0,1,2,3,255]),size=valid.readUInt32BE(33),data=valid.subarray(41,41+size),prefix=valid.subarray(0,33),tail=valid.subarray(45+size),chunks=[];for(let i=0;i<3000;i++)chunks.push(chunk('IDAT',Buffer.alloc(0)));for(const value of data)chunks.push(chunk('IDAT',Buffer.from([value])));const decoded=await decodeScanPNG(Buffer.concat([prefix,...chunks,tail]));assert.deepEqual([...decoded.rgbChannel],[1,2,3]);await assert.rejects(decodeScanPNG(Buffer.concat([prefix,chunk('IDAT',data.subarray(0,1)),chunk('tEXt',Buffer.from('x')),chunk('IDAT',data.subarray(1)),tail])),/Noncontiguous/);
 for(const options of[{colour:0,extras:[chunk('PLTE',Buffer.from([1,2,3]))]},{colour:3,extras:[chunk('tRNS',Buffer.from([0])),chunk('PLTE',Buffer.from([1,2,3]))]}])await assert.rejects(decodeScanPNG(png(1,1,[0,0],options)),/palette|transparency/);
});
test('packed Adam7 grayscale uses exact pass coordinates and transparent black remains transparent',async()=>{
 const w=9,h=7,passes=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
 for(const depth of[1,2,4]){const max=(1<<depth)-1,raw=[],expectedRGB=[],expectedAlpha=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++){const value=(x*3+y*5)&max,byte=Math.round(value*255/max);expectedRGB.push(byte,byte,byte);expectedAlpha.push(value===0?0:255);}for(const[x0,y0,dx,dy]of passes){const pw=Math.ceil((w-x0)/dx);if(pw<=0)continue;for(let y=y0;y<h;y+=dy){const row=Buffer.alloc(Math.ceil(pw*depth/8));for(let x=x0,i=0;x<w;x+=dx,i++){const bit=i*depth;row[bit>>3]|=((x*3+y*5)&max)<<(8-depth-(bit&7));}raw.push(0,...row);}}const result=await decodeScanPNG(png(w,h,raw,{depth,colour:0,interlace:1,extras:[chunk('tRNS',Buffer.from([0,0]))]}));assert.deepEqual([...result.rgbChannel],expectedRGB);assert.deepEqual([...result.alphaChannel],expectedAlpha);}
});
test('PNG requires one complete zlib stream without trailing junk or another member',async()=>{
 const valid=png(1,1,[0,1,2,3,255]),length=valid.readUInt32BE(33),compressed=valid.subarray(41,41+length),tail=valid.subarray(45+length);for(const extra of[Buffer.from('trailing'),zlib.deflateSync(Buffer.from([0,1,2,3,255]))])await assert.rejects(decodeScanPNG(Buffer.concat([valid.subarray(0,33),chunk('IDAT',Buffer.concat([compressed,extra])),tail])),/trailing compressed/);
});
