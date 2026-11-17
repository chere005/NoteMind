// Isolated synthetic history benchmark; never reads or changes a user's documents.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {NotesStore}=require('../src/notes-store.cjs'),codec=require('../src/archive-codec.cjs');
const assetKiB=Number(process.argv[2]||512),versions=Number(process.argv[3]||12);
if(!Number.isSafeInteger(assetKiB)||assetKiB<1||assetKiB>192*1024||!Number.isSafeInteger(versions)||versions<1||versions>200)throw Error('Choose 1–196608 KiB of assets and 1–200 versions.');
async function bytesIn(folder){let total=0;for(const item of await fs.readdir(folder,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){const file=path.join(folder,item.name);total+=item.isDirectory()?await bytesIn(file):(await fs.stat(file)).size;}return total;}
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-version-benchmark-'));try{
  const assets={};let remaining=assetKiB*1024,index=0;while(remaining){const size=Math.min(remaining,8*1024*1024);assets['assets/page-'+(index++)+'.bin']=randomBytes(size).toString('base64');remaining-=size;}
  const store=new NotesStore(root),doc=await store.register({text:'Benchmark',assets,meta:{}}),timings=[];
  for(let i=0;i<versions;i++){const start=performance.now();await store.version({...doc,text:'Edited text '+i},'Autosaved');timings.push(+(performance.now()-start).toFixed(2));}
  const entries=await store.versions(doc.id),objectBytes=await bytesIn(path.join(root,'objects')),versionBytes=await bytesIn(path.join(root,'versions'));
  for(const entry of [entries[0],entries.at(-1)]){const restored=await store.versionDoc(doc.id,entry.id);if(Object.keys(restored.assets).length!==Object.keys(assets).length||Object.entries(assets).some(([name,data])=>restored.assets[name]!==data))throw Error('History restoration changed assets.');}
  console.log(JSON.stringify({node:process.version,assetBytes:assetKiB*1024,versions:entries.length,firstVersionMs:timings[0],laterVersionMs:timings.slice(1),objectBytes,versionBytes,totalHistoryBytes:objectBytes+versionBytes},null,2));
 }finally{await codec.dispose();await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
