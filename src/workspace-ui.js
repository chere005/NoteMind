(() => {
 const toolbar=$('toolbar'),more=$('writingTools');
 new ResizeObserver(()=>revealActiveTab()).observe($('documentTabs'));
 const icon=(name)=>({plus:'<path d="M8 3v10M3 8h10"/>',list:'<path d="M6 4h8M6 8h8M6 12h8M2 4h1M2 8h1M2 12h1"/>',more:'<circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/>'}[name]);
 const svg=name=>'<svg class="wm-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'+icon(name)+'</svg>';
 const mod=/Mac/i.test(navigator.userAgent)?'Cmd':'Ctrl';
 const command=detail=>window.dispatchEvent(new CustomEvent('notemind-command',{detail}));
 const menu=(button,items,label)=>{const r=button.getBoundingClientRect();window.notemindMenu(items,r.left,r.bottom+3,{trigger:button,label});};
 const make=(id,label,image,items)=>{const button=document.createElement('button');button.id=id;button.className='bar-btn toolbar-menu';button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.innerHTML=svg(image)+'<span class="bar-label-text">'+label+'</span><span class="menu-chevron" aria-hidden="true">⌄</span>';button.onclick=()=>menu(button,items(),label);return button;};
 const listItems=()=>[{label:'Bulleted List',icon:'list',run:()=>window.NoteMindStyles.apply('ul')},{label:'Numbered List',icon:'listnum',run:()=>window.NoteMindStyles.apply('ol')},{label:'Checklist',icon:'listcheck',run:()=>window.NoteMindStyles.apply('task')},'-',{label:'Indent',run:()=>window.NoteMindWriting.format('indent')},{label:'Outdent',run:()=>window.NoteMindWriting.format('outdent')}];
 const insertItems=()=>[{label:'Image…',icon:'image',run:()=>$('insertImage').click()},{label:'Table…',icon:'table',run:()=>$('insertTable').click()},{label:'Attachment…',run:()=>command('attachFiles')},{label:'Scan Pages…',icon:'camera',run:()=>command('scanPages')},'-',{label:'Link to Notepad…',icon:'link',run:()=>command('insertNoteLink')},{label:'Code Block',icon:'code',run:()=>window.NoteMindStyles.apply('pre')}];
 const formatItems=()=>[
  ...[['Bold','bold','fmtBold'],['Italic','italic','fmtItalic'],['Underline','underline','fmtUnderline'],['Strikethrough','strikeThrough','fmtStrike']].map(([label,key,id])=>({label,checked:visual&&rich.contains(getSelection()?.anchorNode)&&document.queryCommandState(key),run:()=>window.NoteMindFormat.commands[id]()})),
  {label:'Inline Code',run:()=>window.NoteMindFormat.commands.fmtCode()},{label:'Highlight',run:()=>window.NoteMindWriting.format('highlight')},'-',
  {label:'Lists',submenu:listItems()},{label:'Paragraph',submenu:window.NoteMindStyles.items()},
  ...(getSelection()?.anchorNode?.parentElement?.closest('td,th')?[{label:'Table',submenu:window.NoteMindWriting.items().find(item=>item.label==='Table')?.submenu||[]}]:[]),'-',
  {label:'Collapse Headings',run:()=>window.NoteMindWriting.collapseAll(true)},{label:'Expand Headings',run:()=>window.NoteMindWriting.collapseAll(false)}
 ];
 const legacy=document.createElement('span');legacy.hidden=true;legacy.id='legacy-tools';
 for(const node of [...toolbar.children])if(node!==$('heading')&&node!==more&&!node.matches('[data-command=bold],[data-command=italic],[data-format=fmtUnderline],.grow'))legacy.append(node);
 toolbar.append(legacy);
 const textGroup=document.createElement('span');textGroup.className='toolbar-group text-tools';textGroup.setAttribute('role','group');textGroup.setAttribute('aria-label','Text formatting');
 for(const button of [$('heading'),toolbar.querySelector('[data-command=bold]'),toolbar.querySelector('[data-command=italic]'),toolbar.querySelector('[data-format=fmtUnderline]')])textGroup.append(button);
 const list=make('listMenu','Lists','list',listItems),insert=make('insertMenu','Insert','plus',insertItems),grow=toolbar.querySelector('.grow'),mode=document.createElement('span');mode.id='editor-mode';
 more.className='bar-btn toolbar-menu format-menu';more.title='Formatting options';more.setAttribute('aria-label','Formatting options');more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');more.innerHTML=svg('more')+'<span class="bar-label-text">Format</span><span class="menu-chevron" aria-hidden="true">⌄</span>';more.onclick=()=>menu(more,formatItems(),'Formatting options');
 toolbar.prepend(textGroup,list,insert,more);toolbar.append(grow,mode);
 for(const button of toolbar.querySelectorAll('button'))if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label',button.title||button.textContent.trim());
 function updateState(){for(const [selector,key]of [['[data-command=bold]','bold'],['[data-command=italic]','italic'],['[data-format=fmtUnderline]','underline']])toolbar.querySelector(selector)?.setAttribute('aria-pressed',String(!!(visual&&rich.contains(getSelection()?.anchorNode)&&document.queryCommandState(key))));}
 document.addEventListener('selectionchange',updateState);rich.addEventListener('input',updateState);window.addEventListener('notemind-document',updateState);new MutationObserver(updateState).observe(rich,{attributes:true,attributeFilter:['hidden']});
 // The same keyboard rules apply in the main window and on the pen display.
 function installToolbarKeys(doc){const key=event=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
  const target=event.target;if(target.closest('input,select,textarea,[contenteditable=true],.float-menu'))return;
  if(target.getAttribute('role')==='tab'&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){const group=target.closest('[role=tablist]'),tabs=[...group.querySelectorAll('[role=tab]')].filter(el=>el.getClientRects().length),at=tabs.indexOf(target),index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(at+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;event.preventDefault();event.stopPropagation();tabs[index]?.click();doc.defaultView.setTimeout(()=>group.querySelector('[role=tab][aria-selected=true]')?.focus(),0);return;}
  const button=target.closest('button');if(!button)return;
  if(['ArrowDown','ArrowUp'].includes(event.key)&&button.getAttribute('aria-haspopup')==='menu'){event.preventDefault();button.click();doc.defaultView.requestAnimationFrame(()=>{const rows=[...doc.querySelectorAll('.float-menu > .float-row > button:not(:disabled)')];(event.key==='ArrowDown'?rows[0]:rows.at(-1))?.focus();});return;}
  const bar=target.closest('[role=toolbar]');if(!bar||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const controls=[...bar.querySelectorAll('button:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length),at=controls.indexOf(button);if(at<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?controls.length-1:(at+(event.key==='ArrowRight'?1:controls.length-1))%controls.length;controls[next]?.focus();
 };const dismiss=()=>doc.dispatchEvent(new doc.defaultView.Event('notemind-menu-dismiss'));doc.addEventListener('keydown',key);window.addEventListener('notemind-command',dismiss,true);return()=>{doc.removeEventListener('keydown',key);window.removeEventListener('notemind-command',dismiss,true)};}
 window.NoteMindToolbarKeys=installToolbarKeys;installToolbarKeys(document);
 window.NoteMindMenus={listItems,insertItems,formatItems,noteItems:()=>[
  {label:'Save',hint:mod+'+S',onClick:()=>$('save').click()},{label:'Save As…',hint:mod+'+Shift+S',onClick:()=>$('saveAs').click()},
  {label:'Delete Notepad…',hint:mod+'+Backspace',danger:true,disabled:!!activeTab.placeholder,onClick:()=>command('deleteNote')},
  {label:'Export',submenu:[{label:'PDF…',onClick:()=>command('exportPDF')},{label:'Word…',onClick:()=>command('exportWord')}]},'-',
  {label:'Find in Notepad…',onClick:()=>command('findNote')},{label:'Tags and Pin…',onClick:()=>command('noteInfo')},{label:'Version History…',onClick:()=>command('versions')},{label:'Attachments…',onClick:()=>command('attachments')},
 ]};
})();
