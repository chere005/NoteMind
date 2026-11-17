const snapshots=require('./snapshot-store.cjs');
// Only immutable objects and a unique version manifest are published here. The main process commits the library index last.
const objects=new Map();
async function publishVersion(doc,{root,id,knownHashes=[],previousHash=null,existingVersionId}={}){
 if(typeof root!=='string'||!root||typeof id!=='string')throw Error('Invalid version publication.');
 const prepared=await snapshots.prepareSnapshotSources(doc,{knownHashes,previousHash});
 if(prepared.unchanged&&typeof previousHash==='string'&&previousHash.startsWith('snapshot2:')){
  if(existingVersionId)await snapshots.readSnapshot(root,existingVersionId,{referencesOnly:true,expectedHash:previousHash});
  await snapshots.publishSnapshotObjects(root,prepared,objects);
 }else if(!prepared.unchanged)await snapshots.publishSnapshot(root,id,prepared,objects);
 const {id:noteId,title,created}=prepared.manifest.document,objectHashes=[...new Set(Object.values(prepared.manifest.assets).map(ref=>ref.hash))];
 return {unchanged:prepared.unchanged,contentHash:prepared.contentHash,legacyHash:prepared.legacyHash,documentMetadata:{id:noteId,title,created},objectHashes,objectCount:objectHashes.length};
}
module.exports={publishVersion};
