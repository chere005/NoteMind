const documentKey=doc=>doc.key||doc.path;
// Preview leases belong to the open document session, above display portals.
class PreviewDocuments{
 constructor({release=()=>{}}={}){this.release=release;this.documents=[];this.listeners=new Set();this.closed=false;this.subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};this.getSnapshot=()=>this.documents;}
 emit(){for(const listener of this.listeners)try{listener();}catch{}}
 releaseUnused(token){if(typeof token!=='string'||!token||this.documents.some(doc=>doc.previewToken===token))return;try{void Promise.resolve(this.release(token)).catch(()=>{});}catch{}}
 open(doc){
  if(this.closed){this.releaseUnused(doc?.previewToken);throw Error('Document previews are closing.');}if(!doc||typeof doc.path!=='string'||!doc.path){this.releaseUnused(doc?.previewToken);throw Error('Invalid document preview.');}
  const existing=this.documents.find(item=>documentKey(item)===documentKey(doc));if(existing){if(existing.previewToken!==doc.previewToken)this.releaseUnused(doc.previewToken);return existing;}
  this.documents=[...this.documents,doc];this.emit();return doc;
 }
 close(key){const index=this.documents.findIndex(doc=>documentKey(doc)===key);if(index<0)return null;const removed=this.documents[index];this.documents=this.documents.filter(doc=>doc!==removed);this.emit();this.releaseUnused(removed.previewToken);return {next:this.documents.length?documentKey(this.documents[Math.min(index,this.documents.length-1)]):null};}
 dispose(){if(this.closed)return;this.closed=true;const tokens=new Set(this.documents.map(doc=>doc.previewToken));this.documents=[];this.emit();this.listeners.clear();for(const token of tokens)this.releaseUnused(token);}
}
module.exports={PreviewDocuments};
