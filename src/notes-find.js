(() => {
 // A card at the top right of the page: it floats, so finding never moves the note. Both modes, match case, whole word, replace.
 const bar=document.createElement('div');bar.className='note-find';bar.hidden=true;bar.setAttribute('role','search');
 bar.innerHTML='<div class="find-row"><input type="search" placeholder="Find in Notepad" aria-label="Find in Notepad"><span role="status"></span><button data-prev title="Previous match (Shift+F3)" aria-label="Previous match">↑</button><button data-next title="Next match (F3)" aria-label="Next match">↓</button><button data-case class="find-toggle" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button><button data-word class="find-toggle" title="Whole word" aria-label="Whole word" aria-pressed="false">ab</button><button data-close title="Close find" aria-label="Close find">×</button></div><div class="find-row find-replace" hidden><input type="text" placeholder="Replace with" aria-label="Replace with"><button data-replace title="Replace the current match">Replace</button><button data-all title="Replace every match in this Notepad">Replace All</button></div>';
 $('toolbar').after(bar);
 const [input,replacement]=bar.querySelectorAll('input'),count=bar.querySelector('[role=status]'),replaceRow=bar.querySelector('.find-replace');
 const button=name=>bar.querySelector('[data-'+name+']');
 const word=/[\p{L}\p{N}_]/u;
 let options={matchCase:false,wholeWord:false},matches=[],index=-1;
 try{options={...options,...JSON.parse(localStorage.getItem('notemind.find')||'{}')};}catch{}
 const syncToggles=()=>{button('case').setAttribute('aria-pressed',String(options.matchCase));button('word').setAttribute('aria-pressed',String(options.wholeWord));};
 const saveOptions=()=>{try{localStorage.setItem('notemind.find',JSON.stringify(options));}catch{}};
 syncToggles();
 // The [start,end) spans of the query in `text`, honouring match case and whole word.
 function scan(text){
  const found=[],query=input.value;if(!query)return found;
  const needle=options.matchCase?query:query.toLocaleLowerCase(),hay=options.matchCase?text:text.toLocaleLowerCase(),firstMatch=hay.indexOf(needle),blocks=[];let mapped=0;
  if(firstMatch<0)return found;
  // BMP characters with unchanged lowercase width keep their source offsets.
  // Only expansions and surrogate pairs need records; ASCII needs no map.
  if(!options.matchCase&&/[^\x00-\x7f]/.test(text)){
   let offset=0,lower=0;
   for(const character of text){const length=character.toLocaleLowerCase().length;
    if(character.length!==1||length!==1){const block=mapped>>>10,at=(mapped&1023)*4;blocks[block] ||=new Uint32Array(4096);blocks[block][at]=lower;blocks[block][at+1]=lower+length;blocks[block][at+2]=offset;blocks[block][at+3]=offset+character.length;mapped++;}
    offset+=character.length;lower+=length;
   }
  }
  function sourceOffset(position,end=false){
   if(!mapped)return position+Number(end);let low=0,high=mapped;
   while(low<high){const middle=(low+high)>>>1,block=blocks[middle>>>10],at=(middle&1023)*4;if(block[at]<=position)low=middle+1;else high=middle;}
   if(!low)return position+Number(end);const index=low-1,block=blocks[index>>>10],at=(index&1023)*4;
   return position<block[at+1]?block[at+(end?3:2)]:position+Number(end)+block[at+3]-block[at+1];
  }
  let from=firstMatch,at;while((at=hay.indexOf(needle,from))>=0){const stop=at+needle.length,start=options.matchCase?at:sourceOffset(at),end=options.matchCase?stop:sourceOffset(stop-1,true);let before=start-1;if(before>0&&/[\uDC00-\uDFFF]/.test(text[before]))before--;const left=start>0?text.slice(before,start):'',right=end<text.length?String.fromCodePoint(text.codePointAt(end)):'';
   if((!options.wholeWord||(!word.test(left)&&!word.test(right)))&&!(found.at(-1)?.[0]===start&&found.at(-1)?.[1]===end))found.push([start,end]);from=stop;}

  return found;
 }
 const clearHighlights=()=>{CSS.highlights?.delete('note-find');CSS.highlights?.delete('note-current');};
 let cached=null,richRevision=0,observedRich=rich;
 const invalidate=()=>{richRevision++;cached=null;};
 const observer=typeof MutationObserver==='function'?new MutationObserver(invalidate):null;
 const observe=()=>observer?.observe(rich,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-editor-control']});
 observe();
 function stamp(){
  if(observedRich!==rich){observer?.disconnect();observedRich=rich;invalidate();observe();}
  // A command can follow a programmatic edit in the same turn, before delivery.
  if(observer?.takeRecords().length)invalidate();
  const tab=typeof activeTab==='undefined'?null:activeTab,node=visual?rich:source;
  return [input.value,options.matchCase,options.wholeWord,visual,doc,tab,tab?.editVersion,node,document,node.ownerDocument||document,CSS.highlights,visual?richRevision:source.value];
 }
 const sameStamp=(a,b)=>!!a&&a.length===b.length&&a.every((value,at)=>Object.is(value,b[at]));
 function refresh(){
  if(bar.hidden)return;
  if(!input.value){cached=null;matches=[];clearHighlights();count.textContent='';button('prev').disabled=button('next').disabled=true;return;}
  const current=stamp();
  // Without an observer, visual edits have no reliable invalidation receipt.
  if((!visual||observer)&&sameStamp(cached?.stamp,current)){
   if(cached.highlight&&CSS.highlights?.get('note-find')!==cached.highlight)CSS.highlights?.set('note-find',cached.highlight);
  }else{
   matches=[];clearHighlights();let highlight=null;
   if(!visual)matches=scan(current.at(-1)).map(([start,end])=>({start,end}));
   else{
   const nodes=[],walker=document.createTreeWalker(rich,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode:n=>(n.nodeType===1?n:n.parentElement).closest('[data-editor-control]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let text='',node,block=null;
   while((node=walker.nextNode())){if(node.nodeType===1){if(node.tagName==='BR')text+='\n';continue;}const owner=node.parentElement.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote,div,section')||rich;if(nodes.length&&owner!==block&&!text.endsWith('\n'))text+='\n';block=owner;nodes.push({node,start:text.length,end:text.length+node.length});text+=node.textContent;}
   let startIndex=0,endIndex=0;
   for(const [at,stop] of scan(text)){while(startIndex<nodes.length&&nodes[startIndex].end<=at)startIndex++;endIndex=Math.max(endIndex,startIndex);while(endIndex<nodes.length&&nodes[endIndex].end<stop)endIndex++;const start=nodes[startIndex],end=nodes[endIndex];if(start&&end){const range=document.createRange();range.setStart(start.node,at-start.start);range.setEnd(end.node,stop-end.start);matches.push(range);}}
    if(CSS.highlights){highlight=new Highlight();for(const match of matches)highlight.add(match);CSS.highlights.set('note-find',highlight);}
   }
   cached={stamp:current,highlight};
  }
  index=Math.min(Math.max(index,0),matches.length-1);
  count.textContent=matches.length?(index+1)+' of '+matches.length:'No matches';button('prev').disabled=button('next').disabled=!matches.length;
 }
 function show(){
  if(!matches.length)return;const m=matches[index];count.textContent=(index+1)+' of '+matches.length;
  if(!visual){source.setSelectionRange(m.start,m.end);const line=source.value.slice(0,m.start).split('\n').length;source.parentElement.scrollTop=(line-1)*23-source.parentElement.clientHeight/2;}
  else{if(doc.meta?.collapsed?.length){doc.meta.collapsed=[];window.NoteMindWriting.decorate();markDirty();refresh();}CSS.highlights?.set('note-current',new Highlight(matches[index]));matches[index].startContainer.parentElement.scrollIntoView({block:'center'});}
 }
 function move(delta){refresh();if(!matches.length)return;index=(index+delta+matches.length)%matches.length;show();}
 function open({replace}={}){
  bar.style.top=($('toolbar').offsetTop+$('toolbar').offsetHeight+6)+'px';bar.hidden=false;if(replace!==undefined)replaceRow.hidden=!replace;
  index=-1;input.focus();input.select();refresh();
 }
 // Escape gives the caret back where the match was.
 function close(){const current=stamp(),match=visual&&sameStamp(cached?.stamp,current)?matches[index]:null;bar.hidden=true;clearHighlights();cached=null;matches=[];index=-1;(visual?rich:source).focus();if(match){const selection=getSelection();selection.removeAllRanges();selection.addRange(match);}}
 const selectedText=()=>visual?getSelection().toString():source.value.slice(source.selectionStart,source.selectionEnd);
 function useSelection(){const text=selectedText();if(!text||text.includes('\n'))return;if(bar.hidden)open();input.value=text;index=-1;move(0);}
 // One match replaced; the next one comes forward.
 function replaceCurrent(){
  refresh();if(!matches.length)return;if(index<0)index=0;const m=matches[index],text=replacement.value;let after;
  if(!visual){source.setRangeText(text,m.start,m.end,'end');after=m.start+text.length;}
  else{const selection=getSelection();rich.focus();selection.removeAllRanges();selection.addRange(m);document.execCommand(text?'insertText':'delete',false,text);after=selection.getRangeAt(0).cloneRange();after.collapse(false);richChanged=true;}
  markDirty();refresh();index=matches.findIndex(match=>visual?match.compareBoundaryPoints(Range.START_TO_START,after)>=0:match.start>=after);if(index<0)index=0;show();
 }
 // Every match, back to front so earlier spans stay valid; one step of Undo.
 function replaceAll(){
  refresh();if(!matches.length)return;const text=replacement.value,total=matches.length;
  NoteMindHistory.transaction(()=>{
   if(!visual)for(const m of [...matches].reverse())source.setRangeText(text,m.start,m.end,'end');
   else{const selection=getSelection();rich.focus();for(const range of [...matches].reverse()){selection.removeAllRanges();selection.addRange(range);document.execCommand(text?'insertText':'delete',false,text);}richChanged=true;}
   markDirty();
  });
  index=-1;refresh();$('status').textContent='Replaced '+total+(total===1?' match':' matches');
 }
 input.oninput=()=>{index=-1;move(0);};
 input.onkeydown=e=>{if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();move(e.shiftKey?-1:1);}if(e.key==='Escape'){e.preventDefault();close();}};
 replacement.onkeydown=e=>{if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();if(e.ctrlKey||e.metaKey)replaceAll();else replaceCurrent();}if(e.key==='Escape'){e.preventDefault();close();}};
 button('prev').onclick=()=>move(-1);button('next').onclick=()=>move(1);button('close').onclick=close;button('replace').onclick=replaceCurrent;button('all').onclick=replaceAll;
 button('case').onclick=()=>{options.matchCase=!options.matchCase;syncToggles();saveOptions();index=-1;move(0);};
 button('word').onclick=()=>{options.wholeWord=!options.wholeWord;syncToggles();saveOptions();index=-1;move(0);};
 rich.addEventListener('input',refresh);source.addEventListener('input',refresh);
 window.addEventListener('unload',()=>{observer?.disconnect();cached=null;matches=[];clearHighlights();});
 window.addEventListener('notemind-command',e=>{
  if(e.detail==='findNote')open({replace:bar.hidden?false:undefined});
  if(e.detail==='findReplace'){open({replace:true});(selectedText()&&!selectedText().includes('\n')?useSelection:()=>{})();}
  if(e.detail==='findNext'){if(bar.hidden)open();move(1);}
  if(e.detail==='findPrevious'){if(bar.hidden)open();move(-1);}
  if(e.detail==='findSelection')useSelection();
 });
 document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;
  const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
  if(mod&&key==='f'&&!e.shiftKey){e.preventDefault();open({replace:bar.hidden?false:undefined});}
 });
 window.NoteMindFind={open,close,refresh,move,replaceAll,replaceCurrent,useSelection,get matches(){return matches.length;}};
})();
