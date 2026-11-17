const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module');
const zip=require('../src/zip.cjs'),zlib=require('node:zlib'),localRequire=createRequire(require.resolve('../src/archive-version-source.cjs'));
test('private inflate output retires after copying while returned bytes and pooled borrowers survive',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-inflate-owned-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'Exact.nm'),original=Buffer.from('precise output 😀 日本語\n'.repeat(16000));await fs.writeFile(file,zip.pack({'document.md':original}));
 for(const mode of ['success','crc','cancel','pooled']){
  const outputs=[],decoders=[];let abort=false;
  const instrumented={...zlib,createInflateRaw(options){const decoder=zlib.createInflateRaw(options),iterate=decoder[Symbol.asyncIterator].bind(decoder);decoders.push(decoder);decoder[Symbol.asyncIterator]=async function*(){for await(const chunk of iterate()){
   if(mode==='pooled'){for(let at=0;at<chunk.length;at+=1024){const bytes=Buffer.allocUnsafe(Math.min(1024,chunk.length-at));chunk.copy(bytes,0,at,at+bytes.length);outputs.push(bytes);yield bytes;}}
   else{outputs.push(chunk);if(mode==='cancel')abort=true;yield chunk;}
  }};return decoder;}};
  const module={exports:{}};vm.runInNewContext(await fs.readFile(require.resolve('../src/archive-version-source.cjs'),'utf8'),{module,exports:module.exports,require:name=>name==='node:zlib'?instrumented:localRequire(name),Buffer,Uint8Array,Uint32Array,ArrayBuffer,Set,Map,Number,Error,Object,Promise,JSON,Math,BigInt});
  const source=await module.exports.ArchiveSource.open(file,{check(){if(abort)throw Error('injected cancellation');}}),entry=source.files.get('document.md');assert.equal(entry.method,8);if(mode==='crc'){entry.crc^=1;entry.flags|=8;}
  try{if(mode==='crc'||mode==='cancel')await assert.rejects(source.read(entry),mode==='crc'?/Corrupt/:/injected cancellation/);else{const result=await source.read(entry);assert.deepEqual(result.bytes,original);assert.equal(result.bytes.byteLength,original.length);}}
  finally{await source.close();}
  assert.ok(outputs.length);assert.ok(decoders.every(decoder=>decoder.closed));
  if(mode==='pooled'){assert.ok(outputs.every(bytes=>bytes.buffer.byteLength>0));assert.deepEqual(Buffer.concat(outputs),original);}
  else assert.ok(outputs.every(bytes=>bytes.buffer.byteLength===0),'private streamed output cannot retain duplicate uncompressed payloads');
 }
});
