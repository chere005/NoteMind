const fs=require('node:fs/promises'),path=require('node:path'),{digest}=require('./pdf-ink-store.cjs');
// Only references with an existing recovery identity are decoded/hashed. The
// public note's current source and revision remain the authority for adoption.
async function reconcile(store,{id,revision,pdfs}){
 const patches=[];if(typeof id!=='string'||!Array.isArray(pdfs)||pdfs.length>1000)throw Error('Invalid PDF recovery owner.');
 for(const item of pdfs){
  if(typeof item.name!=='string'||typeof item.data!=='string'||item.data.length>200*1024*1024)throw Error('Invalid PDF attachment recovery.');
  const recoveryOwner=item.reference?.ownerId===id&&typeof item.reference?.recoveryOwnerId==='string'&&/^[\w-]{1,80}$/.test(item.reference.recoveryOwnerId)?item.reference.recoveryOwnerId:id,identity='attachment:'+recoveryOwner+':'+String(item.reference?.id||item.name),identityFolder=path.dirname(store.folder(identity,'0'.repeat(64)));
  try{await fs.access(identityFolder);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const sourceHash=digest(Buffer.from(item.data,'base64')),index=await store.read(identity,sourceHash);if(!index)continue;
  const pages={},assets={},previous=item.reference?.sourceHash===sourceHash?item.reference.pages||{}:{};let conflicts=0;
  for(const [page,entry]of Object.entries(index.pages)){
   if(entry.revision===previous[page]?.revision)continue;
   if((entry.noteRevision??null)!==(revision??null)){conflicts++;continue;}
   const ink=await store.page(identity,sourceHash,Number(page));if(!ink||ink.revision!==entry.revision)continue;
   const asset=previous[page]?.asset||'assets/pdf-ink-'+digest(identity).slice(0,20)+'-'+page+'.json';assets[asset]=ink.bytes.toString('base64');pages[page]={asset,revision:ink.revision};
  }
  if(Object.keys(pages).length||conflicts)patches.push({name:item.name,sourceHash,ownerId:id,recoveryOwnerId:recoveryOwner,id:item.reference?.id||item.name,pages,assets,conflicts});
 }
 return patches;
}
function remapOwner(doc,previousId){if(!previousId||doc.id===previousId)return doc;let meta;for(const [name,info]of Object.entries(doc.meta?.attachments||{})){if(info?.reference?.ownerId!==previousId)continue;meta ||= structuredClone(doc.meta);meta.attachments[name].reference={...info.reference,ownerId:doc.id,recoveryOwnerId:info.reference.recoveryOwnerId||previousId};}return meta?{...doc,meta}:doc;}
module.exports={reconcile,remapOwner};
