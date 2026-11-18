const {MAX_SOURCE}=require('./word-import-source.cjs'),{TOTAL_BYTES}=require('./archive-limits.cjs');
const GiB=1024*1024*1024,KINDS=new Set(['html','attribute','media']);
const capacity=message=>Object.assign(Error(message||'Word preview temporary storage is busy.'),{code:'WORD_PREVIEW_BUDGET'});
const closed=()=>Object.assign(Error('This Word preview resource is closing.'),{code:'WORD_PREVIEW_BUDGET_CLOSED'});
const integer=(value,name)=>{if(!Number.isSafeInteger(value)||value<0)throw TypeError('Invalid Word preview '+name+'.');return value;};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});promise.catch(()=>{});return{promise,resolve,reject};}
// One instance covers every session on the worker. Cleanup callbacks must resolve
// only after exact owned file IO/unlink has ended; they must not reenter mutations.
class PreviewBudget{
 constructor({maxBytes=MAX_SOURCE,maxUnleasedMediaBytes=Math.min(TOTAL_BYTES,maxBytes),maxEntries=65535,availableBytes,minimumFreeBytes=2*GiB,check=()=>{}}={}){
  integer(maxBytes,'byte limit');integer(maxUnleasedMediaBytes,'cache limit');integer(maxEntries,'entry limit');integer(minimumFreeBytes,'free-space floor');
  if(!maxBytes||maxBytes>MAX_SOURCE||maxUnleasedMediaBytes>maxBytes||!maxEntries||maxEntries>65535||typeof availableBytes!=='function'||typeof check!=='function')throw TypeError('Invalid Word preview budget.');
  Object.assign(this,{maxBytes,maxUnleasedMediaBytes,maxEntries,availableBytes,minimumFreeBytes,check});this.entries=new Map();this.lru=new Map();this.bytes=0;this.writtenBytes=0;this.unleasedMediaBytes=0;this.leases=0;this.tail=Promise.resolve();this.closed=false;this.cleanupFailures=0;
 }
 serial(run){const result=this.tail.then(run);this.tail=result.catch(()=>{});return result;}
 key(key){if(typeof key!=='string'||!key||key.length>1024)throw TypeError('Invalid Word preview budget key.');}
 uncache(entry){if(this.lru.delete(entry.key))this.unleasedMediaBytes-=entry.bytes;}
 cache(entry){if(entry.kind==='media'&&!entry.leases.size&&!entry.retiring){this.uncache(entry);this.lru.set(entry.key,entry);this.unleasedMediaBytes+=entry.bytes;}}
 removal(entry){return entry.removal ||= deferred();}
 async drop(entry){
  if(this.entries.get(entry.key)!==entry)return false;this.uncache(entry);entry.retiring=true;
  if(entry.leases.size)return false;
  try{await entry.cleanup({key:entry.key,identity:entry.identity,bytes:entry.bytes,writtenBytes:entry.written});}
  catch(error){this.cleanupFailures++;entry.removal?.reject(error);entry.removal=null;throw error;}
  if(this.entries.get(entry.key)!==entry)throw Error('Word preview budget ownership changed during cleanup.');
  this.entries.delete(entry.key);this.bytes-=entry.bytes;this.writtenBytes-=entry.written;entry.removal?.resolve(true);return true;
 }
 async evict(){const entry=this.lru.values().next().value;if(!entry)return false;await this.drop(entry);return true;}
 async admit(delta,additional,check){
  check();while(this.bytes+delta>this.maxBytes||this.entries.size+additional>this.maxEntries){if(!await this.evict())throw capacity();check();}
  for(;;){
   // Only outstanding reservations are subtracted: statfs already includes all
   // acknowledged writes, which written() reports synchronously before return.
   const reserved=this.bytes-this.writtenBytes;let free=await this.availableBytes();if(typeof free==='bigint')free=Number(free>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):free);integer(free,'available storage');check();
   if(free-reserved-delta>=this.minimumFreeBytes)return;
   if(!await this.evict())throw capacity('Word preview needs to preserve working disk space.');check();
  }
 }
 async trimOwned(){while(this.unleasedMediaBytes>this.maxUnleasedMediaBytes)if(!await this.evict())break;}
 claim({key,kind,bytes,identity,cleanup,check=this.check}={}){
  return this.serial(async()=>{
   this.key(key);integer(bytes,'claim size');if(!KINDS.has(kind)||identity===undefined||identity===null||typeof cleanup!=='function'||typeof check!=='function')throw TypeError('Invalid Word preview claim.');if(this.closed)throw closed();check();
   let entry=this.entries.get(key),fresh=false;
   if(entry){if(entry.retiring)throw closed();if(entry.kind!==kind||entry.bytes!==bytes||entry.identity!==identity)throw Error('Word preview resource identity cannot be rebound.');}
   else{if(bytes>this.maxBytes)throw capacity();await this.admit(bytes,1,check);if(this.closed)throw closed();entry={key,kind,bytes,written:0,identity,cleanup,leases:new Set(),retiring:false,removal:null};this.entries.set(key,entry);this.bytes+=bytes;fresh=true;}
   this.uncache(entry);const lease={entry,live:true};entry.leases.add(lease);this.leases++;let releasePromise,rollbackPromise;
   return{fresh,key,identity,get bytes(){return entry.bytes;},resize:n=>this.resize(lease,n,check),written:n=>{try{return Promise.resolve(this.written(lease,n))}catch(error){return Promise.reject(error)}},release:()=>releasePromise ||= this.serial(()=>this.releaseOwned(lease)),rollback:()=>rollbackPromise ||= fresh?this.serial(async()=>{this.closeLease(lease);if(this.entries.get(key)!==entry)return{wait:Promise.resolve(false)};this.uncache(entry);entry.retiring=true;const wait=this.removal(entry).promise;if(!entry.leases.size)await this.drop(entry);return{wait};}).then(result=>result.wait):(releasePromise ||= this.serial(()=>this.releaseOwned(lease)))};
  });
 }
 current(lease){if(!lease.live||this.entries.get(lease.entry.key)!==lease.entry)throw closed();return lease.entry;}
 closeLease(lease){if(!lease.live)return false;lease.live=false;lease.entry.leases.delete(lease);this.leases--;return true;}
 resize(lease,bytes,check){return this.serial(async()=>{integer(bytes,'claim size');const entry=this.current(lease);if(entry.retiring||this.closed)throw closed();if(bytes<entry.written)throw Error('Cannot release storage while acknowledged bytes still exist.');const delta=bytes-entry.bytes;if(delta>0)await this.admit(delta,0,check);if(this.closed||entry.retiring)throw closed();check();this.bytes+=delta;entry.bytes=bytes;return bytes;});}
 written(lease,bytes){integer(bytes,'written size');const entry=this.current(lease);if(bytes<entry.written||bytes>entry.bytes)throw Error('Acknowledged bytes exceed the preview reservation.');const delta=bytes-entry.written;entry.written=bytes;this.writtenBytes+=delta;return bytes;}
 async releaseOwned(lease){if(!this.closeLease(lease))return false;const entry=lease.entry;if(this.entries.get(entry.key)!==entry)return false;if(entry.retiring){if(!entry.leases.size)await this.drop(entry);}else{this.cache(entry);await this.trimOwned();}return true;}
 remove(key,identity){return this.serial(async()=>{this.key(key);const entry=this.entries.get(key);if(!entry)return{wait:Promise.resolve(false)};if(entry.identity!==identity)throw Error('Word preview resource belongs to another owner.');this.uncache(entry);entry.retiring=true;const wait=this.removal(entry).promise;if(!entry.leases.size)await this.drop(entry);return{wait};}).then(result=>result.wait);}
 trim(){return this.serial(()=>this.trimOwned());}
 dispose(){if(this.disposing)return this.disposing;this.closed=true;const pending=this.serial(async()=>{const entries=[...this.entries.values()],waits=[];for(const entry of entries){this.uncache(entry);entry.retiring=true;waits.push(this.removal(entry).promise);}for(const entry of entries)if(!entry.leases.size)try{await this.drop(entry)}catch{}return{waits};}).then(async({waits})=>{const results=await Promise.allSettled(waits),failure=results.find(value=>value.status==='rejected');if(failure)throw failure.reason;});this.disposing=pending.catch(error=>{this.disposing=null;throw error;});return this.disposing;}
 stats(){return{entries:this.entries.size,bytes:this.bytes,writtenBytes:this.writtenBytes,reservedBytes:this.bytes-this.writtenBytes,unleasedMediaBytes:this.unleasedMediaBytes,leases:this.leases,cleanupFailures:this.cleanupFailures,closed:this.closed,maxBytes:this.maxBytes,maxUnleasedMediaBytes:this.maxUnleasedMediaBytes,minimumFreeBytes:this.minimumFreeBytes};}
}
module.exports={PreviewBudget,MAX_PREVIEW_BYTES:MAX_SOURCE,UNLEASED_MEDIA_BYTES:TOTAL_BYTES,MINIMUM_FREE_BYTES:2*GiB};
