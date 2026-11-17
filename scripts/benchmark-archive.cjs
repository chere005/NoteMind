// Deterministic archive workload; never reads or opens a user's Notepad.
const {performance}=require('node:perf_hooks'),format=require('../src/notepad-format.cjs');
const assets={};let seed=0x12345678;
for(let image=0;image<48;image++){
 const bytes=Buffer.alloc(384*1024);for(let i=0;i<bytes.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bytes[i]=seed&255;}
 assets['assets/page-'+image+'.bin']=bytes.toString('base64');
}
const doc={id:'archive-benchmark',text:'# Archive benchmark\n',assets,meta:{},created:'2026-01-01T00:00:00.000Z'},samples=[];
let last;
for(let edit=0;edit<4;edit++){
 const start=performance.now(),cpu=process.cpuUsage();last=format.encode({...doc,text:doc.text+edit});const used=process.cpuUsage(cpu);
 samples.push({edit,ms:+(performance.now()-start).toFixed(2),cpuMs:+((used.user+used.system)/1000).toFixed(2),archiveBytes:last.length});
}
const start=performance.now(),decoded=format.decode(last);
if(Object.keys(decoded.assets).length!==48||decoded.text!==doc.text+'3')throw Error('Archive roundtrip failed.');
console.log(JSON.stringify({node:process.version,assetBytes:48*384*1024,samples,decodeMs:+(performance.now()-start).toFixed(2)},null,2));
