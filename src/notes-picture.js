(() => {
 async function edit(img){
  const target=activeTab,original=img.dataset.asset,expected=doc.assets[original];if(!original||!expected)return;
  const release=NoteMindImagePreviews.pin(img);let image=img,pixels=null,d=null,shown=false,cleaned=false;
  const cleanup=()=>{if(cleaned)return;cleaned=true;if(pixels){pixels.width=0;pixels.height=0;pixels=null;}const preview=d?.querySelector('canvas');if(preview){preview.width=0;preview.height=0;}image=null;release();};
  try{
  await NoteMindImagePreviews.ensure(img);
  if(activeTab!==target||!img.isConnected||img.dataset.asset!==original||target.doc?.assets&&target.doc.assets[original]!==expected)return;
  d=document.createElement('dialog');d.className='shell-dialog picture-editor';
  d.innerHTML='<h2>Edit Picture</h2><p>Drag on the picture to select an area to crop.</p><div class="picture-preview"><canvas aria-label="Picture preview"></canvas></div><div class="picture-controls"><button type="button" data-act="left" title="Rotate picture 90° left">↶ Rotate left</button><button type="button" data-act="right" title="Rotate picture 90° right">↷ Rotate right</button><button type="button" data-act="crop" title="Keep only the selected area of the picture" disabled>Crop selection</button><button type="button" data-act="reset" title="Restore the original picture">Reset</button></div><div class="picture-controls"><label>Width <input data-width type="number" min="1" max="8192"></label><label>Height <input data-height type="number" min="1" max="8192"></label><label><input data-lock type="checkbox" checked> Keep proportions</label></div><p class="picture-message" role="status"></p><div class="dialog-actions"><button type="button" data-act="cancel" title="Close without applying picture edits">Cancel</button><button type="button" data-act="apply" title="Apply these picture edits to the Notepad" class="primary">Apply</button></div>';
  const canvas=d.querySelector('canvas'),ctx=canvas.getContext('2d'),width=d.querySelector('[data-width]'),height=d.querySelector('[data-height]'),lock=d.querySelector('[data-lock]'),crop=d.querySelector('[data-act=crop]'),message=d.querySelector('.picture-message');
  pixels=document.createElement('canvas');pixels.width=image.naturalWidth;pixels.height=image.naturalHeight;pixels.getContext('2d').drawImage(image,0,0);
  function replacePixels(next){const previous=pixels;pixels=next;previous.width=0;previous.height=0;}
  let selected=null,start=null,ratio=pixels.width/pixels.height;
  function dimensions(){width.value=pixels.width;height.value=pixels.height;ratio=pixels.width/pixels.height;}
  function draw(){canvas.width=pixels.width;canvas.height=pixels.height;ctx.drawImage(pixels,0,0);if(selected){ctx.save();ctx.strokeStyle='#1683ff';ctx.lineWidth=Math.max(2,canvas.width/300);ctx.setLineDash([ctx.lineWidth*3,ctx.lineWidth*2]);ctx.strokeRect(selected.x,selected.y,selected.width,selected.height);ctx.restore();}crop.disabled=!selected||selected.width<1||selected.height<1;}
  function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
  const releaseCrop=()=>{const held=start;start=null;if(held&&canvas.hasPointerCapture?.(held.pointerId))try{canvas.releasePointerCapture(held.pointerId);}catch{}};
  canvas.onpointerdown=e=>{if(start||e.button!==0)return;start={pointerId:e.pointerId,point:point(e)};selected=null;canvas.setPointerCapture(e.pointerId);draw();};
  canvas.onpointermove=e=>{if(!start||start.pointerId!==e.pointerId)return;selected=NoteMindPictureGeometry.selection(start.point,point(e),canvas.width,canvas.height);draw();};
  canvas.onpointerup=e=>{if(!start||start.pointerId!==e.pointerId)return;selected=NoteMindPictureGeometry.selection(start.point,point(e),canvas.width,canvas.height);releaseCrop();draw();};
  const cancelCrop=e=>{if(!start||start.pointerId!==e.pointerId||e.type==='lostpointercapture'&&canvas.hasPointerCapture?.(e.pointerId))return;releaseCrop();selected=null;draw();};
  canvas.onpointercancel=cancelCrop;canvas.onlostpointercapture=cancelCrop;
  const rotate=angle=>{releaseCrop();const next=document.createElement('canvas'),size=NoteMindPictureGeometry.output(pixels.width,pixels.height,angle);next.width=size.width;next.height=size.height;const c=next.getContext('2d');c.translate(next.width/2,next.height/2);c.rotate(angle*Math.PI/180);c.drawImage(pixels,-pixels.width/2,-pixels.height/2);replacePixels(next);selected=null;dimensions();draw();};
  d.querySelector('[data-act=left]').onclick=()=>rotate(-90);d.querySelector('[data-act=right]').onclick=()=>rotate(90);
  crop.onclick=()=>{if(!selected||!selected.width||!selected.height)return;releaseCrop();const next=document.createElement('canvas');next.width=selected.width;next.height=selected.height;next.getContext('2d').drawImage(pixels,selected.x,selected.y,selected.width,selected.height,0,0,next.width,next.height);replacePixels(next);selected=null;dimensions();draw();};
  d.querySelector('[data-act=reset]').onclick=()=>{releaseCrop();const next=document.createElement('canvas');next.width=image.naturalWidth;next.height=image.naturalHeight;next.getContext('2d').drawImage(image,0,0);replacePixels(next);selected=null;dimensions();draw();};
  width.oninput=()=>{if(lock.checked&&Number(width.value)>0)height.value=Math.max(1,Math.round(Number(width.value)/ratio));};height.oninput=()=>{if(lock.checked&&Number(height.value)>0)width.value=Math.max(1,Math.round(Number(height.value)*ratio));};
  d.querySelector('[data-act=cancel]').onclick=()=>d.close();
  d.querySelector('[data-act=apply]').onclick=()=>{const w=Number(width.value),h=Number(height.value);if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>8192||h>8192||w*h>32000000){message.textContent='Choose whole-number dimensions up to 8192 pixels and 32 million pixels total.';return;}if(activeTab!==target||!img.isConnected||img.dataset.asset!==original||doc.assets[original]!==expected){message.textContent='The original picture is no longer open.';return;}const result=document.createElement('canvas');try{result.width=w;result.height=h;result.getContext('2d').drawImage(pixels,0,0,w,h);const data=result.toDataURL('image/png').split(',')[1],name='assets/picture-'+crypto.randomUUID()+'.png';applyPixels(img,name,data);d.close();}finally{result.width=0;result.height=0;}};
  d.onclose=()=>{releaseCrop();cleanup();d.remove();};document.body.append(d);dimensions();draw();d.showModal();shown=true;
  }finally{if(!shown)cleanup();}
 }
 function applyPixels(img,name,data){
  const width=doc.meta?.imageWidths?.[img.dataset.asset];
  NoteMindHistory.transaction(()=>{
   doc.assets[name]=data;
   if(width)doc.meta={...doc.meta,imageWidths:{...doc.meta.imageWidths,[name]:width}};
   NoteMindImagePreviews.apply(img,name,data,'image/png');
   richChanged=true;markDirty();
  });
 }
 function displayWidth(img,width){
  if(width){img.setAttribute('data-image-width','');img.style.width=width+'px';}
  else{img.removeAttribute('data-image-width');img.style.removeProperty('width');}
 }
 function sizePicture(img,width){
  const name=img.dataset.asset,prior=doc.meta?.imageWidths?.[name];
  if(width===prior||!width&&!prior)return;
  let nextName=name,assets=doc.assets,meta={...doc.meta,imageWidths:{...doc.meta?.imageWidths}};
  const shared=[...rich.querySelectorAll('img[data-asset]')].filter(other=>other.dataset.asset===name).length>1;
  if(shared){
   // The size belongs to this placement. Share the original bytes and drawing sidecar under a separate name.
   nextName='assets/picture-'+crypto.randomUUID()+name.slice(name.lastIndexOf('.'));
   const sync=window.NoteMindDocumentSync;
   assets=sync?.copyAssets(doc.assets)||{...doc.assets};
   for(const suffix of ['', '.json'])if(Object.hasOwn(doc.assets,name+suffix)){
    const data=assets[nextName+suffix]=doc.assets[name+suffix],chunks=sync?.assetChunks(doc.assets,name+suffix);
    if(chunks)sync.hint(assets,nextName+suffix,data,chunks);
   }
   window.NoteMindAssetAdmission?.admit(assets,{chunks:(owned,key)=>sync?.assetChunks(owned,key)});
   if(meta.graphicsPanes?.[name])meta.graphicsPanes={...meta.graphicsPanes,[nextName]:meta.graphicsPanes[name]};
  }
  if(width)meta.imageWidths[nextName]=width;else delete meta.imageWidths[nextName];
  NoteMindHistory.transaction(()=>{
   doc.meta=meta;
   if(shared){
    doc.assets=assets;
    NoteMindImagePreviews.apply(img,nextName,assets[nextName],NoteMindDocument.mime(nextName));
    const pane=img.closest('.graphics-pane');if(pane)pane.dataset.graphicsPane=nextName;
    richChanged=true;
   }
   displayWidth(img,width);
   markDirty();
  });
 }
 function editSize(img){
  const tab=activeTab,name=img.dataset.asset,asset=doc.assets[name];
  const dialog=document.createElement('dialog');dialog.className='shell-dialog';
  dialog.innerHTML='<h2>Display Size</h2><label>Width at 100% (px) <input type="number" min="16" max="8192" step="1" required></label><div class="dialog-buttons"><button type="button" data-default>Use Default</button><button type="button" data-cancel>Cancel</button><button type="button" data-apply>Apply</button></div>';
  const field=dialog.querySelector('input');
  field.value=doc.meta?.imageWidths?.[name]||Math.max(16,img.clientWidth);
  const apply=width=>{
   if(tab!==activeTab||!img.isConnected||img.dataset.asset!==name||doc.assets[name]!==asset){dialog.close();return;}
   try{sizePicture(img,width);dialog.close();}catch(error){field.setCustomValidity(error.message);field.reportValidity();}
  };
  const save=()=>{if(field.reportValidity())apply(Number(field.value));};
  field.oninput=()=>field.setCustomValidity('');
  field.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();save();}};
  dialog.querySelector('[data-default]').onclick=()=>apply(null);
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  dialog.querySelector('[data-apply]').onclick=save;
  dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();field.select();
 }
 // A selected picture has a display resize handle and quick rotation controls outside the editable text.
 function installSelection(){
  const box=document.createElement('div');box.className='picture-selection';box.hidden=true;box.innerHTML='<div class="picture-selection-tools"><button type="button" data-rotate="-90" aria-label="Rotate picture left" title="Rotate picture 90° left">↶</button><button type="button" data-rotate="90" aria-label="Rotate picture right" title="Rotate picture 90° right">↷</button><button type="button" data-edit aria-label="Crop or resize picture" title="Crop or resize this picture">Crop…</button></div><button type="button" class="picture-resize-handle" aria-label="Drag to resize picture" title="Drag to resize the picture while keeping its proportions"></button>';document.body.append(box);
  let selected=null,owner=null,drag=null;
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>place()):null;
  const clear=()=>{selected=null;owner=null;observer?.disconnect();box.hidden=true;if(drag)finish({pointerId:drag.pointerId,preventDefault(){}},true);};
  function place(){if(!selected||!selected.isConnected||owner!==activeTab||!visual){clear();return;}const r=selected.getBoundingClientRect();if(!r.width||!r.height){box.hidden=true;return;}box.hidden=false;box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';const editor=rich.closest?.('.editor-wrap')?.getBoundingClientRect();if(editor)box.style.clipPath=`inset(${editor.top-r.top}px ${r.right-editor.right}px ${r.bottom-editor.bottom}px ${editor.left-r.left}px)`;}
  function commit(img,canvas,tab){if(tab!==activeTab||!img.isConnected)return;const data=canvas.toDataURL('image/png').split(',')[1],name='assets/picture-'+crypto.randomUUID()+'.png';applyPixels(img,name,data);img.addEventListener('load',place,{once:true});place();}
  const select=img=>{observer?.disconnect();observer?.observe(img);selected=img;owner=activeTab;place();};
  rich.addEventListener('click',e=>{const img=e.target.closest?.('img[data-asset]');if(!img||!rich.contains(img)){clear();return;}select(img);});
  document.addEventListener('pointerdown',e=>{if(!box.contains(e.target)&&!(selected&&(e.target===selected||selected.contains(e.target))))clear();},true);
  window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
  new MutationObserver(place).observe(rich,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  box.querySelector('[data-edit]').onclick=()=>{if(!selected)return;const img=selected;clear();edit(img).catch(error=>alert(error.message));};
  for(const button of box.querySelectorAll('[data-rotate]'))button.onclick=()=>{if(!selected)return;const img=selected,tab=owner,angle=Number(button.dataset.rotate);NoteMindImagePreviews.withImage(img,()=>{if(tab!==activeTab||!img.isConnected)return;const canvas=document.createElement('canvas'),size=NoteMindPictureGeometry.output(img.naturalWidth,img.naturalHeight,angle);if(!size.width||!size.height||size.width*size.height>32000000){alert('This picture is too large to rotate.');return;}canvas.width=size.width;canvas.height=size.height;const c=canvas.getContext('2d');c.translate(canvas.width/2,canvas.height/2);c.rotate(angle*Math.PI/180);c.drawImage(img,-img.naturalWidth/2,-img.naturalHeight/2);commit(img,canvas,tab);}).catch(error=>alert(error.message));};
  const handle=box.querySelector('.picture-resize-handle');
  handle.onpointerdown=e=>{
   if(drag||!selected||e.button!==0)return;
   e.preventDefault();e.stopPropagation();
   const img=selected,r=img.getBoundingClientRect(),zoom=Number(getComputedStyle(rich).zoom)||1;
   if(!(r.width>0&&r.height>0))return;
   try{handle.setPointerCapture(e.pointerId);}catch{return;}
   drag={pointerId:e.pointerId,img,tab:owner,name:img.dataset.asset,asset:doc.assets[img.dataset.asset],x:e.clientX,y:e.clientY,
    width:r.width/zoom,zoom,ratio:r.width/r.height,prior:doc.meta?.imageWidths?.[img.dataset.asset]};
  };
  const resize=e=>{
   if(!drag||drag.pointerId!==e.pointerId)return;
   const dx=e.clientX-drag.x,dy=(e.clientY-drag.y)*drag.ratio;
   const width=Math.round(drag.width+(Math.abs(dx)>=Math.abs(dy)?dx:dy)/drag.zoom);
   drag.next=Math.abs(width-drag.width)>1?Math.max(16,Math.min(8192,width)):null;
   displayWidth(drag.img,drag.next||drag.prior);place();
  };
  handle.onpointermove=resize;
  function finish(e,cancel){
   if(!drag||drag.pointerId!==e.pointerId||e.type==='lostpointercapture'&&handle.hasPointerCapture?.(e.pointerId))return;
   e.preventDefault();
   const eligible=()=>drag.tab===activeTab&&drag.img.isConnected&&drag.img.dataset.asset===drag.name&&doc.assets[drag.name]===drag.asset;
   if(!cancel&&eligible())resize(e);
   if(!drag)return;
   const current=drag,commit=!cancel&&eligible()&&current.next;
   drag=null;
   if(handle.hasPointerCapture?.(current.pointerId))try{handle.releasePointerCapture(current.pointerId);}catch{}
   displayWidth(current.img,current.prior);
   try{if(commit)sizePicture(current.img,current.next);}catch(error){alert(error.message);}
   place();
  }
  handle.onpointerup=e=>finish(e,false);handle.onpointercancel=e=>finish(e,true);handle.onlostpointercapture=e=>finish(e,true);
  // notes-image-gaps.js selects with the keyboard and deletes the selected picture.
  return {selected:()=>selected?.isConnected&&owner===activeTab?selected:null,select,clear};
 }
 window.NoteMindPicture={edit,editSize,...(typeof rich!=='undefined'&&document.body?installSelection():null)};
})();
