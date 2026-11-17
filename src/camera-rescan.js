async function applyCameraRescan(target,picture,{getMode,getSheets,ensure,onApplied}){
 const valid=()=>!!target?.page&&getMode().rescan===target&&getSheets().some(item=>item.page===target.page);
 if(!valid())return false;
 await ensure(target.page);
 if(!valid())return false;
 target.page.backdrop=picture;
 const mode=getMode();onApplied(target.page,{focus:mode.source==='camera'&&!mode.documentId&&mode.showing});
 return true;
}
module.exports={applyCameraRescan};
