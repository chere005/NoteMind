const {randomUUID}=require('node:crypto'),{createPrintFiles,drainPrintFiles}=require('./print-asset-files.cjs');
class PrintFileLeases{
 constructor({create=createPrintFiles,drain=drainPrintFiles,maxEntries=2,maxBytes=398*1024*1024,idleMs=300000,uuid=randomUUID}={}){Object.assign(this,{create,drain,maxEntries,maxBytes,idleMs,uuid});this.entries=new Map();this.openings=new Set();this.pending=0;this.bytes=0;this.closed=new WeakSet();this.closing=false;this.disposal=null;}
 remember(owner,files,closed){const entry={owner,files,token:this.uuid(),closed};this.entries.set(entry.token,entry);this.bytes+=files.bytes;return entry;}
 expire(entry,delay=this.idleMs){clearTimeout(entry.timer);entry.timer=setTimeout(()=>{void this.remove(entry).catch(error=>{entry.cleanupError=error;if(this.entries.get(entry.token)===entry)this.expire(entry,Math.min(this.idleMs,1000));});},delay);entry.timer.unref?.();}
 async open(owner,doc){
  if(this.closing||!owner||this.closed.has(owner)||owner.isDestroyed?.())throw Error('The print window is closed.');
  if(this.entries.size+this.pending>=this.maxEntries)throw Error('Two printable documents are already open. Close one before printing another.');
  this.pending++;let finish;const ticket=new Promise(resolve=>finish=resolve);this.openings.add(ticket);let files,entry;
  const closed=()=>{this.closed.add(owner);if(entry)void this.remove(entry).catch(error=>{entry.cleanupError=error;this.expire(entry,Math.min(this.idleMs,1000));});};owner.once?.('destroyed',closed);
  try{
   files=await this.create(doc);entry=this.remember(owner,files,closed);
   if(this.closing||this.closed.has(owner)||owner.isDestroyed?.())throw Error('The print window is closed.');
   if(this.bytes>this.maxBytes)throw Error('The printable documents exceed the temporary image limit.');
   this.expire(entry);return{token:entry.token,url:files.url};
  }catch(error){
   if(!entry&&error?.printFilesCleanup)entry=this.remember(owner,error.printFilesCleanup,closed);
   if(entry)try{await this.remove(entry);}catch(cleanupError){this.expire(entry,Math.min(this.idleMs,1000));throw new AggregateError([error,cleanupError],'Printable document cleanup could not finish.');}
   else owner.removeListener?.('destroyed',closed);
   throw error;
  }finally{this.pending--;this.openings.delete(ticket);finish();}
 }
 remove(entry){
  if(this.entries.get(entry.token)!==entry)return Promise.resolve();if(entry.removing)return entry.removing;clearTimeout(entry.timer);
  const run=Promise.resolve().then(()=>entry.files.release()).then(()=>{if(this.entries.get(entry.token)===entry){this.entries.delete(entry.token);this.bytes-=entry.files.bytes;}entry.owner.removeListener?.('destroyed',entry.closed);},error=>{if(entry.removing===run)entry.removing=null;entry.cleanupError=error;throw error;});entry.removing=run;return run;
 }
 async release(owner,token){const entry=this.entries.get(token);if(!entry||entry.owner!==owner)throw Error('This printable document has expired.');await this.remove(entry);}
 dispose(){
  this.closing=true;if(this.disposal)return this.disposal;
  const run=(async()=>{while(this.openings.size)await Promise.all([...this.openings]);await Promise.all([...this.entries.values()].map(entry=>this.remove(entry)));await this.drain();})();
  this.disposal=run.catch(error=>{this.disposal=null;throw error;});return this.disposal;
 }
}
module.exports={PrintFileLeases};
