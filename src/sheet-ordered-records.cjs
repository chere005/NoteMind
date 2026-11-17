// A proven ordered edit can reuse immutable pack records without a dense lookup.
function strictlyIncreasing(ids){let previous=0;for(const id of ids){if(!Number.isSafeInteger(id)||id<=previous)return false;previous=id;}return true;}
async function canStreamOrderedRecords(index,root,ids,added){
 if(!strictlyIncreasing(ids))return false;
 let previous=0;for await(const record of index.records(root)){if(added.has(record.id))throw Error('Duplicate drawing stroke identity.');if(!Number.isSafeInteger(record.id)||record.id<=previous)return false;previous=record.id;}
 return true;
}
async function* orderedRecords(index,root,ids,added){
 const source=index.records(root)[Symbol.asyncIterator]();
 try{let next=await source.next();for(const id of ids){while(!next.done&&next.value.id<id)next=await source.next();if(!next.done&&next.value.id===id){yield next.value;next=await source.next();}else{const record=added.get(id);if(!record)throw Error('Unknown drawing stroke identity.');yield record;}}}finally{await source.return?.();}
}
module.exports={strictlyIncreasing,canStreamOrderedRecords,orderedRecords};
