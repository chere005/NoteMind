(() => {
 // Where each Notepad was scrolled to: the block (or line) at the top of the page and how far into it, so the same words
 // are on top when the tab comes forward again or the app reopens.
 const wrap=rich.parentElement,line=23;
 function anchor(){
  if(!activeTab)return null;
  if(visual){const blocks=[...rich.children],found=blocks.findIndex(el=>el.offsetTop+el.offsetHeight>wrap.scrollTop),at=Math.max(found,0);return {v:1,block:at,offset:Math.round(wrap.scrollTop-(blocks[at]?.offsetTop||0))};}
  return {v:0,line:Math.round(wrap.scrollTop/line)};
 }
 let restoreEpoch=0,userIntent=0;
 for(const type of ['wheel','keydown','pointerdown'])wrap.addEventListener(type,event=>{if(event.isTrusted)userIntent++;},{capture:true,passive:type==='wheel'});
 const savedPlace=value=>{if(!value||value.v!==(visual?1:0))return null;if(value.v){if(!Number.isSafeInteger(value.block)||value.block<0||!Number.isFinite(value.offset??0))return null;return{v:1,block:value.block,offset:value.offset??0};}if(!Number.isSafeInteger(value.line)||value.line<0)return null;return{v:0,line:value.line};};
 const samePlace=(a,b)=>a&&b&&a.v===b.v&&(a.v?a.block===b.block&&a.offset===b.offset:a.line===b.line);
 const position=place=>place.v?(rich.children[place.block]?.offsetTop||0)+place.offset:place.line*line;
 function apply(tab){
  const epoch=++restoreEpoch,place=savedPlace(tab?.scroll);if(!place)return;
  wrap.scrollTop=position(place);const applied=wrap.scrollTop,intent=userIntent;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(activeTab!==tab||restoreEpoch!==epoch||userIntent!==intent||wrap.scrollTop!==applied||!samePlace(place,savedPlace(tab.scroll)))return;wrap.scrollTop=position(place);}));
 }
 const original=window.activateTab;
 window.activateTab=function(tab){
  const previous=activeTab;if(previous&&previous!==tab)previous.scroll=anchor();
  const result=original.call(this,tab);if(previous!==tab)apply(tab);return result;
 };
 let pending;
 wrap.addEventListener('scroll',()=>{clearTimeout(pending);pending=setTimeout(()=>{if(!activeTab)return;activeTab.scroll=anchor();window.NoteMindNotes?.session?.();},500);});

 // The wheel over the tab row walks the tabs.
 let last=0;
 $('documentTabs').addEventListener('wheel',event=>{
  if(tabs.length<2||Math.abs(event.deltaY)<Math.abs(event.deltaX))return;
  event.preventDefault();if(Date.now()-last<140)return;last=Date.now();
  activateTab(tabs[(tabs.indexOf(activeTab)+(event.deltaY>0?1:tabs.length-1))%tabs.length]);
 },{passive:false});
 window.NoteMindScroll={anchor,apply};
})();
