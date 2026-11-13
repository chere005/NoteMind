(() => {
 const selectionElement=()=>{const node=getSelection()?.anchorNode;return node?.nodeType===1?node:node?.parentElement;};
 function wrapSource(open,close){
  const a=source.selectionStart,b=source.selectionEnd,text=source.value.slice(a,b)||'text';
  source.focus();source.setRangeText(open+text+close,a,b,'select');source.setSelectionRange(a+open.length,a+open.length+text.length);markDirty();
 }
 function codeSpan(){
  restoreCaret();const selection=getSelection();if(!selection.rangeCount)return;
  const range=selection.getRangeAt(0),inside=selectionElement()?.closest('code');
  if(inside&&!inside.closest('pre')){NoteMindHistory.transaction(()=>{const kids=[...inside.childNodes];inside.replaceWith(...kids);});richChanged=true;markDirty();return;}
  if(range.collapsed)return;
  NoteMindHistory.transaction(()=>{const code=document.createElement('code');code.append(range.extractContents());range.insertNode(code);range.selectNodeContents(code);selection.removeAllRanges();selection.addRange(range);});
  richChanged=true;markDirty();
 }
 const block=style=>()=>window.NoteMindStyles.apply(style);
 const commands={
  fmtBold:()=>formatText('bold'),
  fmtItalic:()=>formatText('italic'),
  fmtUnderline:()=>visual?formatText('underline'):wrapSource('<u>','</u>'),
  fmtStrike:()=>visual?formatText('strikeThrough'):wrapSource('~~','~~'),
  fmtCode:()=>visual?codeSpan():wrapSource('`','`'),
  fmtHighlight:()=>window.NoteMindWriting.format('highlight'),
  fmtBody:block('p'),fmtQuote:block('blockquote'),fmtCodeBlock:block('pre'),fmtList:block('ul'),
  fmtIndent:()=>window.NoteMindWriting.format('indent'),
  fmtOutdent:()=>window.NoteMindWriting.format('outdent')
 };
 for(let n=1;n<=6;n++)commands['fmtHeading'+n]=block('h'+n);
 window.addEventListener('notemind-command',e=>{const run=commands[e.detail];if(run)run();});
 const toolbar=$('toolbar'),after=toolbar.querySelector('[data-command=italic]');
 let anchor=after;
 for(const [id,label,title,html] of [['fmtUnderline','U','Underline','<u>U</u>'],['fmtStrike','S','Strikethrough','<s>S</s>'],['fmtCode','</>','Inline code','<code>&lt;/&gt;</code>']]){
  const button=document.createElement('button');button.innerHTML=html;button.title=title;button.dataset.format=id;button.onclick=()=>commands[id]();
  anchor.after(button);anchor=button;
 }
 window.NoteMindFormat={commands};
})();
