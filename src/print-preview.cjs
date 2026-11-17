// Options previews reserve the full layout but load pixels only for the first visible page.
const {printHtml}=require('./documents.cjs'),{mime}=require('./document-renderer.cjs'),{create}=require('./image-previews.js');
const TEXT_LIMIT=256*1024;
function html(doc){
 const previews=create({lazy:true}),truncated=doc.text.length>TEXT_LIMIT;
 try{return printHtml({...doc,text:truncated?doc.text.slice(0,TEXT_LIMIT):doc.text},{preview:true,truncated,imageUrl:previews.url,imageSize:previews.size});}
 finally{previews.clear();}
}
async function images(doc,options,convert){
 const entries=Object.entries(doc.assets||{}).filter(([name])=>mime(name));
 // The dialog is approximately 320 CSS pixels wide. Bound the complete preview to four megapixels.
 const maxDimension=Math.max(16,Math.min(512,Math.floor(Math.sqrt(4*1024*1024/Math.max(1,entries.length))))),assets={};let bytes=0;
 for(const [name,data]of entries){const image=await convert(data,mime(name),!!options?.clean,maxDimension);bytes+=image.data.length;if(bytes>24*1024*1024)throw Error('The first-page preview is too large. Export the document to view it.');assets[name]=image.data;}
 return {...doc,assets};
}
module.exports={html,images,TEXT_LIMIT};
