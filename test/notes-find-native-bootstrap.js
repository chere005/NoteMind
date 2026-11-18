const rich=document.getElementById('rich'),source=document.getElementById('source'),$=id=>document.getElementById(id),doc={meta:{}},NoteMindHistory={transaction:run=>run()};let visual=true;
function markDirty(){}
window.NoteMindWriting={decorate(){}};
window.findFixture=()=>{
 if(typeof Highlight!=='function'||!CSS.highlights)throw Error('Actual CSS Highlight API unavailable.');const count=150000;rich.textContent='a'.repeat(count);window.NoteMindFind.open();const input=document.querySelector('.note-find input');input.value='a';const start=performance.now();input.oninput();const elapsed=performance.now()-start,all=CSS.highlights.get('note-find'),current=CSS.highlights.get('note-current'),first=[...current][0];
 if(window.NoteMindFind.matches!==count||all.size!==count||current.size!==1||first.startContainer!==rich.firstChild||first.startOffset!==0||first.endOffset!==1)throw Error('Native Find range publication changed.');return{chars:rich.textContent.length,matches:window.NoteMindFind.matches,highlighted:all.size,current:current.size,wallMs:elapsed,first:{start:first.startOffset,end:first.endOffset}};
};
