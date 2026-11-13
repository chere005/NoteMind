(() => {
 const fence=/^\s*(```|~~~)/,heading=/^(#{1,6})\s/;
 // A section is a heading with everything under it, up to the next heading of the same or a higher level.
 // `levels[i]` is the heading level of block i (0 for anything else); the result says which blocks move and where to.
 function plan(levels,caret,direction){
  let start=Math.min(caret,levels.length-1);while(start>=0&&!levels[start])start--;
  if(start<0)return null;
  const level=levels[start];let end=start+1;while(end<levels.length&&!(levels[end]&&levels[end]<=level))end++;
  if(direction<0){let before=start-1;while(before>=0&&!(levels[before]&&levels[before]<=level))before--;return before<0||levels[before]<level?null:{start,end,target:before};}
  if(end>=levels.length||levels[end]<level)return null;
  let next=end+1;while(next<levels.length&&!(levels[next]&&levels[next]<=levels[end]))next++;
  return {start,end,target:next};
 }
 const reorder=(list,{start,end,target})=>{const moved=list.splice(start,end-start);list.splice(target>start?target-(end-start):target,0,...moved);return start<target?target-(end-start):target;};
 function sourceLevels(lines){let inside=false;return lines.map(line=>{if(fence.test(line)){inside=!inside;return 0;}const match=!inside&&line.match(heading);return match?match[1].length:0;});}
 function moveSection(direction){
  if(!visual){
   const lines=source.value.split('\n'),caretLine=source.value.slice(0,source.selectionStart).split('\n').length-1,tidy=lines[lines.length-1]!=='';
   // Every section ends with a blank line while it moves, so the last one is not glued to the next.
   if(tidy)lines.push('');
   const move=plan(sourceLevels(lines),caretLine,direction);
   if(!move)return;const at=reorder(lines,move);if(tidy)lines.pop();source.value=lines.join('\n');
   const offset=lines.slice(0,at).reduce((n,line)=>n+line.length+1,0);source.setSelectionRange(offset,offset);markDirty();return;
  }
  const blocks=[...rich.children],selection=getSelection();let node=selection.anchorNode;while(node&&node.parentElement!==rich)node=node.parentElement;
  const caret=Math.max(0,blocks.indexOf(node)),move=plan(blocks.map(el=>/^H[1-6]$/.test(el.tagName)?Number(el.tagName[1]):0),caret,direction);
  if(!move)return;const heading=blocks[move.start];reorder(blocks,move);
  NoteMindHistory.transaction(()=>{rich.replaceChildren(...blocks);richChanged=true;markDirty();});
  const range=document.createRange();range.selectNodeContents(heading);range.collapse(true);selection.removeAllRanges();selection.addRange(range);heading.scrollIntoView({block:'nearest'});
  window.NoteMindWriting.decorate();
 }
 // Collapse every heading below the one the caret is under; the heading itself stays open.
 function collapseSubsections(){
  if(!visual)return;const heads=[...rich.querySelectorAll(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6')];
  let node=getSelection().anchorNode;while(node&&node.parentElement!==rich)node=node.parentElement;
  const parent=heads.filter(h=>node&&(h.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING||h===node)).pop();if(!parent)return;
  const level=Number(parent.tagName[1]),below=[];for(let el=parent.nextElementSibling;el;el=el.nextElementSibling){if(/^H[1-6]$/.test(el.tagName)){if(Number(el.tagName[1])<=level)break;below.push(el.dataset.headingKey);}}
  doc.meta||={};doc.meta.collapsed=[...new Set([...(doc.meta.collapsed||[]),...below])];markDirty();window.NoteMindWriting.decorate();
 }
 const commands={moveSectionUp:()=>moveSection(-1),moveSectionDown:()=>moveSection(1),foldAll:()=>window.NoteMindWriting.collapseAll(true),unfoldAll:()=>window.NoteMindWriting.collapseAll(false),collapseSubsections};
 window.addEventListener('notemind-command',e=>{const run=commands[e.detail];if(run)run();});

 // Markdown pane: a quote continues on Return, and Backspace in the indentation takes one level.
 source.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||source.selectionStart!==source.selectionEnd)return;
  const at=source.selectionStart,from=source.value.lastIndexOf('\n',at-1)+1,line=source.value.slice(from,at);
  if(e.key==='Enter'&&!e.shiftKey){const quote=line.match(/^(\s*>+ ?)(.*)$/);if(!quote)return;e.preventDefault();if(!quote[2].trim())source.setRangeText('',from,at,'end');else source.setRangeText('\n'+quote[1],at,at,'end');markDirty();}
  if(e.key==='Backspace'&&/^ +$/.test(line)){e.preventDefault();const remove=((line.length-1)%4)+1;source.setRangeText('',at-remove,at,'end');markDirty();}
 });

 // Code blocks close what they open: ( [ { " ' ` — typing the closer steps over it and Backspace takes both.
 const pairs={'(':')','[':']','{':'}','"':'"',"'":"'",'`':'`'},closers=new Set(Object.values(pairs));
 const insideSourceFence=at=>source.value.slice(0,at).split('\n').reduce((open,line)=>fence.test(line)?!open:open,false);
 source.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.defaultPrevented)return;
  const start=source.selectionStart,end=source.selectionEnd;if(!insideSourceFence(start))return;
  const value=source.value,next=value[end],previous=value[start-1];
  if(closers.has(e.key)&&e.key===next&&start===end){e.preventDefault();source.setSelectionRange(end+1,end+1);return;}
  if(pairs[e.key]){
   if('"\'`'.includes(e.key)&&start===end&&/[\p{L}\p{N}_]/u.test(previous||''))return;
   e.preventDefault();const chosen=value.slice(start,end);source.setRangeText(e.key+chosen+pairs[e.key],start,end,'preserve');source.setSelectionRange(start+1,start+1+chosen.length);markDirty();return;
  }
  if(e.key==='Backspace'&&start===end&&pairs[previous]===next&&previous){e.preventDefault();source.setRangeText('',start-1,start+1,'end');markDirty();}
 });
 rich.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.defaultPrevented)return;
  const selection=getSelection();if(!selection.rangeCount)return;const range=selection.getRangeAt(0),element=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  if(!element?.closest('pre'))return;
  const text=range.startContainer.nodeType===3?range.startContainer.data:'',offset=range.startOffset,next=text[offset],previous=text[offset-1];
  if(closers.has(e.key)&&e.key===next&&range.collapsed){e.preventDefault();selection.modify('move','forward','character');return;}
  if(pairs[e.key]){
   if('"\'`'.includes(e.key)&&range.collapsed&&/[\p{L}\p{N}_]/u.test(previous||''))return;
   e.preventDefault();const chosen=selection.toString();document.execCommand('insertText',false,e.key+chosen+pairs[e.key]);selection.modify('move','backward','character');
   if(chosen)for(let i=0;i<chosen.length;i++)selection.modify('extend','backward','character');
   richChanged=true;markDirty();return;
  }
  if(e.key==='Backspace'&&range.collapsed&&previous&&pairs[previous]===next){e.preventDefault();selection.modify('move','forward','character');document.execCommand('delete');document.execCommand('delete');richChanged=true;markDirty();}
 });
 window.NoteMindStructure={plan,moveSection,collapseSubsections};
})();
