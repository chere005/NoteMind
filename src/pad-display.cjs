// A pen display must be an extended Wacom display, not the primary or built-in screen.
function findPenDisplay(displays,primaryId){
 if(!Array.isArray(displays)||displays.length<2)return null;
 const primary=displays.find(d=>d?.id===primaryId);
 const mirrored=d=>d.bounds&&primary?.bounds&&d.bounds.x===primary.bounds.x&&d.bounds.y===primary.bounds.y;
 return displays.filter(d=>d&&d.id!==primaryId&&!d.internal&&!mirrored(d)&&/wacom/i.test(d.label||'')).sort((a,b)=>a.id-b.id)[0]||null;
}
function moveOffDisplay(bounds,pad,primary,min={width:800,height:550}){
 const w=Math.max(0,Math.min(bounds.x+bounds.width,pad.x+pad.width)-Math.max(bounds.x,pad.x)),h=Math.max(0,Math.min(bounds.y+bounds.height,pad.y+pad.height)-Math.max(bounds.y,pad.y));
 if(!(bounds.width*bounds.height>0)||w*h*2<=bounds.width*bounds.height)return null;
 const width=Math.min(primary.width,Math.max(min.width,Math.min(bounds.width,primary.width))),height=Math.min(primary.height,Math.max(min.height,Math.min(bounds.height,primary.height)));
 return {x:Math.round(primary.x+(primary.width-width)/2),y:Math.round(primary.y+(primary.height-height)/2),width,height};
}
module.exports={findPenDisplay,moveOffDisplay};
