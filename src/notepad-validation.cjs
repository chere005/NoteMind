// The real file encoder owns format admission; this writer inspects its exact
// prepared metadata and trusted immutable asset lengths without reading media.
const {writeNotepadFile}=require('./notepad-file.cjs');
const {describeZipEntries,validateZipFileSize}=require('./zip-stream.cjs');
async function validateNotepad(doc,options,{hooks={},check=()=>{}}={}){
 return writeNotepadFile(doc,options,{}, {hooks,check,writer:async(entries,_target,limits)=>{
  check();const files=describeZipEntries(entries,limits.maxBytes,limits.maxNameBytes);
  await validateZipFileSize(entries,{maxBytes:limits.maxBytes,maxNameBytes:limits.maxNameBytes,check});
  const result={bodyBytes:0,manifestBytes:0,entries:files.length,assetBytes:0,textBytes:0,extraBytes:0};
  for(const entry of files){check();result.bodyBytes+=entry.bytes;if(entry.name==='manifest.json')result.manifestBytes=entry.bytes;else if(entry.name==='document.md')result.textBytes=entry.bytes;else if(entry.name.startsWith('assets/'))result.assetBytes+=entry.bytes;else result.extraBytes+=entry.bytes;}
  check();return result;
 }});
}
module.exports={validateNotepad};
