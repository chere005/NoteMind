// Cross-page aliases keep one canonical ID. Resolve only IDs absent from the
// edited page; do not build an all-pages record lookup for a local Undo.
const {SheetRecordTable}=require('./sheet-record-table.cjs'),{SheetIdSet}=require('./sheet-id-set.js');
async function sharedRecords(index,pages,old,ids,added,local){
 const missing=new SheetIdSet(ids.length),found=new SheetIdSet(),records=new SheetRecordTable();let work=0;
 try{
  for(const id of ids){if(!added.has(id)&&!local.has(id))missing.add(id);if(++work%8192===0)await new Promise(setImmediate);}
  if(missing.size)outer:for(const page of pages){if(page===old)continue;for await(const record of index.records(page.order)){if(missing.has(record.id)&&!found.has(record.id)){records.add(record);found.add(record.id);if(found.size===missing.size)break outer;}}}
  return records.seal();
 }catch(error){records.clear();throw error;}
 finally{missing.clear();found.clear();}
}
module.exports={sharedRecords};
