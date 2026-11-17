const {test}=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib'),{PDFDocument,PDFArray,PDFName,PDFDict}=require('pdf-lib');
const {readPngColor,calibration,pdfColorSpace,pngColorChunks,MAX_ICC,cmykColorSpace,jpegProfile}=require('../src/scan-color.cjs'),{decodeScanPNG}=require('../src/scan-png.cjs'),{png,chunk}=require('./helpers/scan-png-fixture.cjs');
function metadataProfile(space='RGB '){const bytes=Buffer.alloc(164);bytes.writeUInt32BE(bytes.length);bytes.write(space,16);bytes.write('XYZ ',20);bytes.write('acsp',36);bytes.writeUInt32BE(1,128);bytes.write('desc',132);bytes.writeUInt32BE(144,136);bytes.writeUInt32BE(20,140);bytes.write('desc',144);return bytes;}
const iccp=profile=>chunk('iCCP',Buffer.concat([Buffer.from('fixture\0\0'),zlib.deflateSync(profile)]));
test('PNG gamma/chromaticities survive into calibrated PDF metadata without changing sample bytes',async()=>{
 for(const value of[10000,100000]){const gamma=Buffer.alloc(4);gamma.writeUInt32BE(value);const bytes=png(1,1,[0,123,45,67,255],{extras:[chunk('gAMA',gamma)]}),image=await decodeScanPNG(bytes);assert.deepEqual([...image.rgbChannel],[123,45,67]);assert.equal(image.color.gamma,value/100000);const cal=calibration(image.color);assert.equal(cal[0],'CalRGB');assert.deepEqual(cal[1].Gamma,[100000/value,100000/value,100000/value]);assert.ok(cal[1].Matrix.every(Number.isFinite));assert.equal(cal[1].WhitePoint[1],1);assert.equal(pngColorChunks(image.color)[0].type,'gAMA');}
});
test('bounded PNG ICC data is independently owned, matches channel count and deduplicates its PDF object',async()=>{
 const expected=metadataProfile(),bytes=png(1,1,[0,12,34,56,255],{extras:[iccp(expected)]}),owned=Buffer.from(Uint8Array.from(bytes).buffer),color=readPngColor(owned);assert.deepEqual(color.icc,expected);assert.ok(color.icc.buffer!==owned.buffer);const doc=await PDFDocument.create(),cache=new Map(),a=pdfColorSpace(doc,color,cache),b=pdfColorSpace(doc,color,cache);assert.ok(a instanceof PDFArray);assert.equal(a.get(0),PDFName.of('ICCBased'));assert.equal(a.get(1),b.get(1));assert.equal(cache.size,1);assert.throws(()=>readPngColor(png(1,1,[0,0],{colour:0,extras:[iccp(expected)]})),/does not match/);
 const gamma=Buffer.alloc(4);gamma.writeUInt32BE(100000);const intent=readPngColor(png(1,1,[0,1,2,3,255],{extras:[chunk('gAMA',gamma),chunk('sRGB',Buffer.from([0]))]}));assert.equal(pdfColorSpace(doc,intent,cache),null);
});
test('malformed or oversized color metadata rejects before decoded pixel allocation',async()=>{
 const bad=metadataProfile();bad.writeUInt32BE(99999,136);await assert.rejects(decodeScanPNG(png(1,1,[0,1,2,3,255],{extras:[iccp(bad)]})),/ICC tag/);await assert.rejects(decodeScanPNG(png(1,1,[0,1,2,3,255],{extras:[iccp(Buffer.alloc(MAX_ICC+1))]})),/4 MiB/);for(const extra of[chunk('gAMA',Buffer.alloc(4)),chunk('cHRM',Buffer.alloc(32)),chunk('sRGB',Buffer.from([4]))])await assert.rejects(decodeScanPNG(png(1,1,[0,1,2,3,255],{extras:[extra]})),/gamma|chromaticities|intent/);
 const duplicate=png(1,1,[0,1,2,3,255],{extras:[iccp(metadataProfile()),iccp(metadataProfile())]});assert.throws(()=>readPngColor(duplicate),/duplicate/);
});
test('unprofiled CMYK emits an explicit subtractive tint function while ICC CMYK remains profile-bound',async()=>{
 const doc=await PDFDocument.create(),cache=new Map(),jpeg=require('./helpers/scan-jpeg-fixture.cjs'),plain=cmykColorSpace(doc,jpeg,cache);assert.equal(plain.get(0),PDFName.of('DeviceN'));const functionStream=doc.context.lookup(plain.get(3));assert.equal(functionStream.dict.get(PDFName.of('FunctionType')).asNumber(),0);assert.equal(functionStream.getContents().length,48);
 const profile=metadataProfile('CMYK'),body=Buffer.concat([Buffer.from('ICC_PROFILE\0'),Buffer.from([1,1]),profile]),segment=Buffer.alloc(4);segment[0]=255;segment[1]=226;segment.writeUInt16BE(body.length+2,2);const bytes=Buffer.concat([jpeg.subarray(0,2),segment,body,jpeg.subarray(2)]);assert.deepEqual(jpegProfile(bytes),profile);const managed=cmykColorSpace(doc,bytes,cache);assert.equal(managed.get(0),PDFName.of('ICCBased'));const stream=doc.context.lookup(managed.get(1));assert.equal(stream.dict.get(PDFName.of('N')).asNumber(),4);
});
test('PDF loading task keeps input ownership and supplies local ICC/font/cmap resources',async()=>{
 const {openPDF}=await import('../src/pdf-loading-task.mjs'),bytes=new Uint8Array([1,2,3]);let options;const task={promise:Promise.resolve()};assert.equal(openPDF({getDocument(value){options=value;return task}},bytes,'secret'),task);assert.equal(options.data,bytes);assert.equal(options.password,'secret');assert.equal(options.useWorkerFetch,true);assert.equal(options.isEvalSupported,false);for(const key of['cMapUrl','standardFontDataUrl','wasmUrl'])assert.ok(options[key].startsWith('file:'));assert.ok(options.wasmUrl.endsWith('/src/vendor/pdfjs/wasm/'));
});

test('chromaticities without a transfer curve keep untagged sample interpretation',async()=>{
 const doc=await PDFDocument.create(),chrm=Buffer.alloc(32);[.3127,.329,.68,.32,.265,.69,.15,.06].forEach((v,i)=>chrm.writeUInt32BE(Math.round(v*100000),i*4));
 const bytes=png(1,1,[0,16,32,48,255],{extras:[chunk('cHRM',chrm)]}),image=await decodeScanPNG(bytes);
 assert.deepEqual([...image.rgbChannel],[16,32,48]);assert.equal(pdfColorSpace(doc,image.color,new Map()),null);assert.deepEqual(pngColorChunks(image.color).map(item=>item.type),['cHRM']);
 const gamma=Buffer.alloc(4);gamma.writeUInt32BE(45455);const explicit=readPngColor(png(1,1,[0,16,32,48,255],{extras:[chunk('cHRM',chrm),chunk('gAMA',gamma)]}));
 assert.equal(pdfColorSpace(doc,explicit,new Map()).get(0),PDFName.of('CalRGB'));
});
