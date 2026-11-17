(() => {
  let active = null, selected = null, drag = null, scheduled = false;
  const editor = document.querySelector('.editor-wrap');
  const anchor = () => { const n = getSelection()?.anchorNode; return (n?.nodeType === 1 ? n : n?.parentElement)?.closest('td,th'); };
  const valid = entry => visual && entry && rich.contains(entry);
  const target = entry => valid(entry) ? entry : valid(active) ? active : valid(anchor()) ? anchor() : null;
  const entries = table => [...table.rows].flatMap(row => [...row.children]);
  const escape = value => String(value).replace(/[&<>\"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
  const blank = () => { const td = document.createElement('td'); td.innerHTML = '<br>'; return td; };
  const newRow = width => { const row = document.createElement('tr'); for (let i=0;i<width;i++) row.append(blank()); return row; };
  function focus(entry, end=false) {
    if (!valid(entry)) return;
    active=entry; rich.focus(); const range=document.createRange(); range.selectNodeContents(entry); range.collapse(!end);
    getSelection().removeAllRanges(); getSelection().addRange(range); carets.set(activeTab.id,range.cloneRange()); schedule();
  }
  function changed() { richChanged=true; markDirty(); decorate(); }
  function clearSelection() { selected=null; rich.querySelectorAll('.table-selected').forEach(n=>n.classList.remove('table-selected')); }
  function selectedEntries() {
    if (!selected || !valid(active)) return [];
    const table=active.closest('table');
    return selected.axis==='row' ? [...table.rows[selected.index].children] : [...table.rows].map(row=>row.children[selected.index]);
  }
  function select(axis,index) {
    if (!valid(active)) return;
    clearSelection(); selected={axis,index}; selectedEntries().forEach(n=>n.classList.add('table-selected'));
    focus(selectedEntries()[0]);
  }
  function decorate() {
    for (const table of rich.querySelectorAll('table')) {
      // One body makes dragging across the first row behave exactly like other rows.
      if (table.tHead || table.tFoot || table.tBodies.length!==1) {
        const body=document.createElement('tbody'); [...table.rows].forEach(row=>body.append(row)); table.replaceChildren(body);
      }
      if (!table.parentElement.classList.contains('notepad-table-scroll')) {
        const wrap=document.createElement('div'); wrap.className='notepad-table-scroll'; table.before(wrap); wrap.append(table);
      }
      table.setAttribute('aria-label','Editable table');
    }
    if (!valid(active)) { active=null; clearSelection(); }
    schedule();
  }
  function tableHtml(values) {
    const width=Math.max(1,...values.map(row=>row.length));
    return '<table><tbody>'+values.map(row=>'<tr>'+Array.from({length:width},(_,i)=>'<td>'+(row[i]||'<br>')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }
  function textValues(text,minimum=1) {
    const rows=text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(line=>line.split('\t').map(escape));
    const width=Math.max(minimum,...rows.map(r=>r.length)); return rows.map(row=>Array.from({length:width},(_,i)=>row[i]||''));
  }
  function insert(values) {
    if (!visual) {
      const md=NoteMindDocument.toMarkdown(tableHtml(values));
      source.focus(); source.setRangeText('\n\n'+md+'\n\n',source.selectionStart,source.selectionEnd,'end'); markDirty(); return;
    }
    restoreCaret(); clearSelection();
    const id='table-'+crypto.randomUUID();
    document.execCommand('insertHTML',false,tableHtml(values).replace('<table>','<table id="'+id+'">')+'<p><br></p>');
    const table=document.getElementById(id); table?.removeAttribute('id');
    changed(); if (table) focus(table.rows[0].children[0]);
  }
  function add() {
    if (visual && target(anchor())) { const r=($('insertMenu')||$('insertTable')).getBoundingClientRect(); menu(r.left,r.bottom); return; }
    let text=source.value.slice(source.selectionStart,source.selectionEnd);
    if(visual){
      const selection=getSelection();text='';
      if(selection?.rangeCount&&!selection.isCollapsed){
        const fragment=selection.getRangeAt(0).cloneContents();fragment.querySelectorAll('[data-editor-control]').forEach(n=>n.remove());
        const plain=node=>node.nodeType===3?node.textContent.replace(/\n/g,' '):node.nodeName==='BR'?'\n':[...node.childNodes].map(plain).join('')+(/^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(node.nodeName)?'\n':'');
        text=plain(fragment).replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n').trim();
      }
    }
    insert(text ? textValues(text,2) : [['',''],['','']]);
  }
  function remove(table) {
    const wrap=table.closest('.notepad-table-scroll')||table,p=document.createElement('p'); p.innerHTML='<br>'; wrap.replaceWith(p);
    clearSelection(); active=null; rich.focus(); const r=document.createRange(); r.selectNodeContents(p); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r);
  }
  function action(command,entry) {
    entry=target(entry); if (!entry) return;
    active=entry; const table=entry.closest('table'),row=entry.parentElement,rows=[...table.rows],ri=rows.indexOf(row),ci=entry.cellIndex;
    clearSelection();
    if (command==='rowBefore'||command==='rowAfter') { const next=newRow(row.children.length); row[command==='rowBefore'?'before':'after'](next); focus(next.children[ci]); }
    else if (command==='columnBefore'||command==='columnAfter') { for (const tr of rows) tr.children[ci][command==='columnBefore'?'before':'after'](blank()); focus(row.children[ci+(command==='columnAfter'?1:0)]); }
    else if (command==='deleteRow') { if (rows.length===1) remove(table); else { row.remove(); focus(table.rows[Math.min(ri,table.rows.length-1)].children[ci]); } }
    else if (command==='deleteColumn') { if (row.children.length===1) remove(table); else { rows.forEach(tr=>tr.children[ci].remove()); focus(row.children[Math.min(ci,row.children.length-1)]); } }
    else if (command==='deleteTable') remove(table);
    else if (command==='convert') {
      const fragment=document.createDocumentFragment();
      for (const tr of rows) { const p=document.createElement('p'); [...tr.children].forEach((td,i)=>{if(i)p.append(document.createTextNode('\t'));for(const node of td.childNodes)p.append(node.cloneNode(true));}); fragment.append(p); }
      const first=fragment.firstChild; (table.closest('.notepad-table-scroll')||table).replaceWith(fragment); active=null;
      rich.focus();const range=document.createRange();range.selectNodeContents(first);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);
    }
    else return;
    changed();
  }
  function move(axis,from,to) {
    const entry=target(); if (!entry || from===to) return;
    const table=entry.closest('table'),rows=[...table.rows],width=rows[0].children.length;
    if (to<0 || to>=(axis==='row'?rows.length:width)) return;
    clearSelection();
    if (axis==='row') rows[to][to>from?'after':'before'](rows[from]);
    else rows.forEach(row=>{const list=[...row.children];list[to][to>from?'after':'before'](list[from]);});
    active=axis==='row'?table.rows[to].children[0]:table.rows[0].children[to]; select(axis,to); changed();
  }
  function matrix(whole=false) {
    const entry=target(); if(!entry)return [];
    const rows=[...entry.closest('table').rows];
    if(!whole&&selected?.axis==='row')return [[...rows[selected.index].children]];
    if(!whole&&selected?.axis==='column')return rows.map(row=>[row.children[selected.index]]);
    return rows.map(row=>[...row.children]);
  }
  function clipboardData(whole=false) {
    const values=matrix(whole);
    return {text:values.map(row=>row.map(td=>td.innerText.replace(/\n/g,' ')).join('\t')).join('\n'),html:tableHtml(values.map(row=>row.map(td=>td.innerHTML)))};
  }
  async function copy(whole=false) { await window.notemind.copyTable(clipboardData(whole)); }
  function clearContents() {
    const list=selectedEntries(); if(!list.length)return;
    if(list.every(td=>!td.textContent.trim()&&!td.querySelector('img'))) { const axis=selected.axis; action(axis==='row'?'deleteRow':'deleteColumn',list[0]); }
    else { list.forEach(td=>td.innerHTML='<br>'); changed(); }
  }
  function formatSelection(command) {
    const list=selectedEntries(); if(!list.length)return false;
    const state={...selected};
    NoteMindHistory.transaction(()=>{for (const td of list) { focus(td); const r=document.createRange();r.selectNodeContents(td);getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand(command); }
    select(state.axis,state.index);changed();});return true;
  }
  function items(entry) {
    entry=target(entry); if(!entry)return [];
    return [['rowBefore','Add Row Above'],['rowAfter','Add Row Below'],['columnBefore','Add Column Before'],['columnAfter','Add Column After'],'-',
      ['deleteRow','Delete Row'],['deleteColumn','Delete Column'],'-'].map(item=>item==='-'?item:{label:item[1],run:()=>action(item[0],entry)}).concat([
      {label:'Copy Table',run:()=>{active=entry;return copy(true);}}, {label:'Convert to Text',run:()=>action('convert',entry)}, {label:'Delete Table',run:()=>action('deleteTable',entry)}]);
  }
  function menu(x,y,entry) { if(entry)active=entry; window.notemindMenu(items(entry),x,y); }
  function handleMenu(axis,button) {
    if(!valid(active))return;
    const index=axis==='row'?[...active.closest('table').rows].indexOf(active.parentElement):active.cellIndex;
    select(axis,index); const rows=active.closest('table').rows, count=axis==='row'?rows.length:rows[0].children.length, r=button.getBoundingClientRect();
    const label=axis==='row'?'Row':'Column';
    window.notemindMenu([
      {label:'Add '+label+(axis==='row'?' Above':' Before'),run:()=>action(axis+'Before')},
      {label:'Add '+label+(axis==='row'?' Below':' After'),run:()=>action(axis+'After')},'-',
      {label:'Move '+label+(axis==='row'?' Up':' Left'),disabled:index===0,run:()=>move(axis,index,index-1)},
      {label:'Move '+label+(axis==='row'?' Down':' Right'),disabled:index===count-1,run:()=>move(axis,index,index+1)},'-',
      {label:'Copy '+label,run:()=>copy()}, {label:'Clear Contents',run:clearContents}, {label:'Delete '+label,run:()=>action('delete'+label)}
    ],r.left,r.bottom);
  }
  const controls=document.createElement('div');controls.className='table-controls';controls.hidden=true;
  controls.setAttribute('aria-label','Table controls');
  const handles={};
  for(const axis of ['row','column']) {
    const b=document.createElement('button');b.className='table-handle table-'+axis;b.textContent='•••';b.dataset.axis=axis;b.title=(axis==='row'?'Row':'Column')+' actions · drag to reorder';b.setAttribute('aria-label',axis==='row'?'Row actions':'Column actions');b.setAttribute('aria-haspopup','menu');controls.append(b);handles[axis]=b;
    b.onpointerdown=e=>{
      if(e.button!==0||!valid(active))return; e.preventDefault();
      const table=active.closest('table'),index=axis==='row'?[...table.rows].indexOf(active.parentElement):active.cellIndex;
      select(axis,index);drag={axis,from:index,to:index,x:e.clientX,y:e.clientY,moved:false,table};b.setPointerCapture(e.pointerId);
    };
    b.onpointermove=e=>{
      if(!drag)return;
      if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;
      if(!drag.moved)return;
      const list=axis==='row'?[...drag.table.rows]:[...drag.table.rows[0].children],point=axis==='row'?e.clientY:e.clientX;
      drag.to=list.reduce((best,n,i)=>{const r=n.getBoundingClientRect(),center=axis==='row'?r.top+r.height/2:r.left+r.width/2;return Math.abs(center-point)<best.distance?{index:i,distance:Math.abs(center-point)}:best;},{index:drag.from,distance:Infinity}).index;
      rich.querySelectorAll('.table-drop-row,.table-drop-column').forEach(n=>n.classList.remove('table-drop-row','table-drop-column'));list[drag.to].classList.add('table-drop-'+axis);
    };
    b.onpointerup=e=>{if(!drag)return;const d=drag;drag=null;b.releasePointerCapture(e.pointerId);rich.querySelectorAll('.table-drop-row,.table-drop-column').forEach(n=>n.classList.remove('table-drop-row','table-drop-column'));if(d.moved)move(axis,d.from,d.to);else handleMenu(axis,b);};
    b.onpointercancel=()=>{drag=null;rich.querySelectorAll('.table-drop-row,.table-drop-column').forEach(n=>n.classList.remove('table-drop-row','table-drop-column'));};
    b.onclick=e=>{if(e.detail===0)handleMenu(axis,b);};
  }
  document.body.append(controls);
  function position() {
    scheduled=false; const entry=target();
    if(!entry||!visual||document.querySelector('main').hidden){controls.hidden=true;return;}
    const table=entry.closest('table'),t=table.getBoundingClientRect(),r=entry.getBoundingClientRect(),viewport=editor.getBoundingClientRect(),clip=table.parentElement.getBoundingClientRect();
    if(!t.width||r.bottom<viewport.top||r.top>viewport.bottom){controls.hidden=true;return;}
    controls.hidden=false;
    handles.row.hidden=t.left<Math.max(viewport.left,clip.left)||r.bottom>viewport.bottom;
    handles.column.hidden=t.top-18<viewport.top||r.left<clip.left||r.right>Math.min(clip.right,viewport.right);
    Object.assign(handles.row.style,{left:(t.left-18)+'px',top:(r.top+r.height/2-10)+'px'});
    Object.assign(handles.column.style,{left:(r.left+r.width/2-12)+'px',top:(t.top-18)+'px'});
    $('insertTable').classList.toggle('selected',true);$('insertTable').title='Table actions';
  }
  function schedule() { if(!scheduled){scheduled=true;requestAnimationFrame(position);} }
  function paste(event) {
    if(!visual)return false;
    const entry=target(anchor()),html=event.clipboardData.getData('text/html'),text=event.clipboardData.getData('text/plain');
    const parsed=html?new DOMParser().parseFromString(html,'text/html'):null,table=parsed?.querySelector('table');
    if(!table && (!entry||!text.includes('\t')))return false;
    // Round-trip external markup through the Markdown allowlist before inserting it.
    let values;
    if(table) { const safe=new DOMParser().parseFromString(NoteMindDocument.render(NoteMindDocument.toMarkdown(table.outerHTML)),'text/html').querySelector('table'); if(!safe)return false; values=[...safe.rows].map(row=>[...row.children].map(td=>td.innerHTML)); }
    else values=textValues(text);
    if(!values.length||values.length>1000||Math.max(...values.map(row=>row.length))>100){$('status').textContent='Paste a table with at most 1,000 rows and 100 columns.';return true;}
    event.preventDefault();
    if(!entry){insert(values);return true;}
    const host=entry.closest('table'),rows=[...host.rows],startRow=selected?.axis==='column'?0:rows.indexOf(entry.parentElement),startColumn=selected?.axis==='row'?0:entry.cellIndex,width=Math.max(rows[0].children.length,startColumn+Math.max(...values.map(row=>row.length)));
    clearSelection();
    for(const row of rows)while(row.children.length<width)row.append(blank());
    while(host.rows.length<startRow+values.length)host.tBodies[0].append(newRow(width));
    values.forEach((row,y)=>row.forEach((value,x)=>host.rows[startRow+y].children[startColumn+x].innerHTML=value||'<br>'));
    focus(host.rows[startRow].children[startColumn]);changed();return true;
  }
  rich.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    const entry=target(anchor());if(!entry)return;
    if(selected && event.altKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();move(selected.axis,selected.index,selected.index+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1));return;}
    if(selected&&['Backspace','Delete'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();clearContents();return;}
    if(event.key==='Escape'){event.preventDefault();clearSelection();const wrap=entry.closest('.notepad-table-scroll');let after=wrap.nextElementSibling;if(!after){after=document.createElement('p');after.innerHTML='<br>';wrap.after(after);}const range=document.createRange();range.selectNodeContents(after);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);active=null;controls.hidden=true;return;}
    if(!['Tab','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Enter'&&event.shiftKey){event.preventDefault();event.stopImmediatePropagation();clearSelection();document.execCommand('insertLineBreak');changed();return;}
    const table=entry.closest('table'),list=entries(table),index=list.indexOf(entry),width=table.rows[0].children.length;
    let next=index;
    if(event.key==='Tab')next+=event.shiftKey?-1:1;
    else if(event.key==='Enter')next+=width;
    else {
      const sel=getSelection();if(!sel.isCollapsed||event.shiftKey)return;
      const before=document.createRange();before.selectNodeContents(entry);before.setEnd(sel.anchorNode,sel.anchorOffset);
      const backward=event.key==='ArrowLeft'||event.key==='ArrowUp';if(backward?before.toString().length!==0:before.toString().length!==entry.textContent.length)return;
      next+=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:event.key==='ArrowUp'?-width:width;
      if(next<0||next>=list.length)return;
    }
    event.preventDefault();event.stopImmediatePropagation();clearSelection();
    if(next<0){const wrap=table.parentElement;let p=wrap.previousElementSibling;if(!p){p=document.createElement('p');p.innerHTML='<br>';wrap.before(p);}const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);active=null;schedule();return;}
    if(next>=list.length){table.tBodies[0].append(newRow(width));changed();}
    focus(entries(table)[next]);
  },true);
  rich.addEventListener('pointerdown',event=>{clearSelection();active=event.target.closest('td,th');schedule();});
  rich.addEventListener('beforeinput',event=>{if(selected&&['insertText','insertCompositionText'].includes(event.inputType)){const list=selectedEntries();list.forEach(td=>td.innerHTML='<br>');clearSelection();focus(list[0]);}});
  document.addEventListener('pointerdown',event=>{if(!rich.contains(event.target)&&!controls.contains(event.target)&&!event.target.closest('#toolbar,[role=menu]')){clearSelection();active=null;schedule();}});
  document.addEventListener('selectionchange',()=>{if(valid(anchor()))active=anchor();else if(document.activeElement===rich){active=null;clearSelection();}$('insertTable').classList.toggle('selected',!!target());$('insertTable').title=target()?'Table actions':'Insert table';schedule();});
  for(const type of ['copy','cut'])rich.addEventListener(type,event=>{if(!selected)return;const data=clipboardData();event.preventDefault();event.clipboardData.setData('text/plain',data.text);event.clipboardData.setData('text/html',data.html);if(type==='cut')clearContents();});
  document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
  new ResizeObserver(schedule).observe(editor);
  const button=document.createElement('button');button.id='insertTable';button.title='Insert table';button.setAttribute('aria-label','Table');button.innerHTML='<svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><rect x="1.5" y="2.5" width="15" height="13" rx="1.5"/><path d="M1.5 9h15M9 2.5v13"/></svg>';button.onclick=add;$('toolbar').insertBefore(button,$('insertImage'));
  window.NoteMindTables={add,action,items,decorate,paste,move,select,focus,formatSelection,clearSelection};
})();
