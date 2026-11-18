(() => {
 // Help opens editable examples, a versioned reference, and searchable shortcuts.
 async function shortcuts(){
  const entries=await window.notemind.shortcuts();
  const d=document.createElement('dialog');d.className='shell-dialog shortcuts-dialog';
  d.innerHTML='<h2>Keyboard Shortcuts</h2><input type="search" placeholder="Search shortcuts" aria-label="Search shortcuts"><div class="shortcut-list"></div><div class="dialog-actions"><button data-close title="Close keyboard shortcuts">Close</button></div>';
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
 let openingGuide=null;
 function welcomeNote(){
  if(openingGuide)return openingGuide;
  openingGuide=(async()=>{
   const N=window.NoteMindNotes;
   if(!N.ready)await new Promise(resolve=>window.addEventListener('notes-ready',resolve,{once:true}));
   await N.flush();
   const file=await window.notemind.welcomeNote({preserve:tabs.some(t=>t.dirty&&/^Welcome to NoteMind(?: \d+)?\.nm$/i.test(t.doc.path?.split(/[\\/]/).pop()||''))});
   const tab=tabs.find(t=>t.doc.path?.toLowerCase()===file.toLowerCase());
   if(tab?.dirty)activateTab(tab);
   else {
    const opened=await window.notemind.openPath(file),sync=window.NoteMindDocumentSync;
    const fresh=sync?await sync.hydrate(opened):opened;
    try{
     if(!tab||!tabs.includes(tab))await addTab({...fresh,visual:true});
     else if(tab.dirty)activateTab(tab);
     else{rememberCurrent();tab.doc=fresh;tab.dirty=!!fresh.dirty;tab.visual=true;tab.draftStamp=null;activeTab=null;activateTab(tab);}
    }finally{sync?.releaseDocument(fresh);}
   }
   window.NoteMindSidebar?.keepGuide(file);
   await window.notemind.remember(file);await N.session();
  })().finally(()=>{openingGuide=null;});
  return openingGuide;
 }
 async function quickReference(){
  const file=await window.notemind.quickReference();
  window.dispatchEvent(new CustomEvent('notemind-open-path',{detail:file}));
 }
 window.addEventListener('notemind-command',e=>{if(e.detail==='welcomeNote')action(welcomeNote);if(e.detail==='shortcuts')action(shortcuts);if(e.detail==='quickReference')action(quickReference);});
 window.NoteMindHelp={shortcuts,quickReference,welcomeNote};
})();
