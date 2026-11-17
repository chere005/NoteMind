const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),{pack,unpack}=require('../src/zip.cjs');
const method=archive=>archive.readUInt16LE(8);
test('already compressed image payloads use standard ZIP storage without changing bytes',()=>{
 const png=fs.readFileSync('test/fixtures/ocr-english.png'),archive=pack({'assets/scan.png':png});assert.equal(method(archive),0);assert.deepEqual(unpack(archive)['assets/scan.png'],png);
});
test('incompressible payloads beyond the compression cache budget avoid repeated full compression',()=>{
 const data=crypto.randomBytes(1024*1024),a=pack({a:data}),b=pack({b:data});assert.equal(method(a),0);assert.equal(method(b),0);assert.deepEqual(unpack(a).a,data);assert.deepEqual(unpack(b).b,data);
});
test('compressible text still uses deflate and store decisions never replace CRC integrity checks',()=>{
 const data=Buffer.from('text and metadata '.repeat(10000)),archive=pack({'document.md':data});assert.equal(method(archive),8);assert.ok(archive.length<data.length/10);assert.deepEqual(unpack(archive)['document.md'],data);
 const binary=pack({a:crypto.randomBytes(1024*1024)});binary[31]^=1;assert.throws(()=>unpack(binary),/Corrupt/);
});
