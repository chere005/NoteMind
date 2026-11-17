const snapshots=require('./snapshot-store.cjs');
// Only immutable objects and a unique version manifest are published here. The main process commits the library index last.
const objects=new Map();
async function publishVersion(doc,{root,id,knownHashes=[],previousHash=null}={}){
 if(typeof root!=='string'||!root||typeof id!=='string')throw Error('Invalid version publication.');
 let prepared=snapshots.prepareSnapshot(doc,{knownHashes,previousHash,copyObjectBytes:false});
 if(prepared.unchanged&&typeof previousHash==='string'&&previousHash.startsWith('snapshot2:')){
  try{await snapshots.publishSnapshotObjects(root,prepared,objects);}
  catch(error){if(error.code!=='SNAPSHOT_OBJECT_MISSING')throw error;objects.clear();const {contentHash,legacyHash}=prepared;prepared=snapshots.prepareSnapshot(doc,{copyObjectBytes:false});await snapshots.publishSnapshotObjects(root,prepared,objects);Object.assign(prepared,{unchanged:true,contentHash,legacyHash});}
 }else if(!prepared.unchanged){
  try{await snapshots.publishSnapshot(root,id,prepared,objects);}
  catch(error){if(error.code!=='SNAPSHOT_OBJECT_MISSING')throw error;objects.clear();prepared=snapshots.prepareSnapshot(doc,{previousHash,copyObjectBytes:false});await snapshots.publishSnapshot(root,id,prepared,objects);}
 }
 const {id:noteId,title,created}=prepared.manifest.document,objectHashes=[...new Set(Object.values(prepared.manifest.assets).map(ref=>ref.hash))];
 return {unchanged:prepared.unchanged,contentHash:prepared.contentHash,legacyHash:prepared.legacyHash,documentMetadata:{id:noteId,title,created},objectHashes,objectCount:objectHashes.length};
}
module.exports={publishVersion};
