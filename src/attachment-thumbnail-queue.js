// Only eligible rows prepare original images. The one active decode keeps its
// source owner until it has actually settled, including after cancellation.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={create:factory};else root.NoteMindAttachmentThumbnails={create:factory};})(typeof globalThis==='object'?globalThis:this,function({prepare,show,clear,error=()=>{},maxBytes=4*1024*1024,maxEntries=64}={}){
 if(typeof prepare!=='function'||typeof show!=='function'||typeof clear!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<0||!Number.isSafeInteger(maxEntries)||maxEntries<0)throw Error('Invalid attachment thumbnail queue.');
 const rows=new Map(),groups=new Map(),cache=new Map(),pending=new Set();let active=null,closed=false,bytes=0,pumping=false,closeReceipt;
 const needed=key=>{for(const row of groups.get(key)||[])if(rows.get(row)?.visible)return true;return false;};
 const touch=key=>{const entry=cache.get(key);if(entry){cache.delete(key);cache.set(key,entry);}return entry;};
 const trim=()=>{for(const[key,entry]of cache){if(cache.size<=maxEntries&&bytes<=maxBytes)break;if(needed(key))continue;cache.delete(key);bytes-=entry.bytes;}};
 const publish=(key,src)=>{for(const row of groups.get(key)||[])if(rows.get(row)?.visible)show(row,src);};
 const schedule=()=>{if(pumping||closed)return;pumping=true;queueMicrotask(()=>{pumping=false;pump();});};
 function pump(){if(closed||active)return;let key;for(const next of pending){pending.delete(next);if(needed(next)&&!cache.has(next)){key=next;break;}}if(key===undefined)return;const controller=new AbortController(),job={key,controller,promise:null};active=job;
  job.promise=Promise.resolve().then(()=>prepare(key,{signal:controller.signal})).then(src=>{if(closed||controller.signal.aborted||!needed(key))return;if(typeof src!=='string')throw Error('Invalid attachment thumbnail.');const entry={src,bytes:src.length*2+128};cache.set(key,entry);bytes+=entry.bytes;publish(key,src);trim();},reason=>{if(!closed&&!controller.signal.aborted)for(const row of groups.get(key)||[])if(rows.get(row)?.visible)error(row,reason);}).catch(reason=>{if(!closed&&!controller.signal.aborted)for(const row of groups.get(key)||[])if(rows.get(row)?.visible)error(row,reason);}).finally(()=>{if(active===job)active=null;trim();schedule();});
 }
 function add(row,key){if(closed||rows.has(row))throw Error('Attachment thumbnail owner is unavailable.');rows.set(row,{key,visible:false});let group=groups.get(key);if(!group)groups.set(key,group=new Set());group.add(row);}
 function visible(row,value){const state=rows.get(row);if(!state||closed)return;value=!!value;if(state.visible===value)return;state.visible=value;if(value){const entry=touch(state.key);if(entry)show(row,entry.src);else{pending.add(state.key);schedule();}}else{clear(row);if(!needed(state.key)){pending.delete(state.key);if(active?.key===state.key)active.controller.abort();}trim();}}
 function remove(row){const state=rows.get(row);if(!state)return;visible(row,false);rows.delete(row);const group=groups.get(state.key);group.delete(row);if(!group.size)groups.delete(state.key);trim();}
 function close(){if(closeReceipt)return closeReceipt;closed=true;active?.controller.abort();pending.clear();for(const row of rows.keys())clear(row);rows.clear();groups.clear();cache.clear();bytes=0;closeReceipt=Promise.resolve(active?.promise).then(()=>{});return closeReceipt;}
 return{add,visible,remove,close,stats:()=>({rows:rows.size,visible:[...rows.values()].reduce((count,row)=>count+Number(row.visible),0),pending:pending.size,active:Number(!!active),cacheEntries:cache.size,cacheBytes:bytes})};
});
