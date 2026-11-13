(() => {

  const byId = id => document.getElementById(id);
  const iconPaths = {"search": "<circle cx=\"7\" cy=\"7\" r=\"4.25\"/><path d=\"m10.5 10.5 3.5 3.5\"/>", "plus": "<path d=\"M8 3.5v9M3.5 8h9\"/>", "folder": "<path d=\"M1.75 4.5A1.5 1.5 0 0 1 3.25 3h3l1.5 1.5h5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z\"/>", "doc": "<path d=\"M4 1.75h5.5L13 5.25v9H4z\"/><path d=\"M9.5 1.75v3.5H13\"/>", "chev": "<path d=\"M4.5 6.5 8 10l3.5-3.5\"/>", "chevr": "<path d=\"M6.5 4.5 10 8l-3.5 3.5\"/>", "more": "<circle cx=\"3.5\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"8\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"12.5\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>", "dup": "<rect x=\"5.25\" y=\"5.25\" width=\"8\" height=\"8\" rx=\"1.5\"/><path d=\"M10.75 2.75h-6a2 2 0 0 0-2 2v6\"/>", "trash": "<path d=\"M2.75 4.25h10.5M6 4.25V2.75h4v1.5\"/><path d=\"m4 4.25.6 9h6.8l.6-9M6.75 6.75v4.25M9.25 6.75v4.25\"/>", "close": "<path d=\"m4 4 8 8M12 4l-8 8\"/>"};
  const iconMarkup = (name,size=16,classes="") => `<svg class="wm-icon ${classes}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]||""}</svg>`;
  const iconElement = (name,size,classes="") => { const box=document.createElement("span");box.innerHTML=iconMarkup(name,size,classes);return box.firstElementChild; };


  const tree = byId('sidebarTree'), sidebar = byId('sidebar'), pane = byId('pane');

  const folderKey = 'notemind.openFolders', expanded = new Set(), contents = new Map();

  let roots = [], activePath = null, search = '', generation = 0, searchResults = [], menu = null, dragging = null;

  let searchIndex=-1;let drafts=[],activeId=null;let editing=false;window.addEventListener('sidebar-edit',e=>{editing=e.detail;render()});
  let registryReady=false;
  let libraryRecords=[],librarySettings={sort:'manual',smartFolders:[]},libraryFilter=null,libraryHits=[],scanTimer;
  window.addEventListener('notes-library',e=>{libraryRecords=e.detail.records;librarySettings=e.detail.settings;if(search){byId('sidebarSearch').dispatchEvent(new Event('input'));return;}if(libraryFilter)void applyLibraryFilter(libraryFilter);else render();});
  window.addEventListener('notes-files-changed',()=>void refresh());
  async function applyLibraryFilter(filter){libraryFilter=filter;libraryHits=await window.notemind.notes.list(filter);render();}
  function libraryRow(record){if(record.path){row({name:record.title,path:record.path,type:'file',library:true,excerpt:record.excerpt},0);return;}const item=document.createElement('div');item.className='tree-row note-row'+(search?' hit-row':'');item.tabIndex=0;item.setAttribute('role','treeitem');item.id='sidebar-hit-'+searchResults.indexOf(record);item.innerHTML=iconMarkup('doc',15,'row-icon')+'<div class="text"><div class="title"></div><div class="snippet"></div></div>';item.querySelector('.title').textContent=record.title;item.querySelector('.snippet').textContent=record.excerpt||'Draft';item.onclick=()=>window.NoteMindNotes.openRecord(record).catch(e=>alert(e.message));item.onkeydown=e=>{if(e.key==='Enter')item.click();};item.oncontextmenu=e=>{e.preventDefault();showMenu([{label:'Open',run:()=>window.NoteMindNotes.openRecord(record)},{label:'Tags and Pin…',run:()=>window.NoteMindLibrary.info(record)}],e.clientX,e.clientY);};tree.append(item);}
  function orderItems(items){if(librarySettings.sort==='manual')return items;const record=item=>libraryRecords.find(r=>r.path&&samePath(r.path,item.path));return [...items].sort((a,b)=>a.type!==b.type?a.type==='directory'?-1:1:librarySettings.sort==='title'?a.name.localeCompare(b.name):(record(b)?.[librarySettings.sort==='created'?'created':'modified']||'').localeCompare(record(a)?.[librarySettings.sort==='created'?'created':'modified']||''));}
  function organizationMenu(){return [{label:'All Notepads…',run:()=>window.NoteMindLibrary.library()},{label:'Pinned Notepads',run:()=>applyLibraryFilter({pinned:true})},{label:'Smart Folders…',run:()=>window.NoteMindLibrary.smartFolders()},{label:'Tags',submenu:[...new Set(libraryRecords.flatMap(r=>r.meta?.tags||[]))].sort().map(tag=>({label:'#'+tag,run:()=>applyLibraryFilter({tags:[tag]})}))},{label:'Sort Notepads',submenu:[['manual','Manual'],['title','Title'],['modified','Recently Edited'],['created','Recently Created']].map(([sort,label])=>({label,checked:librarySettings.sort===sort,run:async()=>{await window.notemind.notes.settings({sort});librarySettings.sort=sort;render();}}))},{label:'Recently Deleted…',run:()=>window.NoteMindLibrary.deleted()}];}

  window.addEventListener('notemind-path-renamed',e=>{const {from,to}=e.detail;for(const w of workspaces){w.files=(w.files||[]).map(p=>movePath(p,from,to));w.excluded=(w.excluded||[]).map(p=>movePath(p,from,to));w.folders=w.folders.map(p=>movePath(p,from,to));w.order=window.sidebarOrder.remap(w.order||{},from,to);}roots=workspaces.find(w=>w.id===workspaceId).folders;const next=[...expanded].map(p=>movePath(p,from,to));expanded.clear();next.forEach(p=>expanded.add(p));contents.clear();saveWorkspaces();void refresh();});

  let workspaces = [{ id: 'default', name: 'Default Workspace', folders: [] }], workspaceId = 'default';

  try { const stored = JSON.parse(localStorage.getItem('notemind.workspaces') || 'null'); if (Array.isArray(stored?.items) && stored.items.length) { workspaces = stored.items.filter(x => typeof x.id === 'string' && typeof x.name === 'string' && Array.isArray(x.folders)); workspaceId = stored.active; } else { const legacy = JSON.parse(localStorage.getItem(folderKey) || '[]'); if (Array.isArray(legacy)) workspaces[0].folders = legacy.filter(x => typeof x === 'string'); } } catch {}

  if (!workspaces.length) workspaces = [{ id: 'default', name: 'Default Workspace', folders: [] }];

  if (!workspaces.some(x => x.id === workspaceId)) workspaceId = workspaces[0].id;

  roots = workspaces.find(x => x.id === workspaceId).folders;

  function saveWorkspaces() { window.notemind.watchFolders(roots).catch(()=>{}); workspaces.find(x => x.id === workspaceId).folders = roots; localStorage.setItem('notemind.workspaces', JSON.stringify({ active: workspaceId, items: workspaces })); if(registryReady)window.notemind.workspacePut(workspaces.find(x=>x.id===workspaceId)).catch(error=>byId('status').textContent=error.message); byId('projectMenu').replaceChildren();const icon=iconElement('folder',15);const label=document.createElement('span');label.className='project-name';label.textContent=workspaces.find(x=>x.id===workspaceId).name;byId('projectMenu').className='bar-btn menu label folder-button';byId('projectMenu').append(icon,label); }

  function dismissMenu() { if (menu) menu.remove(); menu = null; }

  function showMenu(items, x, y, options={}) { if(window.notemindFloatingMenu){window.notemindFloatingMenu(items,x,y,options);return;}dismissMenu(); menu = document.createElement('div'); menu.className = 'shell-menu'; menu.setAttribute('role', 'menu'); for (const item of items) { if (item === '-') { menu.append(document.createElement('hr')); continue; } const button = document.createElement('button'); button.textContent = item.label; button.setAttribute('role', 'menuitem'); button.disabled = Boolean(item.disabled); if (item.danger) button.classList.add('danger'); button.onclick = () => { dismissMenu(); Promise.resolve().then(item.run).catch(error => { byId('status').textContent = error.message; }); }; menu.append(button); } document.body.append(menu); const rect = menu.getBoundingClientRect(); menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`; menu.querySelector('button:not(:disabled)')?.focus(); }

  document.addEventListener('pointerdown', event => { if (menu && !menu.contains(event.target)) dismissMenu(); }, true);

  document.addEventListener('keydown', event => { if (menu && event.key === 'Escape') { dismissMenu(); event.preventDefault(); } });

  const askText=(title,value='')=>window.notemindPrompt(title,value);

  function switchWorkspace(id) { if (id === workspaceId) return; saveWorkspaces(); workspaceId = id; roots = workspaces.find(x => x.id === id).folders; expanded.clear(); contents.clear(); roots.forEach(path => expanded.add(path)); saveWorkspaces(); render(); void refresh(); }

  const currentProject=()=>workspaces.find(w=>w.id===workspaceId);
  const projectSnapshot=()=>{const w=currentProject();return {folders:[...roots],files:[...(w.files||[])],excluded:[...(w.excluded||[])]};};
  // A change to the project's files or folders is also a step of the window's file Undo.
  function trackProject(label,change){const before=projectSnapshot();change();const after=projectSnapshot();if(JSON.stringify(before)!==JSON.stringify(after))window.notemind.projectHistory?.(label,before,after).catch(()=>{});}
  function adoptProject(snapshot){const w=currentProject();w.folders=[...snapshot.folders];roots=w.folders;w.files=[...snapshot.files];w.excluded=[...snapshot.excluded];expanded.clear();roots.forEach(p=>expanded.add(p));contents.clear();saveWorkspaces();render();void refresh();}
  async function projectSaveAs(){const saved=await window.notemind.workspaceSave(currentProject());if(saved)await window.notemind.workspaceWindow(saved);}
  async function projectRename(){const current=currentProject();if(workspaceId==='default'||!current.file||current.readOnly)return;const name=await askText('Project name',current.name);if(!name||name===current.name)return;const next=await window.notemind.workspaceRename(current,name);current.name=next.name;current.file=next.file;saveWorkspaces();}
  async function projectAddFiles(){for(const file of await window.notemind.chooseFiles())addWorkspaceFile(file);}
  async function workspaceMenu() {

    try {const shared=await window.notemind.workspaceList(); for(const w of shared){const i=workspaces.findIndex(x=>x.id===w.id);if(i<0)workspaces.push(w);else if(w.id!==workspaceId)workspaces[i]=w;}}catch(error){byId('status').textContent=error.message;}

    const current=workspaces.find(w=>w.id===workspaceId), rect=byId('projectMenu').getBoundingClientRect();

    const recent=await window.notemind.workspaceRecent().catch(()=>[]),defaultProject=workspaces.find(w=>w.id==='default'),openProject=async file=>{const project=await window.notemind.workspaceOpenPath(file);if(project)await window.notemind.workspaceWindow(project);};
    const items=[...(current.readOnly?[{label:'Read only: written by a newer NoteMind',disabled:true},'-']:[]),...(current.id!=='default'&&defaultProject?[{label:'Open Default Workspace',run:()=>window.notemind.workspaceWindow(defaultProject)}]:[])];

    items.push('-',

      {label:'New Project…',run:async()=>{const item=await window.notemind.workspaceNew();if(item)await window.notemind.workspaceWindow(item);}},

      {label:'Open Project…',run:async()=>{const item=await window.notemind.workspaceOpen();if(item)await window.notemind.workspaceWindow(item);}},

      {label:'Save Project As…',run:projectSaveAs},

      {label:'Rename Project…',disabled:workspaceId==='default'||!current.file||current.readOnly,run:projectRename},

      {label:'Close Project Window',run:()=>window.notemind.closeWindow()},

      {label:'Remove Project from List…',disabled:workspaceId==='default',run:async()=>{if(!confirm('Remove this project from the list? Its file and notes stay on disk.'))return;await window.notemind.workspacePut(current,true);registryReady=false;window.notemind.closeWindow();}},

      '-',{label:'Add Folder…',run:addFolder},{label:'Add Files…',run:projectAddFiles},

      {label:'Keep Open Notepad in Project',disabled:!activePath,run:()=>addWorkspaceFile(activePath)},

      {label:'Hidden Sections…',disabled:!current.excluded?.length,run:()=>showMenu(current.excluded.map(folder=>({label:'Show '+basename(folder),run:()=>{trackProject('Show Hidden Section',()=>{current.excluded=current.excluded.filter(p=>p!==folder);saveWorkspaces();});render();}})),rect.left,rect.top-180)});

    const others=workspaces.filter(w=>w.id!==workspaceId);
    const addTo=async id=>{const w=workspaces.find(w=>w.id===id);if(!w||!activePath)return;w.files||=[];if(!w.files.some(p=>samePath(p,activePath)))w.files.push(activePath);await window.notemind.workspacePut(w);};
    const recents=recent.filter(r=>!current.file||!samePath(r.path,current.file));
    items.splice(items.findIndex(i=>i?.label==='Save Project As…'),0,{label:'Open Recent',submenu:recents.length?recents.map(r=>({label:r.name+(r.exists?'':' (not found)'),disabled:!r.exists,run:()=>openProject(r.path)})):[{label:'No Recent Projects',disabled:true}]});
    items.push({label:'Add to Project',disabled:!activePath,submenu:others.length?others.map(w=>({label:w.name,run:()=>addTo(w.id)})):[{label:'No Other Projects',disabled:true}]});
    const removals=[...roots.map(folder=>({label:basename(folder),icon:'folder',run:()=>{trackProject('Remove Folder from Project',()=>{roots=roots.filter(p=>!samePath(p,folder));expanded.delete(folder);saveWorkspaces();});render();}})),...(current.files||[]).map(file=>({label:basename(file),icon:'doc',run:()=>{trackProject('Remove File from Project',()=>{current.files=current.files.filter(p=>!samePath(p,file));saveWorkspaces();});render();}}))];
    if(removals.length)items.push({label:'Remove from Project',submenu:removals});
    items.push('-',{label:'Reveal in File Manager',disabled:!current.file&&!roots.length,run:()=>window.notemind.revealPath(current.file||roots[0])},{label:'Clean Up Unused Images…',run:()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'cleanAssets'}))});
    items.push('-',...organizationMenu());showMenu(items,rect.left,rect.top,{above:true});

  }

  function addWorkspaceFile(file){if(!file)return;const current=workspaces.find(w=>w.id===workspaceId);trackProject('Add File to Project',()=>{current.files ||= [];if(!current.files.some(f=>samePath(f,file)))current.files.push(file);saveWorkspaces();});render();}

  window.addEventListener('notemind-keep-file',e=>addWorkspaceFile(e.detail));
  window.NoteMindSidebar={entryActions};

  const parentOf = path => { const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')); if (index < 0) return ''; if (index === 2 && /^[a-z]:/i.test(path)) return path.slice(0, 3); return path.slice(0, index) || path.slice(0, 1); };

  const basename = path => path.split(/[\\/]/).filter(Boolean).pop() || path;

  const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

  function row(item, depth, isRoot = false) {

    if((workspaces.find(w=>w.id===workspaceId).excluded||[]).some(p=>descendant(item.path,p)))return;

    const button = document.createElement('div'); button.tabIndex=0; button.className = 'tree-row'+(item.type==='directory'?' section-row':' note-row');button.onkeydown=e=>{if(e.target!==button)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();button.click()}else if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();const r=button.getBoundingClientRect();showEntryMenu(item,isRoot,r.left+24,r.bottom-4)}}; button.style.paddingLeft = `${depth * 16 + (item.type==='directory'?4:8)}px`;button.dataset.path=item.path;

    button.setAttribute('role', 'treeitem'); button.title = item.path;if(search){button.classList.add('hit-row');button.id='sidebar-hit-'+searchResults.indexOf(item);if(searchResults.indexOf(item)===searchIndex)button.classList.add('active');}

    if (samePath(activePath, item.path)) button.classList.add('open');

    const directory=item.type==='directory';
    if(directory)button.append(iconElement(expanded.has(item.path)?'chev':'chevr',12,'disclosure'));
    button.append(iconElement(directory?'folder':'doc',15,'row-icon'));
    const name=document.createElement(directory?'span':'div');name.className=directory?'name':'text';
    if(directory)name.textContent=item.name;
    else {const title=document.createElement('div');title.className='title';title.textContent=item.name.replace(/\.(nm|wm)$/i,'');name.append(title);if(item.excerpt){const snippet=document.createElement('div');snippet.className='snippet';snippet.textContent=item.excerpt;name.append(snippet);}}
    button.append(name);
    if(directory){const count=document.createElement('span');count.className='count';count.textContent=String((contents.get(item.path)||[]).filter(i=>i.type==='file').length);button.append(count);}

    if (item.type === 'directory') { button.setAttribute('aria-expanded', String(expanded.has(item.path))); button.onclick = async () => { if (expanded.has(item.path)) { expanded.delete(item.path); render(); return; } expanded.add(item.path); await read(item.path); render(); }; }

    else button.onclick = () => window.dispatchEvent(new CustomEvent('notemind-open-path', { detail: item.path }));

    if (!search && !item.attached && !item.library) { button.draggable = true; button.addEventListener('dragstart', event => { dragging = { ...item, isRoot }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.name); }); button.addEventListener('dragend', () => { dragging = null; for (const el of tree.querySelectorAll('.drop-target,.drop-before,.drop-after')) el.classList.remove('drop-target','drop-before','drop-after'); }); }

    const intent = event => { if (!dragging || samePath(dragging.path,item.path) || search) return null; const rect = button.getBoundingClientRect(), fraction = (event.clientY - rect.top) / Math.max(1, rect.height); const siblings = (isRoot && dragging.isRoot) || (!isRoot && !dragging.isRoot && samePath(parentOf(item.path),parentOf(dragging.path))); if (siblings && (item.type !== 'directory' || dragging.isRoot || fraction < .25 || fraction > .75)) return fraction < .5 ? 'before' : 'after'; if (!dragging.isRoot && item.type === 'directory' && !descendant(item.path, dragging.path)) return 'inside'; return null; };

    button.addEventListener('dragover', event => { const operation = intent(event); if (!operation) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; button.classList.remove('drop-target','drop-before','drop-after'); button.classList.add(operation === 'inside' ? 'drop-target' : operation === 'before' ? 'drop-before' : 'drop-after'); });

    button.addEventListener('dragleave', () => button.classList.remove('drop-target','drop-before','drop-after'));

    button.addEventListener('drop', async event => { const operation = intent(event), moving = dragging; event.preventDefault(); button.classList.remove('drop-target','drop-before','drop-after'); dragging = null; if (!operation || !moving) return; try { if (operation !== 'inside') { if (isRoot) roots = window.sidebarOrder.reorder(roots, moving.path, item.path, operation === 'after'); else { const parent = parentOf(item.path), entries = contents.get(parent) || []; const ordered = window.sidebarOrder.reorder(entries.map(entry => entry.path), moving.path, item.path, operation === 'after'); const workspace = workspaces.find(w => w.id === workspaceId); workspace.order ||= {}; workspace.order[parent] = ordered; contents.set(parent, window.sidebarOrder.sortItems(entries, ordered)); } saveWorkspaces(); render(); return; } const to = await window.notemind.moveEntry(moving.path, item.path); if (!to || samePath(to, moving.path)) return; for (const workspace of workspaces) { workspace.folders = workspace.folders.map(path => movePath(path, moving.path, to)); workspace.order = window.sidebarOrder.remap(workspace.order || {}, moving.path, to); } roots = workspaces.find(w => w.id === workspaceId).folders; const nextExpanded = [...expanded].map(path => movePath(path, moving.path, to)); expanded.clear(); nextExpanded.forEach(path => expanded.add(path)); expanded.add(item.path); contents.clear(); saveWorkspaces(); window.dispatchEvent(new CustomEvent('notemind-path-renamed', { detail: { from: moving.path, to } })); await refresh(); } catch (error) { byId('status').textContent = error.message; } });

    button.addEventListener('contextmenu', event => { event.preventDefault(); showEntryMenu(item, isRoot, event.clientX, event.clientY); });

    const actions=()=>entryActions(item,isRoot);
    const runAction=label=>{const entry=actions().find(i=>i?.label===label);if(entry)Promise.resolve(entry.run()).catch(error=>byId('status').textContent=error.message);};
    if(editing&&!isRoot&&!item.attached){
      const controls=document.createElement('span');controls.className='row-buttons';
      if(!directory){const duplicate=document.createElement('button');duplicate.className='row-button';duplicate.title='Duplicate';duplicate.setAttribute('aria-label','Duplicate '+item.name);duplicate.innerHTML=iconMarkup('dup',14);duplicate.onclick=e=>{e.stopPropagation();runAction('Duplicate')};controls.append(duplicate);}
      const trash=document.createElement('button');trash.className='row-button trash';trash.title='Move to Trash (click twice)';trash.setAttribute('aria-label','Move '+item.name+' to Trash');trash.innerHTML=iconMarkup('trash',14);trash.onclick=e=>{e.stopPropagation();if(trash.classList.contains('armed')){trash.classList.remove('armed');runAction('Move to Trash…')}else{tree.querySelectorAll('.trash.armed').forEach(b=>b.classList.remove('armed'));trash.classList.add('armed');trash.title='Click again to move to Trash'}};controls.append(trash);button.append(controls);
    }else{const more=document.createElement('button');more.className='row-more';more.title='More';more.setAttribute('aria-label','Options for '+item.name);more.innerHTML=iconMarkup('more',14);more.onclick=e=>{e.stopPropagation();const r=more.getBoundingClientRect();showEntryMenu(item,isRoot,r.left,r.bottom)};button.append(more);}
    tree.append(button);

    if (directory && expanded.has(item.path)) { addRow(depth+1,item.path);for (const child of orderItems(contents.get(item.path) || [])) row(child, depth + 1); }

  }

  const descendant = (path, base) => samePath(path, base) || path.toLowerCase().startsWith(base.toLowerCase().replace(/[\\/]+$/, '') + (base.includes('\\') ? '\\' : '/'));

  function movePath(path, from, to) { return descendant(path, from) ? to + path.slice(from.length) : path; }

  function showEntryMenu(item,isRoot,x,y){showMenu(entryActions(item,isRoot),x,y);}

  function entryActions(item, isRoot) {

    const directory = item.type === 'directory';

    if(item.attached){return [{label:'Open',run:()=>window.dispatchEvent(new CustomEvent('notemind-open-path',{detail:item.path}))},{label:'Show in File Manager',run:()=>window.notemind.revealPath(item.path)},{label:'Remove from Project',run:()=>{trackProject('Remove File from Project',()=>{const w=workspaces.find(w=>w.id===workspaceId);w.files=w.files.filter(p=>!samePath(p,item.path));saveWorkspaces();});render();}}];}

    const items = directory ? [

      { label: 'New Notepad Here', run: () => window.dispatchEvent(new CustomEvent('notemind-new-in-folder', { detail: { folder: item.path } })) },

      { label: 'New Section…', run: async () => { const name = await askText('New section name'); if (!name) return; await window.notemind.createFolder(item.path, name); expanded.add(item.path); await read(item.path); render(); } },

    ] : [

      { label: 'Open', run: () => window.dispatchEvent(new CustomEvent('notemind-open-path', { detail: item.path })) },

      { label: 'Duplicate', run: async () => { const copied = await window.notemind.duplicateEntry(item.path); await refresh(); if (copied) window.dispatchEvent(new CustomEvent('notemind-open-path', { detail: copied })); } },

    ];

    if(!directory)items.push({label:'Tags and Pin…',run:()=>window.NoteMindLibrary.info({path:item.path})});

    items.push({ label: 'Rename…', run: async () => { const extension = directory ? '' : (item.name.match(/\.[^.]+$/) || [''])[0]; const stem = extension ? item.name.slice(0, -extension.length) : item.name; const input = await askText('Rename', stem); if (!input) return; const name = extension && !input.toLowerCase().endsWith(extension.toLowerCase()) ? input + extension : input; if (name === item.name) return; const to = await window.notemind.renameEntry(item.path, name); if (!to) return; roots = roots.map(path => movePath(path, item.path, to)); for (const workspace of workspaces) { if (workspace.id !== workspaceId) workspace.folders = workspace.folders.map(path => movePath(path, item.path, to)); workspace.order = window.sidebarOrder.remap(workspace.order || {}, item.path, to); } const nextExpanded = [...expanded].map(path => movePath(path, item.path, to)); expanded.clear(); nextExpanded.forEach(path => expanded.add(path)); contents.clear(); saveWorkspaces(); window.dispatchEvent(new CustomEvent('notemind-path-renamed', { detail: { from: item.path, to } })); await refresh(); } });

    if(!isRoot)items.push({label:'Move to Folder…',run:async()=>{const folder=await window.notemind.chooseFolder();if(!folder)return;const to=await window.notemind.moveEntry(item.path,folder);if(to){window.dispatchEvent(new CustomEvent('notemind-path-renamed',{detail:{from:item.path,to}}));contents.clear();await refresh();}}});

    if(directory&&!isRoot)items.push({label:'Hide Section',run:()=>{trackProject('Hide Section',()=>{const w=workspaces.find(w=>w.id===workspaceId);(w.excluded ||= []).push(item.path);saveWorkspaces();});render();}});

    items.push({ label: 'Show in File Manager', run: () => window.notemind.revealPath(item.path) });

    if (isRoot) items.push('-', { label: 'Remove Folder from Project', run: () => { trackProject('Remove Folder from Project',()=>{roots = roots.filter(path => path !== item.path); expanded.delete(item.path); saveWorkspaces();}); render(); } });

    else items.push('-', { label: 'Move to Trash…', danger: true, run: async () => { if (!confirm(`Move ${item.name} to Trash?`)) return; const before = new CustomEvent('notemind-before-trash', { detail: { path: item.path }, cancelable: true }); if (!window.dispatchEvent(before)) return; await window.notemind.trashEntry(item.path); await refresh(); } });

    return items;

  }

  function addRow(depth,folder){const create=document.createElement('button');create.className='add-row';create.style.paddingLeft=(8+depth*16)+'px';create.innerHTML=iconMarkup('plus',14)+'New Notepad';create.onclick=()=>folder?window.dispatchEvent(new CustomEvent('notemind-new-in-folder',{detail:{folder}})):byId('new').click();tree.append(create);}

  function render() {

    tree.replaceChildren();const count=drafts.length+new Set([...contents.values()].flat().filter(e=>e.type==='file').map(e=>e.path).concat(workspaces.find(w=>w.id===workspaceId).files||[])).size;byId('note-count').textContent=String(count);byId('note-count').title=count+(count===1?' Notepad':' Notepads');byId('note-count').setAttribute('aria-label',byId('note-count').title);

    const attached=workspaces.find(w=>w.id===workspaceId).files||[];

    if (!roots.length && !attached.length && !drafts.length && !libraryFilter) { const empty = document.createElement('div'); empty.className='sidebar-empty';empty.innerHTML='<svg width=30 height=34 viewBox="0 0 12 14" fill=none><path d="M1.5 1h6l3 3v9h-9zM3.6 7h4.8M3.6 9.4h4.8" stroke=currentColor stroke-width=.8/></svg><div class=title>No Notepads yet</div><div class=buttons><button data-new>New Notepad</button><button data-folder>Add Folder…</button></div>';empty.querySelector('[data-new]').onclick=()=>byId('new').click();empty.querySelector('[data-folder]').onclick=addFolder;tree.append(empty);return; }

    if (search) { if (!searchResults.length) { const empty = document.createElement('div'); empty.className = 'empty-tree'; empty.textContent = 'No matching Notepads.'; tree.append(empty); } else for (const item of searchResults) item.path?row(item,0):libraryRow(item); return; }

    if(libraryFilter){const back=document.createElement('button');back.className='library-filter-back';back.textContent='‹ All workspace Notepads';back.onclick=()=>{libraryFilter=null;render();};tree.append(back);for(const record of libraryHits)libraryRow(record);if(!libraryHits.length){const empty=document.createElement('div');empty.className='empty-tree';empty.textContent='No matching Notepads.';tree.append(empty);}return;}
    addRow(0);
    const pinned=libraryRecords.filter(r=>r.meta?.pinned);
    if(pinned.length){const title=document.createElement('div');title.className='library-section';title.textContent='Pinned';tree.append(title);for(const record of pinned)libraryRow(record);}
    for(const folder of librarySettings.smartFolders){const item=document.createElement('div');item.className='tree-row section-row smart-folder-row';item.innerHTML=iconMarkup('folder',15,'row-icon')+'<span class="name"></span>';item.querySelector('.name').textContent=folder.name;item.tabIndex=0;item.setAttribute('role','treeitem');item.onclick=()=>applyLibraryFilter({smartId:folder.id});item.onkeydown=e=>{if(e.key==='Enter')item.click();};item.oncontextmenu=e=>{e.preventDefault();showMenu([{label:'Edit Smart Folder…',run:()=>window.NoteMindLibrary.smartFolder(folder)},{label:'Remove Smart Folder',run:()=>window.notemind.notes.settings({remove:folder.id})}],e.clientX,e.clientY);};tree.append(item);}

    for(const draft of drafts.filter(d=>!pinned.some(r=>r.id===d.noteId))){const item=document.createElement('div');item.tabIndex=0;item.setAttribute('role','treeitem');item.className='note-row'+(draft.id===activeId?' open':'');item.innerHTML=iconMarkup('doc',15,'row-icon')+'<div class="text"><div class="title"></div></div>';item.querySelector('.title').textContent=draft.title;item.onclick=()=>window.dispatchEvent(new CustomEvent('notemind-select-tab',{detail:draft.id}));item.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();item.click()}};const more=document.createElement('button');more.className='row-more';more.title='More';more.setAttribute('aria-label','Options for '+draft.title);more.innerHTML=iconMarkup('more',14);more.onclick=e=>{e.stopPropagation();item.click();const r=more.getBoundingClientRect();showMenu([{label:'Save As…',run:()=>byId('saveAs').click()},{label:'Tags and Pin…',run:()=>window.NoteMindLibrary.info()}],r.left,r.bottom)};item.append(more);tree.append(item);}
    for(const file of orderItems(attached.map(path=>({path,name:basename(path),type:'file'}))).map(i=>i.path))row({name:basename(file),path:file,type:'file',attached:true},0);

    for (const root of roots) row({ name: basename(root), path: root, type: 'directory' }, 0, true);

  }

  async function read(path) {

    if (!window.notemind.listFolder) return;

    try { const items = await window.notemind.listFolder(path); const workspace = workspaces.find(w => w.id === workspaceId); const orderEntry = Object.entries(workspace.order || {}).find(([folder]) => samePath(folder, path)); contents.set(path, window.sidebarOrder.sortItems(Array.isArray(items) ? items : [], orderEntry?.[1] || [])); }

    catch (error) { contents.set(path, []); byId('status').textContent = `Could not open folder: ${error.message}`; }

  }

  async function addFolder() {

    if (!window.notemind.chooseFolder) { byId('status').textContent = 'Folder browsing is unavailable.'; return; }

    try { const path = await window.notemind.chooseFolder(); if (!path) return; trackProject('Add Folder to Project',()=>{if (!roots.some(root => samePath(root, path))) roots.push(path); expanded.add(path); saveWorkspaces();}); await read(path); render(); }

    catch (error) { byId('status').textContent = `Could not open folder: ${error.message}`; }

  }

  async function refresh() { const current = ++generation; await Promise.all([...expanded].map(read)); if (current === generation) render();clearTimeout(scanTimer);scanTimer=setTimeout(()=>window.notemind.notes.scan([...roots,...(workspaces.find(w=>w.id===workspaceId).files||[])]).catch(e=>byId('status').textContent=e.message),500); }

  byId('chooseFolder').onclick = byId('chooseFolderFooter').onclick = addFolder;

  byId('projectMenu').onclick = workspaceMenu;
  window.addEventListener('notemind-command',async e=>{const id=e.detail;try{if(id==='projectNew'){const item=await window.notemind.workspaceNew();if(item)await window.notemind.workspaceWindow(item);}else if(id==='projectOpen'){const item=await window.notemind.workspaceOpen();if(item)await window.notemind.workspaceWindow(item);}else if(id==='projectDefault'){const item=workspaces.find(w=>w.id==='default');if(item)await window.notemind.workspaceWindow(item);}else if(id==='projectSaveAs')await projectSaveAs();else if(id==='projectRename')await projectRename();else if(id==='projectAddFiles')await projectAddFiles();}catch(error){byId('status').textContent=error.message;}});

  byId('sidebarRefresh').onclick = refresh;
  window.addEventListener('notemind-command',async e=>{if(e.detail!=='newSection')return;try{const parent=activePath?parentOf(activePath):roots[0];if(!parent){await addFolder();return;}const name=await askText('New section name');if(!name)return;await window.notemind.createFolder(parent,name);expanded.add(parent);await refresh();}catch(error){byId('status').textContent=error.message}});

  tree.addEventListener('contextmenu', event => { if (event.defaultPrevented) return; event.preventDefault(); const folder = roots.find(root => activePath && descendant(activePath, root)) || roots[0]; const items = [{ label: 'New Notepad', run: () => folder ? window.dispatchEvent(new CustomEvent('notemind-new-in-folder', { detail: { folder } })) : byId('new').click() }, { label: 'New Section…', disabled: !folder, run: async () => { const name = await askText('New section name'); if (!name) return; await window.notemind.createFolder(folder, name); expanded.add(folder); await read(folder); render(); } }, '-', { label: 'Add Folder…', run: addFolder }, { label: 'Show Folder in File Manager', disabled: !folder, run: () => window.notemind.revealPath(folder) }]; showMenu(items, event.clientX, event.clientY); });

  let searchTimer;

  const searchClear=document.createElement('button');searchClear.type='button';searchClear.className='clear';searchClear.hidden=true;searchClear.tabIndex=-1;searchClear.setAttribute('aria-label','Clear search');searchClear.innerHTML=iconMarkup('close',10);searchClear.onmousedown=e=>e.preventDefault();searchClear.onclick=()=>{byId('sidebarSearch').value='';byId('sidebarSearch').dispatchEvent(new Event('input'));byId('sidebarSearch').focus();};byId('sidebarSearch').parentElement.append(searchClear);
  byId('sidebarSearch').oninput = event => {searchClear.hidden=!event.target.value.length;searchIndex=-1;byId('sidebarSearch').removeAttribute('aria-activedescendant');search=event.target.value.trim().toLowerCase();const query=search,token=++generation;clearTimeout(searchTimer);searchResults=[];render();if(!query)return;searchTimer=setTimeout(async()=>{try{const hits=await window.notemind.notes.list({query});if(token!==generation)return;searchResults=hits.map(r=>({...r,name:r.path?basename(r.path):r.title,type:'file'}));for(const root of roots){const additional=await window.notemind.searchFolder(root,query);if(token!==generation)return;for(const item of additional)if(!searchResults.some(r=>samePath(r.path,item.path)))searchResults.push({...item,type:'file'});}if(token===generation)render();}catch(error){byId('status').textContent='Search failed: '+error.message;}},180);};

  byId('sidebarSearch').onkeydown=e=>{const rows=[...tree.querySelectorAll('.hit-row')];if(e.key==='Escape'){searchClear.click();e.preventDefault();return;}if(!rows.length)return;if(e.key==='Enter'&&searchIndex>=0){rows[searchIndex]?.click();e.preventDefault();return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();searchIndex=e.key==='Home'?0:e.key==='End'?rows.length-1:e.key==='ArrowDown'?Math.min(rows.length-1,searchIndex+1):searchIndex<0?rows.length-1:Math.max(0,searchIndex-1);rows.forEach((row,i)=>row.classList.toggle('active',i===searchIndex));byId('sidebarSearch').setAttribute('aria-activedescendant',rows[searchIndex].id);rows[searchIndex].scrollIntoView({block:'nearest'});};
  window.addEventListener('notemind-command',e=>{if(e.detail==='searchNotepads'){sidebarChoice=true;applySidebar();byId('sidebarSearch').focus();byId('sidebarSearch').select();}});

  let sidebarChoice=null;try{const value=JSON.parse(localStorage.getItem('notemind.sidebarVisible'));if(typeof value==='boolean')sidebarChoice=value;}catch{}
  function applySidebar(){sidebar.hidden=document.querySelector('main').hidden||(sidebarChoice===null?innerWidth<1000:!sidebarChoice);byId('sidebarResize').hidden=sidebar.hidden;byId('sidebarToggle').setAttribute('aria-expanded',String(!sidebar.hidden));}
  byId('sidebarToggle').onclick=()=>{sidebarChoice=sidebar.hidden;localStorage.setItem('notemind.sidebarVisible',JSON.stringify(sidebarChoice));applySidebar();window.dispatchEvent(new Event('resize'));};
  window.addEventListener('resize',applySidebar);applySidebar();

  setTimeout(()=>window.dispatchEvent(new Event('notemind-document-request')),0);
  window.addEventListener('notemind-document', event => { drafts=event.detail?.drafts||[];activeId=event.detail?.activeId;const path = event.detail?.path || null; const changed = !samePath(activePath, path) && path !== activePath; activePath = path; render(); if (changed && path) void refresh(); });

  window.addEventListener('tablet-visibility', event => { byId('paneResize').hidden = !event.detail; });

  function resize(handle, element, side, min, max) {

    let start = null;

    handle.addEventListener('pointerdown', event => { start = { x: event.clientX, width: element.getBoundingClientRect().width }; handle.setPointerCapture(event.pointerId); event.preventDefault(); });

    handle.addEventListener('pointermove', event => { if (!start) return; const width = Math.max(min, Math.min(max(), start.width + side * (event.clientX - start.x))); if(element===sidebar)document.querySelector('.workspace').style.setProperty('--sidebar-w',`${width}px`);else element.style.width = `${width}px`; window.dispatchEvent(new Event('resize')); });

    handle.addEventListener('pointerup', () => { start = null; }); handle.addEventListener('pointercancel', () => { start = null; });

    handle.addEventListener('keydown', event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; const width = element.getBoundingClientRect().width + side * (event.key === 'ArrowLeft' ? -10 : 10); if(element===sidebar)document.querySelector('.workspace').style.setProperty('--sidebar-w',`${Math.max(min,Math.min(max(),width))}px`);else element.style.width = `${Math.max(min,Math.min(max(),width))}px`; window.dispatchEvent(new Event('resize')); event.preventDefault(); });

  }

  resize(byId('sidebarResize'), sidebar, 1, 180, () => Math.min(360,innerWidth-(pane.hidden?300:600)));

  for (const root of roots) expanded.add(root);

  window.addEventListener('notemind-command',e=>{if(e.detail==='workspaceWindow')window.notemind.workspaceWindow(workspaces.find(w=>w.id===workspaceId));if(e.detail==='toggleEditor'){const main=document.querySelector('main');main.hidden=!main.hidden;applySidebar();if(main.hidden){pane.hidden=false;window.dispatchEvent(new CustomEvent('tablet-visibility',{detail:true}));}window.dispatchEvent(new Event('resize'));}});

  window.addEventListener('notemind-command',async e=>{if(!['undoFile','redoFile'].includes(e.detail))return;try{const result=await window.notemind.fileHistory(e.detail==='undoFile'?'undo':'redo');if(result?.change)window.dispatchEvent(new CustomEvent('notemind-path-renamed',{detail:result.change}));if(result?.project)adoptProject(result.project);await refresh();byId('status').textContent=result?result.label:'No file action to undo or redo.';}catch(error){byId('status').textContent=error.message;}});
  let keptLayout;try{keptLayout=JSON.parse(localStorage.getItem('notemind.layout')||'null')}catch{}if(Number.isFinite(keptLayout?.sidebar))document.querySelector('.workspace').style.setProperty('--sidebar-w',Math.max(180,Math.min(360,keptLayout.sidebar))+'px');

  function keepLayout(){try{localStorage.setItem('notemind.layout',JSON.stringify({sidebar:sidebar.getBoundingClientRect().width||parseFloat(getComputedStyle(sidebar).width)||240,pane:pane.getBoundingClientRect().width||460}));}catch{}}
  window.addEventListener('pointerup',keepLayout);byId('sidebarResize').addEventListener('keyup',keepLayout);

  (async()=>{try{const shared=await window.notemind.workspaceList();for(const w of shared){const i=workspaces.findIndex(x=>x.id===w.id);if(i<0)workspaces.push(w);else workspaces[i]=w;}const seed=await window.notemind.workspaceSeed();if(seed){if(!workspaces.some(w=>w.id===seed.id))workspaces.push(seed);workspaceId=seed.id;}if(!workspaces.some(w=>w.id===workspaceId))workspaceId='default';roots=workspaces.find(w=>w.id===workspaceId).folders;expanded.clear();roots.forEach(p=>expanded.add(p));registryReady=true;saveWorkspaces();await refresh();}catch(error){byId('status').textContent='Could not load workspaces: '+error.message;}})();

  window.notemind.onFoldersChanged(()=>{if(search)byId('sidebarSearch').dispatchEvent(new Event('input'));else void refresh();});
  saveWorkspaces(); render(); void refresh();

})();

