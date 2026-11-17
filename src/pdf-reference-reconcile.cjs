const fs=require('node:fs/promises'),path=require('node:path'),{digest}=require('./pdf-ink-store.cjs');
// Only references with an existing recovery identity are decoded/hashed. The
// public note's current source and revision remain the authority for adoption.
async function reconcile(store,{id,revision,pdfs,files=false}){
 const patches=[];if(typeof id!=='string'||!Array.isArray(pdfs)||pdfs.length>1000)throw Error('Invalid PDF recovery owner.');
 for(const item of pdfs){
  if(typeof item.name!=='string'||item.sourceHash!==undefined&&!/^[a-f0-9]{64}$/.test(item.sourceHash)||item.sourceHash===undefined&&(typeof item.data!=='string'||item.data.length>200*1024*1024))throw Error('Invalid PDF attachment recovery.');
  const alias=item.reference?.ownerId===id&&typeof item.reference?.recoveryOwnerId==='string'&&/^[\w-]{1,80}$/.test(item.reference.recoveryOwnerId)?item.reference.recoveryOwnerId:id,owners=[...new Set([id,alias])],identities=[];
  for(const owner of owners){const identity='attachment:'+owner+':'+String(item.reference?.id||item.name);try{await fs.access(path.dirname(store.folder(identity,'0'.repeat(64))));identities.push({owner,identity});}catch(error){if(error.code!=='ENOENT')throw error;}}if(!identities.length)continue;
  const sourceHash=item.sourceHash||digest(Buffer.from(item.data,'base64')),pages={},assets={},previous=item.reference?.sourceHash===sourceHash?item.reference.pages||{}:{},seen=new Set(),leases=[];let conflicts=0,recoveryOwner=alias;
  try{for(const {owner,identity}of identities){const lease=files?await store.captureExport(identity,sourceHash):null,index=files?lease?.index:await store.read(identity,sourceHash);if(lease)leases.push(lease.id);if(!index)continue;
   for(const [page,entry]of Object.entries(index.pages)){
    if(seen.has(page))continue;if(entry.revision===previous[page]?.revision){seen.add(page);continue;}
    if((entry.noteRevision??null)!==(revision??null)){conflicts++;continue;}
    const ink=files?null:await store.page(identity,sourceHash,Number(page));if(!files&&(!ink||ink.revision!==entry.revision))continue;
    const asset=previous[page]?.asset||'assets/pdf-ink-'+digest(identity).slice(0,20)+'-'+page+'.json';if(files){const file=path.join(store.exportFolder(lease.id),entry.file),stat=await fs.stat(file);if(!stat.isFile()||stat.size>150*1024*1024)throw Error('PDF recovery ink is too large.');Object.defineProperty(assets,asset,{value:{file,bytes:stat.size,sha256:entry.revision},enumerable:true,writable:true,configurable:true});}else Object.defineProperty(assets,asset,{value:ink.bytes.toString('base64'),enumerable:true,writable:true,configurable:true});pages[page]={asset,revision:entry.revision};seen.add(page);recoveryOwner=owner;
   }
  }
  if(Object.keys(pages).length||conflicts)patches.push({name:item.name,sourceHash,ownerId:id,recoveryOwnerId:recoveryOwner,id:item.reference?.id||item.name,pages,assets,conflicts,...(files?{leases}:{} )});else for(const lease of leases)await store.releaseExport(lease);
  }catch(error){for(const lease of leases)await store.releaseExport(lease).catch(()=>{});for(const patch of patches)for(const lease of patch.leases||[])await store.releaseExport(lease).catch(()=>{});throw error;}
 }
 return patches;
}
function remapOwner(doc,previousId){if(!previousId||doc.id===previousId)return doc;let meta;for(const [name,info]of Object.entries(doc.meta?.attachments||{})){if(info?.reference?.ownerId!==previousId)continue;meta ||= structuredClone(doc.meta);meta.attachments[name].reference={...info.reference,ownerId:doc.id,recoveryOwnerId:info.reference.recoveryOwnerId||previousId};}return meta?{...doc,meta}:doc;}
module.exports={reconcile,remapOwner};
