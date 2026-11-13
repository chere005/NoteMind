(() => {
 // The footer: a word count of the words you can see, when the Notepad was last saved, and the page zoom.
 const footer=document.querySelector('main footer'),levels=[50,75,90,100,110,125,150,175,200];
 const make=(tag,id)=>{const element=document.createElement(tag);element.id=id;footer.insertBefore(element,$('modeLabel'));return element;};
 const words=make('span','wordCount'),saved=make('span','savedAt'),zoom=make('select','zoomBox');
 zoom.title='Zoom the page';zoom.setAttribute('aria-label','Zoom');
 for(const level of levels){const option=document.createElement('option');option.value=level;option.textContent=level+'%';zoom.append(option);}
 zoom.value='100';
 const count=text=>(text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)||[]).length;
 // Visible words only: folded sections and Markdown markers do not count.
 function visibleText(){if(visual){const copy=rich.cloneNode(true);copy.querySelectorAll('.missing-image,[data-editor-control],.heading-folded').forEach(n=>n.remove());return copy.textContent;}const box=document.createElement('div');box.innerHTML=NoteMindDocument.render(source.value);box.querySelectorAll('.missing-image,[data-editor-control]').forEach(n=>n.remove());return box.textContent;}
 let signature='';
 function update(force){
  const next=(visual?'v'+rich.textContent.length+':'+rich.childElementCount+':'+rich.querySelectorAll('.heading-folded').length:'m'+source.value.length)+':'+(activeTab?.id||'');
  if(!force&&next===signature)return;signature=next;
  const total=count(visibleText());words.textContent=total+(total===1?' word':' words');
 }
 setInterval(update,500);rich.addEventListener('input',()=>update(true));source.addEventListener('input',()=>update(true));update(true);
 new MutationObserver(()=>{if(/^(Saved|Autosaved)\b/.test($('status').textContent))saved.textContent='Saved '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}).observe($('status'),{childList:true,characterData:true,subtree:true});
 let savedTab=activeTab?.id;
 window.addEventListener('notemind-document',event=>{if(event.detail.activeId!==savedTab){savedTab=event.detail.activeId;saved.textContent='';}});

 let writing;
 function setZoom(percent,remember=true){
  percent=levels.includes(percent)?percent:100;zoom.value=String(percent);rich.style.zoom=source.style.zoom=String(percent/100);signature='';update(true);
  if(remember){clearTimeout(writing);writing=setTimeout(()=>window.notemind.preferenceSet?.('view',{zoom:percent}).catch(()=>{}),250);}
 }
 const step=delta=>setZoom(levels[Math.min(levels.length-1,Math.max(0,levels.indexOf(Number(zoom.value))+delta))]);
 zoom.onchange=()=>setZoom(Number(zoom.value));
 window.addEventListener('notemind-command',e=>{if(e.detail==='zoomIn')step(1);if(e.detail==='zoomOut')step(-1);if(e.detail==='zoomReset')setZoom(100);});
 window.notemind.preferenceGet?.('view').then(view=>{if(view&&typeof view.zoom==='number')setZoom(view.zoom,false);}).catch(()=>{});
 window.NoteMindFooter={update,setZoom,get zoom(){return Number(zoom.value);}};
})();
