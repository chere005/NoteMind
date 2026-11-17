class ResourceCache {
 constructor(maxBytes,maxEntries=256){if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid PDF cache budget.');this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.entries=new Map();this.retired=new Set();this.bytes=0;}
 dispose(entry){this.bytes-=entry.bytes;this.retired.delete(entry);entry.value.dispose?.();}
 retire(entry){if(entry.retired)return;entry.retired=true;if(entry.pins)this.retired.add(entry);else this.dispose(entry);}
 trim(requiredBytes=0,reserveEntry=false){for(const [key,entry]of this.entries){if(this.bytes+requiredBytes<=this.maxBytes&&this.entries.size<=this.maxEntries-(reserveEntry?1:0))break;if(entry.pins)continue;this.entries.delete(key);this.retire(entry);}}
 put(key,value,bytes){
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>this.maxBytes){value.dispose?.();throw Error('This PDF page exceeds the render memory budget.');}
  const previous=this.entries.get(key);if(previous){this.entries.delete(key);this.retire(previous);}this.trim(bytes,true);
  if(this.bytes+bytes>this.maxBytes||this.entries.size>=this.maxEntries){value.dispose?.();throw Error('Release an offscreen PDF page before loading another.');}
  this.entries.set(key,{value,bytes,pins:0,retired:false});this.bytes+=bytes;
 }
 lease(key){const entry=this.entries.get(key);if(!entry)return null;this.entries.delete(key);this.entries.set(key,entry);entry.pins++;let released=false;return {value:entry.value,release:()=>{if(released)return;released=true;entry.pins--;if(entry.retired&&!entry.pins)this.dispose(entry);this.trim();}};}
 clear(){for(const entry of this.entries.values())this.retire(entry);this.entries.clear();}
 stats(){return {bytes:this.bytes,entries:this.entries.size,pinned:[...this.entries.values(),...this.retired].reduce((n,entry)=>n+entry.pins,0)};}
}
module.exports={ResourceCache};
