async function applyCameraRescan(target,picture,{getMode,getSheets,ensure,onApplied}){
 const valid=()=>!!target?.page&&getMode().rescan===target&&getSheets().some(item=>item.page===target.page);
 if(!valid())return false;
 await ensure(target.page);
 if(!valid())return false;
 if(target.page.setBackdropAsync){if(!await target.page.setBackdropAsync(picture,{valid}))return false;}else target.page.backdrop=picture;
 if(!valid())return false;
 const mode=getMode();onApplied(target.page,{focus:mode.source==='camera'&&!mode.documentId&&mode.showing});
 return true;
}
module.exports={applyCameraRescan};
