(() => {
 // Where each Notepad was scrolled to: the block (or line) at the top of the page and how far into it, so the same words
 // are on top when the tab comes forward again or the app reopens.
 const wrap=rich.parentElement,line=23;
 function anchor(){
  if(!activeTab)return null;
  if(visual){const blocks=[...rich.children],found=blocks.findIndex(el=>el.offsetTop+el.offsetHeight>wrap.scrollTop),at=Math.max(found,0);return {v:1,block:at,offset:Math.round(wrap.scrollTop-(blocks[at]?.offsetTop||0))};}
  return {v:0,line:Math.round(wrap.scrollTop/line)};
 }
 function apply(tab){
  const place=tab?.scroll;if(!place||place.v!==(visual?1:0))return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(activeTab!==tab)return;wrap.scrollTop=place.v?(rich.children[place.block]?.offsetTop||0)+(place.offset||0):(place.line||0)*line;}));
 }
 const original=window.activateTab;
 window.activateTab=function(tab){
  if(activeTab&&activeTab!==tab)activeTab.scroll=anchor();
  const result=original.call(this,tab);apply(tab);return result;
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
