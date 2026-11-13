(() => {
 // Help: the searchable shortcut list (F1) and the Quick Reference, which is a real Notepad refreshed when the app is newer.
 async function shortcuts(){
  const entries=await window.notemind.shortcuts();
  const d=document.createElement('dialog');d.className='shell-dialog shortcuts-dialog';
  d.innerHTML='<h2>Keyboard Shortcuts</h2><input type="search" placeholder="Search shortcuts" aria-label="Search shortcuts"><div class="shortcut-list"></div><div class="dialog-actions"><button data-close>Close</button></div>';
  const input=d.querySelector('input'),list=d.querySelector('.shortcut-list');
  function draw(){
   const words=input.value.toLowerCase().split(/\s+/).filter(Boolean);list.replaceChildren();
   const shown=entries.filter(e=>words.every(w=>(e.group+' '+e.label+' '+e.keys).toLowerCase().includes(w)));
   for(const group of [...new Set(shown.map(e=>e.group))]){
    const heading=document.createElement('h3');heading.textContent=group;list.append(heading);
    for(const entry of shown.filter(e=>e.group===group)){const row=document.createElement('div');row.className='shortcut-row';row.setAttribute('role','listitem');const keys=document.createElement('kbd'),label=document.createElement('span');keys.textContent=entry.keys;label.textContent=entry.label;row.append(label,keys);list.append(row);}
   }
   if(!shown.length){const none=document.createElement('p');none.textContent='No shortcut matches.';list.append(none);}
  }
  input.oninput=draw;draw();
  d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();
  document.body.append(d);d.showModal();input.focus();
 }
 async function quickReference(){
  const file=await window.notemind.quickReference();
  window.dispatchEvent(new CustomEvent('notemind-open-path',{detail:file}));
 }
 window.addEventListener('notemind-command',e=>{if(e.detail==='shortcuts')action(shortcuts);if(e.detail==='quickReference')action(quickReference);});
 window.NoteMindHelp={shortcuts,quickReference};
})();
