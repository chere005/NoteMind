(() => {
 const syntax=NoteMindDocument.syntax,stamps=new WeakMap();
 const language=code=>(code.className.match(/(?:^|\s)language-(\S+)/)||[])[1]||'';
 function selection(code){const s=getSelection();if(!s?.rangeCount||!code.contains(s.anchorNode)||!code.contains(s.focusNode))return null;const offset=(node,at)=>{const r=document.createRange();r.selectNodeContents(code);r.setEnd(node,at);return r.toString().length;};return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};}
 function restore(code,point){if(!point)return;const at=offset=>{const walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);let node,last;while((node=walker.nextNode())){last=node;if(offset<=node.length)return [node,offset];offset-=node.length;}return last?[last,last.length]:[code,0];};getSelection().setBaseAndExtent(...at(point.anchor),...at(point.focus));}
 function paint(code){
  const text=code.textContent,lang=language(code),stamp=stamps.get(code);if(stamp?.text===text&&stamp.lang===lang)return;
  const point=selection(code),html=syntax.highlight(text,lang);if(code.innerHTML!==html)code.innerHTML=html;stamps.set(code,{text,lang});restore(code,point);window.NoteMindFind?.refresh();
 }
 function choose(code,id){
  if(!rich.contains(code))return;
  NoteMindHistory.transaction(()=>{code.className=id?'language-'+id:'';richChanged=true;markDirty();});paint(code);decorateBlock(code);
 }
 function decorateBlock(code){
  const pre=code.parentElement;if(pre?.tagName!=='PRE')return;
  pre.classList.add('code-block');code.spellcheck=false;
  let button=pre.querySelector(':scope > [data-code-language]');
  if(!button){button=document.createElement('button');button.type='button';button.className='code-language';button.dataset.codeLanguage='';button.dataset.editorControl='code-language';button.contentEditable='false';button.onmousedown=e=>e.preventDefault();button.onclick=()=>{const current=syntax.resolve(language(code)),r=button.getBoundingClientRect();window.notemindMenu([{label:'Plain Text',checked:!current,run:()=>choose(code,'')},'-',...syntax.languages.map(item=>({label:item.label,checked:current===item.id,run:()=>choose(code,item.id)}))],r.left,r.bottom,{trigger:button,label:'Code language'});};pre.append(button);}
  button.textContent=syntax.label(language(code))+' ▾';button.setAttribute('aria-label','Code language: '+syntax.label(language(code)));button.title='Choose the language for syntax highlighting';
 }
 function decorate(){for(const code of rich.querySelectorAll('pre > code'))decorateBlock(code);}
 const activeCode=()=>{const s=getSelection(),node=s?.anchorNode,el=node?.nodeType===1?node:node?.parentElement;return el?.closest('pre > code');};
 let frame=0,composing=false;const pending=new Set();
 function schedule(){const code=activeCode();if(code&&rich.contains(code))pending.add(code);if(frame||composing||!pending.size)return;frame=requestAnimationFrame(()=>{frame=0;if(composing)return;for(const code of pending)if(visual&&rich.contains(code)){paint(code);decorateBlock(code);}pending.clear();});}
 function insert(code,text){
  if(!selection(code))return;
  NoteMindHistory.transaction(()=>{const s=getSelection(),range=s.getRangeAt(0),node=document.createTextNode(text);range.deleteContents();range.insertNode(node);range.setStart(node,text.length);range.collapse(true);s.removeAllRanges();s.addRange(range);rich.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));});
 }
 rich.addEventListener('paste',e=>{const code=activeCode(),text=e.clipboardData.getData('text/plain');if(!code||!selection(code)||!text)return;e.preventDefault();e.stopImmediatePropagation();insert(code,text.replace(/\r\n?/g,'\n'));},true);
 rich.addEventListener('beforeinput',e=>{if(e.isComposing)return;const code=activeCode();if(!code||!selection(code))return;if(e.inputType==='insertText'&&e.data?.includes('\n')){e.preventDefault();insert(code,e.data);}else if(['insertParagraph','insertLineBreak'].includes(e.inputType)){e.preventDefault();insert(code,'\n');}});
 rich.addEventListener('input',schedule);rich.addEventListener('compositionstart',()=>{composing=true;});rich.addEventListener('compositionend',()=>{composing=false;schedule();});
 rich.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;const code=activeCode();if(!code||!rich.contains(code)||!selection(code))return;
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();const p=document.createElement('p');p.append(document.createElement('br'));code.parentElement.after(p);const r=document.createRange();r.selectNodeContents(p);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);richChanged=true;markDirty();return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();insert(code,'    ');}
  if(e.key==='Enter'){e.preventDefault();const point=selection(code),before=code.textContent.slice(0,point?.anchor||0),indent=e.shiftKey?'':(before.split('\n').at(-1).match(/^\s*/)?.[0]||'');insert(code,'\n'+indent);}
 });
 window.NoteMindCode={decorate,paint,choose};decorate();
})();
