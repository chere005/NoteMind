// Run with the packaged Electron runtime in Node mode; fixtures are synthetic or the local raster benchmark fixture.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),z=require('node:zlib'),{performance}=require('node:perf_hooks'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const graphics=require('../src/graphics-pane.js'),{unpack}=require('../src/zip.cjs');
const output=path.resolve('test-results/performance/compression.json'),report={node:process.version,electron:process.versions.electron,zstd:process.versions.zstd,created:new Date().toISOString(),cases:[],limits:{windowLog:22,workers:0},checks:[]};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const codecs=[{name:'raw',encode:data=>data,decode:data=>data},{name:'deflate-1',encode:data=>z.deflateRawSync(data,{level:1}),decode:(data,size)=>z.inflateRawSync(data,{maxOutputLength:size})},...[-3,1,3].map(level=>({name:'zstd-'+level,encode:data=>z.zstdCompressSync(data,{params:{[z.constants.ZSTD_c_compressionLevel]:level,[z.constants.ZSTD_c_checksumFlag]:1,[z.constants.ZSTD_c_windowLog]:22,[z.constants.ZSTD_c_nbWorkers]:0}}),decode:(data,size)=>z.zstdDecompressSync(data,{maxOutputLength:size,params:{[z.constants.ZSTD_d_windowLogMax]:22}})}))];
function measure(run,repeats){const wall=[],cpu=[];let value;for(let i=0;i<repeats;i++){const start=performance.now(),before=process.cpuUsage();value=run();const used=process.cpuUsage(before);wall.push(performance.now()-start);cpu.push((used.user+used.system)/1000);}return {value,medianMs:median(wall),maxMs:Math.max(...wall),medianCpuMs:median(cpu)};}
function scene(noisy,withJSON=false){
 let seed=0x12345678;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;},binary=[],json=[];
 for(let batch=0;batch<100;batch++){
  const strokes=Array.from({length:1000},(_,offset)=>{const i=batch*1000+offset,x=noisy?random()*.95:.001+(i%100)*.009,y=noisy?random()*.95:.001+(Math.floor(i/100)%100)*.009,phase=random()*6.28;return {colorHex:['#aB12Cd','#1C1C1E','#2D7DD2','#ee5533','#32a66a'][i%5],width:noisy?1+random()*4:2.125,points:Array.from({length:20},(_,j)=>({x:x+j*.00005+(noisy?Math.sin(phase+j*.29)*.0003:0),y:y+(noisy?Math.sin(phase+j*.17)*.0008:0)})),pressures:Array.from({length:20},(_,j)=>noisy?.5+.35*Math.sin(phase+j*.2):.3+j*.01)};});
  binary.push(Buffer.from(graphics.encodeBytes({name:'Dense',aspect:1.5,strokes})));if(withJSON)json.push(Buffer.from(JSON.stringify(strokes).slice(1,-1)));
 }
 const bytes=Buffer.concat(binary),legacy=withJSON?Buffer.concat([Buffer.from('[{"name":"Dense","aspect":1.5,"strokes":['),...json.flatMap((part,i)=>i?[Buffer.from(','),part]:[part]),Buffer.from(']}]')]):null;return {bytes,legacy};
}
async function ioRun(root,name,data,codec,repeats){
 const values=[],cpu=[],file=path.join(root,name+'-'+codec.name),expected=hash(data);
 for(let i=0;i<repeats;i++){
  const start=performance.now(),before=process.cpuUsage(),encoded=codec.encode(data),handle=await fs.open(file,'w');try{await handle.writeFile(encoded);await handle.sync();}finally{await handle.close();}
  const restored=codec.decode(await fs.readFile(file),data.length);assert.equal(hash(restored),expected);const used=process.cpuUsage(before);values.push(performance.now()-start);cpu.push((used.user+used.system)/1000);
 }
 await fs.unlink(file);return {medianMs:median(values),maxMs:Math.max(...values),medianCpuMs:median(cpu)};
}
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-compression-'));try{
  const grid=scene(false,true);global.gc?.();const noisy=scene(true);global.gc?.();let archive=await fs.readFile(path.resolve('test-results/performance-0.37/real-raster-fixture/images.nm')),files=unpack(archive),jpeg=Buffer.from(files['assets/scan-0.jpg']);archive=null;files=null;global.gc?.();
  const index=Buffer.alloc(48*1024);let random=0x6b84219;for(let at=0;at<index.length;at+=16){random^=random<<13;random^=random>>>17;random^=random<<5;index.writeUInt32LE(at/16,at);index.writeUInt32LE(random>>>0,at+4);index.writeUInt32LE(at*3,at+8);index.writeUInt32LE((random^0x7349421)>>>0,at+12);}
  const tiny=Buffer.from(graphics.encodeBytes({name:'Append',aspect:1.5,strokes:[{colorHex:'#112233',width:2,points:Array.from({length:20},(_,i)=>({x:.2+i*.001,y:.3})),pressures:Array(20).fill(.7)}]}));
  const cases=[['append',tiny],['index-8KiB',index.subarray(0,8*1024)],['index-48KiB',index],['geometry-grid-512KiB',grid.bytes.subarray(0,512*1024)],['geometry-noisy-512KiB',noisy.bytes.subarray(0,512*1024)],['geometry-noisy-4MiB',noisy.bytes.subarray(0,4*1024*1024)],['legacy-json-4MiB',grid.legacy.subarray(0,4*1024*1024)],['jpeg',jpeg],['jpeg-data-uri',Buffer.from('data:image/jpeg;base64,'+jpeg.toString('base64'))],['geometry-grid-2M-points',grid.bytes],['geometry-noisy-2M-points',noisy.bytes],['legacy-json-2M-points',grid.legacy]];
  for(const [name,data]of cases){
   const row={name,inputBytes:data.length,codecs:[]},large=data.length>8*1024*1024,repeats=large?3:7;
   for(const codec of codecs){
    const encoded=measure(()=>codec.encode(data),repeats),decoded=measure(()=>codec.decode(encoded.value,data.length),repeats);assert.deepEqual(decoded.value,data);
    const result={name:codec.name,bytes:encoded.value.length,ratio:encoded.value.length/data.length,compress:{medianMs:encoded.medianMs,maxMs:encoded.maxMs,cpuMs:encoded.medianCpuMs},decompress:{medianMs:decoded.medianMs,maxMs:decoded.maxMs,cpuMs:decoded.medianCpuMs}};
    if(!large)result.fsyncedRoundtrip=await ioRun(root,name,data,codec,5);row.codecs.push(result);
   }
   report.cases.push(row);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(row));global.gc?.();
  }
  const codec=codecs.find(codec=>codec.name==='zstd-1'),compressed=codec.encode(Buffer.alloc(2*1024*1024));assert.throws(()=>codec.decode(compressed,1024));const corrupt=Buffer.from(compressed);corrupt[corrupt.length-1]^=255;assert.throws(()=>codec.decode(corrupt,2*1024*1024));report.checks.push('Every codec roundtrips exact source bytes','Zstd output cap rejects oversized expansion','Zstd frame checksum rejects corruption');report.memory=process.memoryUsage();report.processMaxRssKiB=process.resourceUsage().maxRSS;await fs.writeFile(output,JSON.stringify(report,null,2));
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
