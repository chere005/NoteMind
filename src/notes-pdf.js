(() => {
 // File > Export as PDF…: the options, remembered, and a preview of the first page at the chosen paper and margins.
 const stored=()=>{try{return JSON.parse(localStorage.getItem('notemind.pdfExport')||'{}');}catch{return {};}};
 const options=()=>({pageSize:'A4',orientation:'portrait',margin:'normal',pageNumbers:false,clean:false,open:false,...stored()});
 const choose=(label,name,list)=>'<label>'+label+' <select data-k="'+name+'">'+list.map(([value,text])=>'<option value="'+value+'">'+text+'</option>').join('')+'</select></label>';
 const toggle=(label,name)=>'<label class="pdf-toggle"><input type="checkbox" data-k="'+name+'"> '+label+'</label>';
 const captureDocument=()=>structuredClone({...doc,text:currentText()});
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
   const html=new Map();let serial=0;
   async function draw(){
    const mine=++serial,next=read();note.textContent='Preparing preview…';try{localStorage.setItem('notemind.pdfExport',JSON.stringify(next));}catch{}
    const geometry=await window.notemind.pdfGeometry(request(next));if(mine!==serial)return;
    const px=inches=>Math.round(inches*96),width=px(geometry.width),height=px(geometry.height),scale=Math.min(1,320/width);
    frame.style.width=Math.round(width*scale)+'px';frame.style.height=Math.round(height*scale)+'px';
    sheet.style.cssText='width:'+width+'px;height:'+height+'px;transform:scale('+scale+')';
    const m=geometry.margins,printable=height-px(m.top)-px(m.bottom);
    iframe.style.cssText='left:'+px(m.left)+'px;top:'+px(m.top)+'px;width:'+(width-px(m.left)-px(m.right))+'px;height:'+printable+'px';
    if(!html.has(next.clean))html.set(next.clean,window.notemind.printHtml(snapshot,{clean:next.clean}));
    let preview;try{preview=await html.get(next.clean);}catch(error){html.delete(next.clean);throw error;}
    if(mine!==serial)return;
    note.textContent='First page. Page breaks are set when you export.';
    iframe.onload=()=>{try{const pages=Math.max(1,Math.ceil(iframe.contentDocument.documentElement.scrollHeight/printable));folio.textContent=next.pageNumbers?'1 / '+pages:'';}catch{folio.textContent=next.pageNumbers?'1':'';}};
    iframe.srcdoc=preview;
    folio.style.cssText='bottom:'+Math.round(px(m.bottom)/2-6)+'px';
    folio.textContent=next.pageNumbers?'1':'';
   }
   const showError=error=>{note.textContent='Could not prepare preview: '+error.message;};
   for(const field of fields)field.addEventListener('change',()=>draw().catch(showError));
   let result=null;
   d.querySelector('[data-cancel]').onclick=()=>d.close();
   d.querySelector('[data-go]').onclick=()=>{result=request(read());d.close();};
   d.onclose=()=>{serial++;resolve(result);d.remove();};
   document.body.append(d);d.showModal();draw().catch(showError);
  });
 }
 async function exportPdf(){
  const snapshot=captureDocument(),chosen=await dialog(snapshot);if(!chosen)return;
  $('status').textContent='Exporting…';
  const file=await window.notemind.exportDocument(snapshot,'pdf',chosen);
  $('status').textContent=file?'Exported '+file:'Ready';
 }
 window.addEventListener('notemind-command',e=>{if(e.detail==='exportPDF')action(exportPdf);});
 window.NoteMindPdf={dialog,exportPdf};
})();
