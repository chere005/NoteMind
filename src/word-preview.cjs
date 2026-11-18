// WordPage renders semantic HTML; it needs one loop item, never a PDF raster copy.
async function previewWord(bytes,{importWord=bytes=>require('./documents.cjs').importWord(bytes),render=(text,assets)=>require('./document-renderer.cjs').render(text,assets)}={}){
 const converted=await importWord(bytes);
 return{kind:'docx',pages:[{page:1,blocks:[]}],converted,html:render(converted.text,converted.assets)};
}
module.exports={previewWord};
