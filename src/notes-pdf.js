(() => {
 // File > Export as PDF…: the options, remembered, and a preview of the first page at the chosen paper and margins.
 const stored=()=>{try{return JSON.parse(localStorage.getItem('notemind.pdfExport')||'{}');}catch{return {};}};
 const options=()=>({pageSize:'A4',orientation:'portrait',margin:'normal',pageNumbers:false,clean:false,open:false,...stored()});
 const choose=(label,name,list)=>'<label>'+label+' <select data-k="'+name+'">'+list.map(([value,text])=>'<option value="'+value+'">'+text+'</option>').join('')+'</select></label>';
 const toggle=(label,name)=>'<label class="pdf-toggle"><input type="checkbox" data-k="'+name+'"> '+label+'</label>';
 const captureDocument=()=>window.NoteMindDocumentSync?.capture({...doc,text:currentText()})||structuredClone({...doc,text:currentText()});
 function dialog(snapshot=captureDocument()){
  return new Promise(resolve=>{
   const d=document.createElement('dialog');d.className='shell-dialog pdf-dialog';
   d.innerHTML='<h2>Export as PDF</h2><div class="pdf-layout"><div class="pdf-controls">'
    +choose('Paper','pageSize',[['A4','A4'],['Letter','Letter']])
    +choose('Orientation','orientation',[['portrait','Portrait'],['landscape','Landscape']])
    +choose('Margins','margin',[['normal','Normal (0.75 in)'],['narrow','Narrow (0.5 in)'],['none','None']])
    +toggle('Page numbers (1 / N)','pageNumbers')+toggle('Remove picture backgrounds','clean')+toggle('Open after export','open')
    +'</div><div class="pdf-preview"><div class="pdf-frame"><div class="pdf-sheet"><iframe sandbox="allow-same-origin" scrolling="no" title="Preview of the first page"></iframe><div class="pdf-folio"></div></div></div><p class="pdf-note">First page. Page breaks are set when you export.</p></div></div>'
    +'<div class="dialog-actions"><button data-cancel title="Cancel PDF export">Cancel</button><button data-go title="Choose where to save the PDF">Export…</button></div>';
   const value=options(),fields=[...d.querySelectorAll('[data-k]')],frame=d.querySelector('.pdf-frame'),sheet=d.querySelector('.pdf-sheet'),iframe=d.querySelector('iframe'),folio=d.querySelector('.pdf-folio'),note=d.querySelector('.pdf-note');
   for(const field of fields){if(field.type==='checkbox')field.checked=!!value[field.dataset.k];else field.value=value[field.dataset.k];}
   const read=()=>{const next={};for(const field of fields)next[field.dataset.k]=field.type==='checkbox'?field.checked:field.value;return next;};
   const request=next=>({pageSize:next.pageSize,landscape:next.orientation==='landscape',margin:next.margin,pageNumbers:next.pageNumbers,clean:next.clean,open:next.open});
   const html=new Map(),pictures=new Map();let serial=0,activePreview=null,closed=false;const retiring=new Set();const printTokens=new Set();
   const rememberPrint=preview=>{const token=/<meta name="notemind-print-assets" content="([a-f0-9-]{36})">/i.exec(preview)?.[1];if(token){if(closed)void window.notemind.releasePrintAssets?.(token).catch(()=>{});else printTokens.add(token)}return preview};
   const releasePreview=()=>{const preview=activePreview;activePreview=null;if(preview){preview.controller.abort();const done=preview.consumers.retire();retiring.add(done);void done.finally(()=>retiring.delete(done));}return Promise.allSettled([...retiring]);};
   async function draw(){
    const mine=++serial,next=read();releasePreview();const previewOwner={controller:new AbortController(),consumers:NoteMindImagePreviews.consumerPool()};activePreview=previewOwner;note.textContent='Preparing preview…';try{localStorage.setItem('notemind.pdfExport',JSON.stringify(next));}catch{}
    const geometry=await window.notemind.pdfGeometry(request(next));if(mine!==serial)return;
    const px=inches=>Math.round(inches*96),width=px(geometry.width),height=px(geometry.height),scale=Math.min(1,320/width);
    frame.style.width=Math.round(width*scale)+'px';frame.style.height=Math.round(height*scale)+'px';
    sheet.style.cssText='width:'+width+'px;height:'+height+'px;transform:scale('+scale+')';
    const m=geometry.margins,printable=height-px(m.top)-px(m.bottom);
    iframe.style.cssText='left:'+px(m.left)+'px;top:'+px(m.top)+'px;width:'+(width-px(m.left)-px(m.right))+'px;height:'+printable+'px';
    const key=window.NoteMindDocumentSync?'layout':next.clean;
    if(!html.has(key))html.set(key,(window.NoteMindDocumentSync?window.NoteMindDocumentSync.call('printHtml',snapshot,{preview:true}):window.notemind.printHtml(snapshot,{clean:next.clean})).then(rememberPrint));
    let preview;try{preview=await html.get(key);}catch(error){html.delete(key);throw error;}
    if(mine!==serial)return;
    note.textContent='First page. Page breaks are set when you export.';
    iframe.onload=()=>{if(mine!==serial)return;const load=async()=>{const view=iframe.contentDocument,pages=Math.max(1,Math.ceil(view.documentElement.scrollHeight/printable));folio.textContent=next.pageNumbers?(view.querySelector('meta[name=notemind-preview-truncated]')?'1':'1 / '+pages):'';if(!window.NoteMindDocumentSync)return;const images=[...view.querySelectorAll('img[data-asset]')].filter(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<printable;}),names=[...new Set(images.map(img=>img.getAttribute('data-asset')))].filter(name=>typeof snapshot.assets[name]==='string'),pictureKey=JSON.stringify([next.clean,names]);if(!names.length)return;if(!pictures.has(pictureKey))pictures.set(pictureKey,window.NoteMindDocumentSync.call('previewImages',{id:snapshot.id,text:'',assets:window.NoteMindDocumentSync.copyAssets(snapshot.assets,names),meta:{}},{clean:next.clean}));let prepared;try{prepared=await pictures.get(pictureKey);}catch(error){pictures.delete(pictureKey);throw error;}if(mine!==serial)return;const current=[];try{for(const img of images){if(closed||mine!==serial)return;const name=img.getAttribute('data-asset'),data=prepared.assets[name];if(!data)continue;const lease=await NoteMindImagePreviews.leaseAsync(name,data,'image/png',{signal:previewOwner.controller.signal});if(closed||mine!==serial){lease.release();return;}current.push(previewOwner.consumers.hold(lease,()=>{img.loading='eager';img.src=lease.url;return img.decode();}));}await Promise.all(current);if(closed||mine!==serial)void previewOwner.consumers.retire();}catch(error){void previewOwner.consumers.retire();throw error;}};void load().catch(error=>{if(mine===serial)showError(error);});};
    iframe.srcdoc=preview;
    folio.style.cssText='bottom:'+Math.round(px(m.bottom)/2-6)+'px';
    folio.textContent=next.pageNumbers?'1':'';
   }
   const showError=error=>{note.textContent='Could not prepare preview: '+error.message;};
   for(const field of fields)field.addEventListener('change',()=>draw().catch(showError));
   let result=null;
   d.querySelector('[data-cancel]').onclick=()=>d.close();
   d.querySelector('[data-go]').onclick=()=>{result=request(read());d.close();};
   d.onclose=()=>{closed=true;serial++;const drained=releasePreview();for(const token of printTokens)void window.notemind.releasePrintAssets?.(token).catch(()=>{});printTokens.clear();html.clear();pictures.clear();iframe.onload=null;iframe.srcdoc='';d.remove();void drained.then(()=>resolve(result));};
   document.body.append(d);d.showModal();draw().catch(showError);
  });
 }
 async function exportPdf(){
  const snapshot=captureDocument(),chosen=await dialog(snapshot);if(!chosen)return;
  $('status').textContent='Exporting…';
  const file=await (window.NoteMindDocumentSync?window.NoteMindDocumentSync.call('exportDocument',snapshot,'pdf',chosen):window.notemind.exportDocument(snapshot,'pdf',chosen));
  $('status').textContent=file?'Exported '+file:'Ready';
 }
 window.addEventListener('notemind-command',e=>{if(e.detail==='exportPDF')action(exportPdf);});
 window.NoteMindPdf={dialog,exportPdf};
})();
