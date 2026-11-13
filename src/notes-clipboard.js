(() => {
 const types={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp','image/avif':'avif','image/svg+xml':'svg'};
 const openable=/\.(nm|wm|wmpr|md|txt|py|docx|pdf)$/i;
 let serial=0,internal=false;
 const readBase64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
 const say=message=>{$('status').textContent=message;};
 // An HTML-only clipboard (no plain text beside it) becomes Markdown; pictures, scripts and styles are left out.
 function markdownFromHtml(html){const parsed=new DOMParser().parseFromString(html,'text/html');parsed.querySelectorAll('script,style,img,iframe,object,link,meta').forEach(n=>n.remove());return NoteMindDocument.toMarkdown(parsed.body.innerHTML).trim();}
 async function insertImages(files){
  for(const file of files){
   const stem=(file.name||'pasted-image').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9._-]/g,'-')||'pasted-image';
   if(!insertAsset('assets/'+Date.now()+'-'+(serial++)+'-'+stem+'.'+types[file.type],await readBase64(file)))return;
  }
 }
 const insertHtml=html=>{const markdown=markdownFromHtml(html);if(markdown)window.NoteMindWriting.insertMarkdown(markdown);return !!markdown;};
 // True when the clipboard was handled here; plain text and tables stay with the editor's own paste.
 function paste(event){
  const data=event.clipboardData,text=data.getData('text/plain'),html=data.getData('text/html'),images=[...data.files].filter(file=>types[file.type]);
  if(!text&&images.length){insertImages(images).catch(error=>say(error.message));return true;}
  if(!text&&html)return insertHtml(html);
  return false;
 }
 function caretAt(event){const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);if(range&&rich.contains(range.startContainer)){const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}}
 // Files dropped on the page: pictures go in, notes and documents open. Text dragged inside the editor moves as usual.
 function drop(event){
  const files=[...event.dataTransfer.files];
  if(files.length){
   event.preventDefault();if(event.currentTarget===rich)caretAt(event);
   const images=files.filter(file=>types[file.type]);
   if(images.length)insertImages(images).catch(error=>say(error.message));
   for(const file of files.filter(file=>!types[file.type])){const path=window.notemind.pathForFile?.(file);if(path&&openable.test(path))window.dispatchEvent(new CustomEvent('notemind-open-path',{detail:path}));}
   return;
  }
  if(internal){internal=false;return;}
  event.preventDefault();
  const text=event.dataTransfer.getData('text/plain'),html=event.dataTransfer.getData('text/html');
  if(event.currentTarget===rich)caretAt(event);
  if(text){if(visual)document.execCommand('insertText',false,text);else source.setRangeText(text,source.selectionStart,source.selectionEnd,'end');richChanged=visual||richChanged;markDirty();}
  else if(html)insertHtml(html);
 }
 const native=action=>{(visual?rich:source).focus();return window.notemind.editNative(action).catch(error=>say(error.message));};
 const hasSelection=()=>visual?!getSelection().isCollapsed:source.selectionStart!==source.selectionEnd;
 // The word under the pointer, when the spell checker does not know it.
 function misspelled(event){
  if(!visual||!window.notemind.spell)return null;
  const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);if(!range||range.startContainer.nodeType!==3||!rich.contains(range.startContainer))return null;
  const text=range.startContainer.data,letter=/[\p{L}'’]/u;let start=range.startOffset,end=start;
  while(start>0&&letter.test(text[start-1]))start--;while(end<text.length&&letter.test(text[end]))end++;
  const word=text.slice(start,end);if(!word||!window.notemind.spell.misspelled(word))return null;
  return {node:range.startContainer,start,end,word};
 }
 function items(event){
  const list=[],hit=misspelled(event);
  if(hit){
   const suggestions=window.notemind.spell.suggest(hit.word).slice(0,5);
   for(const suggestion of suggestions)list.push({label:suggestion,run:()=>{const range=document.createRange();range.setStart(hit.node,hit.start);range.setEnd(hit.node,hit.end);rich.focus();const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,suggestion);richChanged=true;markDirty();}});
   if(!suggestions.length)list.push({label:'No suggestions',disabled:true});
   list.push({label:'Add to Dictionary',run:()=>window.notemind.addToDictionary(hit.word)},'-');
  }
  list.push({label:'Cut',disabled:!hasSelection(),run:()=>native('cut')},{label:'Copy',disabled:!hasSelection(),run:()=>native('copy')},{label:'Paste',run:()=>native('paste')},{label:'Select All',run:()=>native('selectAll')},'-');
  return list;
 }
 for(const element of [rich,source]){
  element.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
  element.addEventListener('drop',drop);
 }
 rich.addEventListener('dragstart',()=>{internal=true;});document.addEventListener('dragend',()=>{internal=false;});
 source.addEventListener('paste',event=>{if(paste(event))event.preventDefault();});
 // The Markdown pane had no context menu of its own.
 source.addEventListener('contextmenu',event=>{
  event.preventDefault();const skip=new Set(['Insert Table','Table','Collapse Headings','Expand Headings']);
  window.notemindMenu([...items(event),...window.NoteMindWriting.items().filter(item=>item==='-'||!skip.has(item.label))],event.clientX,event.clientY);
 });
 window.NoteMindClipboard={paste,drop,items,markdownFromHtml};
})();
