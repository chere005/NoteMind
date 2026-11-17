const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib'),crypto=require('node:crypto');
const source=fs.readFileSync(require.resolve('../src/zip.cjs'),'utf8'),relative=require('node:module').createRequire(require.resolve('../src/zip.cjs'));
function isolated(native=true){let calls=0;const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,Buffer,Uint32Array,require:name=>name==='node:zlib'?{...zlib,crc32:native?zlib.crc32:undefined,deflateRawSync:(bytes,options)=>{if(options?.level!==1)calls++;return zlib.deflateRawSync(bytes,options)}}:relative(name)});return {...module.exports,calls:()=>calls};}
test('unchanged assets reuse compression across renamed archives; mutations and caller buffers stay isolated',()=>{
 const zip=isolated(),data=crypto.randomBytes(4096),original=Buffer.from(data);
 const first=zip.pack({'assets/one.bin':data});zip.pack({'assets/two.bin':data});assert.equal(zip.calls(),1);
 data[0]^=255;const second=zip.pack({'assets/one.bin':data});assert.equal(zip.calls(),2);
 assert.deepEqual(zip.unpack(first)['assets/one.bin'],original);assert.deepEqual(zip.unpack(second)['assets/one.bin'],data);
 first.fill(0);assert.deepEqual(zip.unpack(zip.pack({'assets/one.bin':original}))['assets/one.bin'],original);assert.equal(zip.calls(),2);
});
test('portable CRC fallback creates archives compatible with native CRC and detects corrupted entries',()=>{
 const fallback=isolated(false),native=isolated(),data=crypto.randomBytes(8192),bytes=fallback.pack({'a.bin':data});
 assert.deepEqual(native.unpack(bytes)['a.bin'],data);assert.deepEqual(fallback.unpack(native.pack({'a.bin':data}))['a.bin'],data);
 const end=bytes.length-22,central=bytes.readUInt32LE(end+16);bytes.writeUInt32LE((bytes.readUInt32LE(central+16)^1)>>>0,central+16);assert.throws(()=>fallback.unpack(bytes),/Corrupt/);
});
test('compression cache evicts by entry count and refreshes recently used content',()=>{
 const zip=isolated(),data=Array.from({length:513},()=>crypto.randomBytes(1024));
 for(let i=0;i<512;i++)zip.pack({a:data[i]});zip.pack({a:data[0]});zip.pack({a:data[512]});assert.equal(zip.calls(),513);
 zip.pack({a:data[0]});assert.equal(zip.calls(),513);zip.pack({a:data[1]});assert.equal(zip.calls(),514);
});
test('compression cache cannot retain more than its byte budget',()=>{
 const zip=isolated(),a=crypto.randomBytes(17*1024*1024),b=crypto.randomBytes(17*1024*1024);for(const data of[a,b])for(const at of[0,Math.floor(data.length/2),data.length-4096])data.fill(0,at,at+4096);
 zip.pack({a});zip.pack({b});zip.pack({b});assert.equal(zip.calls(),2);zip.pack({a});assert.equal(zip.calls(),3);
});
test('large compressible input reuses bounded compressed output instead of recompressing every save',()=>{
 const zip=isolated(),data=Buffer.alloc(33*1024*1024,7),first=zip.pack({'assets/large.bin':data});zip.pack({'assets/renamed.bin':data});assert.equal(zip.calls(),1);assert.deepEqual(zip.unpack(first)['assets/large.bin'],data);
});
test('already compressed zstd attachments use compatible ZIP storage without another compression pass',()=>{
 const zip=isolated(),data=zlib.zstdCompressSync(Buffer.alloc(4096,7)),bytes=zip.pack({'assets/source.zst':data});assert.equal(zip.calls(),0);assert.equal(bytes.readUInt16LE(8),0);assert.deepEqual(zip.unpack(bytes)['assets/source.zst'],data);
});
