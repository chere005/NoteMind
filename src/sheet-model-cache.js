// Current/dirty/in-flight pages are protected; clean inactive models are replaceable by their durable roots.
class SheetModelCache{
 constructor({maxBytes=96*1024*1024,maxPages=4}={}){Object.assign(this,{maxBytes,maxPages});this.order=new WeakMap();this.clock=0;}
 touch(page){this.order.set(page,++this.clock);}
 candidates(sheets,{activePage,queue,pending=new Set(),signature=()=>null,metadata=()=>null}={}){
  const eligible=[];for(const item of sheets){if(item.loaded===false||item.page===activePage||item.page.target&&!item.page.preservesEditTargetOnUnload||item.page.geometryRetained||pending.has(item.page))continue;const head=queue?.pageHeads.get(item.pageId);if(!head?.signature||signature(item)!==head.signature)continue;if(!queue?.canUnload(item.pageId,item.page.strokes,item.page.backdrop||null,metadata(item)))continue;eligible.push({item,head,bytes:Math.max(head.modelBytes||0,item.page.retainedGeometryBytes||0),order:this.order.get(item.page)||0});}
  let bytes=eligible.reduce((n,value)=>n+value.bytes,0),pages=eligible.length;const output=[];for(const entry of eligible.sort((a,b)=>a.order-b.order)){if(bytes<=this.maxBytes&&pages<=this.maxPages)break;output.push(entry);bytes-=entry.bytes;pages--;}return output;
 }
}
module.exports={SheetModelCache};
