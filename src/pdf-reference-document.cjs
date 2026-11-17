const {isRawAsset}=require('./document-asset-sessions.cjs');
class PDFDocumentReferences{
 constructor({files,storage,root}){Object.assign(this,{files,storage,root});}
 async hash(value){if(isRawAsset(value))return(await this.storage.rawAssetInfo(value)).sha256;return this.files.call('hash',{data:value});}
 async match(doc,name,sourceHash){if(!/^[a-f0-9]{64}$/.test(sourceHash)||!Object.hasOwn(doc.assets||{},name))throw Error('Invalid PDF source check.');return(await this.hash(doc.assets[name]))===sourceHash;}
 async reconcile(doc){
  const pdfs=[];for(const[name,data]of Object.entries(doc.assets||{}))if(/\.pdf$/i.test(name))pdfs.push({name,sourceHash:await this.hash(data),reference:doc.meta?.attachments?.[name]?.reference});
  if(!pdfs.length)return doc;
  const scoped=this.storage.hasRawAssetScope?.(),patches=await this.files.call('reconcile',{id:doc.id,revision:doc.revision,pdfs,files:!!scoped}),created=[];let assets=null,meta=null;
  try{for(const patch of patches){
   if(!Object.keys(patch.pages).length)continue;
   assets ||= {...doc.assets};
   for(const[name,value]of Object.entries(patch.assets)){
    let data=value;
    if(scoped){data=await this.storage.importRawAssetFile(value.file,{root:this.root,name});created.push(data);const info=await this.storage.rawAssetInfo(data);if(info.bytes!==value.bytes||info.sha256!==value.sha256)throw Error('PDF recovery ink changed during loading.');}
    Object.defineProperty(assets,name,{value:data,enumerable:true,writable:true,configurable:true});
   }
   meta ||= {...doc.meta,attachments:{...doc.meta?.attachments}};
   const old=meta.attachments[patch.name]||{},previous=old.reference?.sourceHash===patch.sourceHash?old.reference:null;
   Object.defineProperty(meta.attachments,patch.name,{value:{...old,reference:{version:1,...previous,id:patch.id,sourceHash:patch.sourceHash,ownerId:patch.ownerId,recoveryOwnerId:patch.recoveryOwnerId,pages:{...previous?.pages,...patch.pages}}},enumerable:true,writable:true,configurable:true});
  }return meta?{...doc,assets,meta}:doc;
  }catch(error){if(created.length)await this.storage.releaseScopedRawAssets(created).catch(()=>{});throw error;}
  finally{for(const patch of patches)for(const id of patch.leases||[])await this.files.call('releaseExport',{id}).catch(()=>{});}
 }
}
module.exports={PDFDocumentReferences};
