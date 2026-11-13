(() => {
  const styles=[['p','Body'],['h1','Heading 1'],['h2','Heading 2'],['h3','Heading 3'],['h4','Heading 4'],['h5','Heading 5'],['h6','Heading 6'],['blockquote','Quote'],['pre','Code Block'],['ul','Bulleted List'],['ol','Numbered List'],['task','Checklist']];
  const button=$('heading');let saved=null;
  button.title='Text style';button.setAttribute('aria-label','Text style');button.setAttribute('aria-haspopup','menu');
  const element=()=>{const selection=getSelection(),n=selection?.anchorNode;return n===rich?(rich.childNodes[selection.anchorOffset]?.nodeType===1?rich.childNodes[selection.anchorOffset]:rich.childNodes[selection.anchorOffset]?.parentElement)||rich.lastElementChild:n?.nodeType===1?n:n?.parentElement;};
  const inTable=()=>{if(!visual)return false;if(element()?.closest('td,th'))return true;const selection=getSelection();return !!(selection?.rangeCount&&!selection.isCollapsed&&[...rich.querySelectorAll('table')].some(table=>selection.getRangeAt(0).intersectsNode(table)));};
  function sourceScope() {
    const value=source.value,a=source.selectionStart,b=source.selectionEnd,start=value.lastIndexOf('\n',a-1)+1,endAt=value.indexOf('\n',b>a&&value[b-1]==='\n'?b-1:b),end=endAt<0?value.length:endAt;
    let offset=0,open=null;
    for(const line of value.split('\n')) {
      const match=line.match(/^ {0,3}(`{3,}|~{3,})/);
      if(match){if(!open)open={start:offset,marker:match[1],body:offset+line.length+1};else if(match[1][0]===open.marker[0]&&match[1].length>=open.marker.length){if(a>=open.start&&a<=offset+line.length)return {start:open.start,end:offset+line.length,code:true,text:value.slice(open.body,Math.max(open.body,offset-1))};open=null;}}
      offset+=line.length+1;
    }
    if(open&&a>=open.start)return {start:open.start,end:value.length,code:true,text:value.slice(open.body)};
    return {start,end,code:false,text:value.slice(start,end)};
  }
  function lineStyle(line){if(/^\s*[-*+] \[[ xX]\] /.test(line))return 'task';if(/^\s*[-*+] /.test(line))return 'ul';if(/^\s*\d+[.)] /.test(line))return 'ol';const h=line.match(/^ {0,3}(#{1,6})\s/);if(h)return 'h'+h[1].length;if(/^\s*>/.test(line))return 'blockquote';return 'p';}
  function current() {
    if(!visual){const scope=sourceScope();if(scope.code)return 'pre';const values=new Set(scope.text.split('\n').filter(Boolean).map(lineStyle));return values.size>1?'mixed':[...values][0]||'p';}
    const el=element();if(!el||!rich.contains(el))return 'p';
    const list=el.closest('li')||el.querySelector('li');if(list)return list.classList.contains('task-item')?'task':list.parentElement.tagName.toLowerCase();
    return el.closest('h1,h2,h3,h4,h5,h6,blockquote,pre')?.tagName.toLowerCase()||'p';
  }
  function update(){const key=current();button.textContent=(styles.find(([id])=>id===key)?.[1]||'Mixed Styles')+' ▾';button.dataset.style=key;}
  function clean(line){return line.replace(/^ {0,3}(?:#{1,6}\s+|>\s?)/,'').replace(/^(\s*)(?:[-*+] |\d+[.)] )(?:\[[ xX]\] )?/,'$1');}
  function applySource(style) {
    const scope=sourceScope();if(style==='pre'&&scope.code){update();return;}const lines=scope.code?scope.text.split('\n'):scope.text.split('\n').map(clean);let text;
    if(style==='pre'){const longest=Math.max(2,...(lines.join('\n').match(/`+/g)||[]).map(m=>m.length)),fence='`'.repeat(longest+1);text=fence+'\n'+lines.join('\n')+'\n'+fence;}
    else text=lines.map((line,i)=>style==='p'?line:/^h[1-6]$/.test(style)?'#'.repeat(Number(style[1]))+' '+line:style==='blockquote'?'> '+line:style==='ul'?'- '+line:style==='ol'?(i+1)+'. '+line:'- ['+(!scope.code&&/^\s*[-*+] \[[xX]\] /.test(scope.text.split('\n')[i])?'x':' ')+'] '+line).join('\n');
    source.focus();source.setRangeText(text,scope.start,scope.end,'select');markDirty();update();
  }
  function apply(style){return NoteMindHistory.transaction(()=>applyStyle(style));}
  function applyStyle(style) {
    if(!styles.some(([id])=>id===style))return;
    if(!visual){applySource(style);return;}
    restoreCaret();if(saved&&rich.contains(saved.startContainer)){getSelection().removeAllRanges();getSelection().addRange(saved);saved=null;}
    if(inTable())return;
    rich.querySelectorAll('[data-editor-control=fold]').forEach(n=>n.remove());
    const sel=getSelection(),range=sel.getRangeAt(0);
    const existing=element()?.closest('pre');if(style==='pre'&&existing?.contains(range.startContainer)&&existing.contains(range.endContainer)){NoteMindCode.decorate();update();return;}
    rich.querySelectorAll('[data-editor-control=code-language]').forEach(n=>n.remove());
    if(style!=='pre')for(const pre of rich.querySelectorAll('pre'))if(range.intersectsNode(pre)||pre.contains(element()))for(const code of pre.querySelectorAll('code'))code.replaceWith(...code.childNodes);
    const blocks=range.collapsed?[]:[...rich.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre')].filter(n=>range.intersectsNode(n)&&!n.closest('li,td,th'));
    // The browser keeps list nesting and partial paragraph selections intact.
    const oldList=element()?.closest('li')||element()?.querySelector('li');
    if((style==='p'||/^h[1-6]$/.test(style))&&blocks.length>1){
      const results=[];
      for(const block of blocks){const r=document.createRange();r.selectNodeContents(block);sel.removeAllRanges();sel.addRange(r);document.execCommand('formatBlock',false,style);results.push(element()?.closest(style));}
      if(results[0]&&results.at(-1)){const r=document.createRange();r.setStart(results[0],0);r.setEnd(results.at(-1),results.at(-1).childNodes.length);sel.removeAllRanges();sel.addRange(r);}
    }else if(style==='ul'||style==='ol'||style==='task') {
      const command=style==='ol'?'insertOrderedList':'insertUnorderedList';
      if(!oldList||oldList.parentElement.tagName.toLowerCase()!==(style==='ol'?'ol':'ul'))document.execCommand(command);
      const list=element()?.closest('ul,ol');
      if(list)for(const li of list.querySelectorAll('li')){
        if(!range.intersectsNode(li)&&li!==element()?.closest('li'))continue;
        const completed=!!li.querySelector(':scope > input[type=checkbox]')?.checked;
        li.querySelectorAll(':scope > input[type=checkbox]').forEach(n=>n.remove());li.classList.toggle('task-item',style==='task');
        if(style==='task'){const check=document.createElement('input');check.type='checkbox';check.checked=completed;if(completed)check.setAttribute('checked','');check.contentEditable='false';check.setAttribute('aria-label','Complete task');li.prepend(check,document.createTextNode(' '));}
      }
    }else {
      if(oldList){oldList.parentElement.querySelectorAll('input[type=checkbox]').forEach(n=>{if(n.parentElement===oldList||(!range.collapsed&&range.intersectsNode(n.parentElement)))n.remove();});document.execCommand(oldList.parentElement.tagName==='OL'?'insertOrderedList':'insertUnorderedList');}
      const quote=element()?.closest('blockquote');if(quote&&style!=='blockquote')document.execCommand('outdent');
      document.execCommand('formatBlock',false,style);
      if(style==='pre') {
        const pre=element()?.closest('pre');if(pre){const text=pre.innerText;pre.replaceChildren(document.createElement('code'));pre.firstChild.textContent=text;const r=document.createRange();r.selectNodeContents(pre.firstChild);getSelection().removeAllRanges();getSelection().addRange(r);}
      }
      rich.querySelectorAll('input[type=checkbox]').forEach(n=>{if(!n.closest('li'))n.remove();});
    }
    rich.querySelectorAll('ul,ol').forEach(list=>{if(!list.querySelector('li'))list.remove();});
    richChanged=true;markDirty();NoteMindWriting.decorate();update();
  }
  function items(){const key=current(),disabled=inTable();return styles.map(([id,label])=>({label,checked:key===id,disabled,labelStyle:/^h[1-6]$/.test(id)?{fontWeight:600,fontSize:[0,19,17,15,14,13,12][Number(id[1])]}:id==='pre'?{fontFamily:'Consolas, monospace'}:id==='blockquote'?{fontStyle:'italic'}:undefined,run:()=>apply(id)}));}
  button.onclick=()=>{if(visual&&getSelection()?.rangeCount&&rich.contains(getSelection().anchorNode))saved=getSelection().getRangeAt(0).cloneRange();const r=button.getBoundingClientRect();window.notemindMenu(items(),r.left,r.bottom,{trigger:button,label:'Text style'});};
  document.addEventListener('selectionchange',update);source.addEventListener('select',update);source.addEventListener('keyup',update);source.addEventListener('click',update);rich.addEventListener('input',update);source.addEventListener('input',update);
  window.NoteMindStyles={apply,items,update};update();
})();
