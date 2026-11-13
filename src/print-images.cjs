const crypto=require('node:crypto');
const {mime}=require('./document-renderer.cjs');
const {rewrite}=require('./markdown-files.cjs');
// Build a temporary document for print; never alter the source or replace an existing asset.
async function preparePrint(doc,clean,convert){
 if(!clean)return doc;
 const copy={...doc,assets:{...doc.assets}};
 for(const [name,data] of Object.entries(doc.assets||{})){
  if(!mime(name))continue;
  const image=await convert(data,mime(name),true),next='assets/print-clean-'+crypto.randomUUID()+'.png';
  copy.text=rewrite(copy.text,name,next);copy.assets[next]=image.data;
 }
 return copy;
}
module.exports={preparePrint};
