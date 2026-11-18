const {randomUUID}=require('node:crypto'),{createPreviewFile,removePreviewFile}=require('./word-preview-files.cjs');
// One instance belongs to one private preview folder; its budget is shared by
// every session in the worker. Physical cleanup retains the exact inode receipt.
class PreviewBudgetFiles{
 constructor(authority,{budget,prefix=randomUUID(),check=()=>{}}={}){Object.assign(this,{authority,budget,prefix,check});this.records=new Map();this.next=0;}
 async create(kind,bytes,extension,{key=String(++this.next),onRemove=()=>{},check=this.check}={}){const record={key:this.prefix+':'+key,kind,bytes,entry:null,handle:null,lease:null,visibleLease:null,removed:false};record.identity=record;record.cleanup=async()=>{await record.handle?.close();record.handle=null;if(record.entry)await removePreviewFile(this.authority,record.entry);record.removed=true;this.records.delete(record.key);onRemove();};try{record.lease=await this.budget?.claim({key:record.key,kind,bytes,identity:record.identity,cleanup:record.cleanup,check});check();record.entry=await createPreviewFile(this.authority,extension);record.handle=record.entry.handle;this.records.set(record.key,record);return record;}catch(error){if(record.lease)await record.lease.rollback();else await record.cleanup();throw error;}}
 async written(record,total){await record.lease?.written(total);}
 async done(record,{visible=false}={}){await record.handle?.close();record.handle=null;record.entry.handle=null;if(visible){record.visibleLease=record.lease;record.lease=null;}else{const lease=record.lease;record.lease=null;await lease?.release();}return record.entry;}
 async rollback(record){await record.handle?.close();record.handle=null;const lease=record.lease;record.lease=null;if(lease)await lease.rollback();else if(this.budget&&!record.removed)await this.budget.remove(record.key,record.identity);else await record.cleanup();}
 async pin(record,{check=this.check}={}){if(record.removed)throw Error('Word preview image cache retired.');if(!record.visibleLease)record.visibleLease=await this.budget?.claim({key:record.key,kind:record.kind,bytes:record.bytes,identity:record.identity,cleanup:record.cleanup,check});}
 async unpin(record){const lease=record.visibleLease;record.visibleLease=null;await lease?.release();}
 async close(){for(const record of [...this.records.values()]){await this.unpin(record);if(record.removed)continue;if(this.budget)await this.budget.remove(record.key,record.identity);else await record.cleanup();}}
}
module.exports={PreviewBudgetFiles};
