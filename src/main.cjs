const { app, BrowserWindow, ipcMain, dialog, screen, powerMonitor, session, shell, clipboard, ClipboardItem, nativeImage, Menu, globalShortcut, nativeTheme } = require('electron');

const fs = require('node:fs/promises');

const path = require('node:path');
const {keyPath,physicalPath}=require('./path-key.cjs');

const { runPython, stopPython } = require('./python.cjs');

const { pack, unpack } = require('./zip.cjs');

if (process.env.NOTEMIND_DATA) app.setPath('userData', path.resolve(process.env.NOTEMIND_DATA));

const {NotesStore,digest,titleOf}=require('./notes-store.cjs');
const notesStore=new NotesStore(path.join(process.env.NOTEMIND_HOME||app.getPath('userData'),'notes-library'),path.join(app.getPath('userData'),'note-recovery'));
const fileActions=require('./file-actions.cjs')(path.join(app.getPath('userData'),'file-history'),async file=>{const item=await notesStore.captureDeleted(file);await shell.trashItem(file);await notesStore.finishDeleted(item);});
let win, padController;
const projectHome=process.env.NOTEMIND_HOME||app.getPath('userData'),projectService=require('./projects.cjs')(projectHome,process.env.NOTEMIND_WORKSPACES||path.join(projectHome,'workspaces'),path.join(process.env.NOTEMIND_DATA&&!process.env.NOTEMIND_HOME?projectHome:app.getPath('documents'),'NoteMind Projects'));
const welcome=require('./welcome.cjs')(()=>win,openPath,projectService);
const documentIO=require('./document-io.cjs');documentIO.register(()=>win,()=>padController?.contents());
const notepadFormat=require('./notepad-format.cjs');
const notesIPC=require('./notes-ipc.cjs')({store:notesStore,getWin:()=>win,openPath,saveDocument,documentIO});

require('./features.cjs')(() => win, projectService);

let pen;
const inputMonitoring=require('./input-monitoring.cjs').createInputMonitoring({shell,helper:process.platform==='darwin'?path.join(__dirname,'helpers','wm-pen-display'):null,onError:error=>console.error('Input Monitoring:',error.message)});

let sheetWrite = Promise.resolve();

let cameraWrite = Promise.resolve();

let closing = false, closeTimer;

function sheetSaveFailed(reason) { closing = false; const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Keep editing', 'Close without saving sheets'], defaultId: 0, cancelId: 0, message: 'The drawing sheets could not be saved.', detail: `${reason}\nClosing without saving can lose recent ink.` }); if (choice === 1) { win.confirmedClose = true; win.close(); } }

const instance = app.requestSingleInstanceLock();

const closeOnly=process.argv.includes('--close-window');
if (!instance||closeOnly) app.quit();

const documentArg = args => args.slice(1).find(arg => !arg.startsWith('-') && /\.(nm|wm|wmpr|md|txt|py|docx|pdf|png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(arg));

let pendingDocument = documentArg(process.argv),guidePending=process.argv.includes('--tour');
let showWelcomeAtStart=!process.env.NOTEMIND_DATA&&!process.argv.includes('--workspace')&&!pendingDocument&&!guidePending;

app.on('open-file', (event, file) => { event.preventDefault(); if (!/\.(nm|wm|wmpr|md|txt|py|docx|pdf|png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file)) return; if (win && !win.isDestroyed() && !win.webContents.isLoading()) {win.show();win.focus();welcome.dispose();win.webContents.send('file:open-request', path.resolve(file));} else pendingDocument = file; });

app.on('second-instance', (_, args) => { if(args.includes('--close-window')){win?.close();return;}const file = documentArg(args); if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (file) win.webContents.send('file:open-request', path.resolve(file)); else if(args.includes('--tour')){welcome.dispose();win.webContents.send('menu:command','welcomeNote');} } else if (file) pendingDocument = file; });

if (instance&&!closeOnly) app.whenReady().then(() => {

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => callback(webContents === win?.webContents && permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'video')));

  let bounds={width:1440,height:920}; try {const kept=JSON.parse(require('node:fs').readFileSync(path.join(app.getPath('userData'),'window.json'),'utf8')); const displays=screen.getAllDisplays(); if(displays.some(d=>kept.x<d.workArea.x+d.workArea.width && kept.x+kept.width>d.workArea.x && kept.y<d.workArea.y+d.workArea.height && kept.y+kept.height>d.workArea.y))bounds=kept;}catch{}

  let padEnabled=process.env.NOTEMIND_TEST_NO_PAD!=='1';if(padEnabled)try{padEnabled=JSON.parse(require('node:fs').readFileSync(path.join(projectHome,'pad.json'),'utf8')).enabled!==false;}catch{}
  if(padEnabled&&require('./pad-display.cjs').findPenDisplay(screen.getAllDisplays(),screen.getPrimaryDisplay().id))showWelcomeAtStart=false;

  win = new BrowserWindow({ ...bounds, show:!showWelcomeAtStart, minWidth: 800, minHeight: 550, autoHideMenuBar: false, title: 'NoteMind', icon:path.join(__dirname,'icon.png'), backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#f4f3ef', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });

  win.setAutoHideMenuBar(false);
  win.setMenuBarVisibility(true);

  const external=url=>{try{if(['https:','http:','mailto:'].includes(new URL(url).protocol))void shell.openExternal(url);}catch{}};
  win.webContents.on('will-navigate',(event,url)=>{event.preventDefault();external(url);});
  let claimingPad=false;
  const padOwnerFile=process.env.NOTEMIND_PAD_OWNER||(process.env.NOTEMIND_DATA?path.join(projectHome,'pad-owner.json'):path.join(app.getPath('documents'),'NoteMind','Devices','pad-owner.json'));
  const padOwnership=require('./pad-ownership.cjs').createPadOwnership({file:padOwnerFile,onChange:owned=>padController?.setOwned(owned)});
  const claimPad=()=>{if(claimingPad||!padController?.state().available||!padController.state().enabled)return;claimingPad=true;padOwnership.claim().catch(error=>console.error('Pen display ownership:',error)).finally(()=>{claimingPad=false;});};
  padController=require('./pad-controller.cjs').createPadController({screen,owner:win,enabled:padEnabled,owned:false,onFocus:claimPad,dark:()=>nativeTheme.shouldUseDarkColors,onFrame:data=>{if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('pad:frame',data);},onChange:state=>{if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed()){win.webContents.send('pad:state',state);if(state.available&&state.enabled&&!state.owned&&win.isFocused())claimPad();}}});
  padOwnership.start();win.on('focus',claimPad);win.once('closed',()=>padOwnership.stop());if(win.isFocused())claimPad();
  win.webContents.setWindowOpenHandler(details=>{const answer=padController.decision(details);if(answer.action==='allow')return answer;external(details.url);return {action:'deny'};});
  win.webContents.on('did-create-window',(child,details)=>{if(details.frameName==='notemind-pen-display')padController.attach(child);else child.close();});

  const command = id => () => id==='welcome'?welcome.show():win?.webContents.send('menu:command', id);
  const formatMenu=require('./keys.cjs').menu(command);
  globalShortcut.register('CommandOrControl+Alt+N',()=>{if(win.isMinimized())win.restore();win.show();win.focus();win.webContents.send('menu:command','quickNote');});

  const recentFiles=[],recentProjects=[];
  const recentMenu=(list,open)=>list.length?[...list.map(file=>({label:path.basename(file),sublabel:path.dirname(file),click:()=>open(file)})),{type:'separator'},{label:'Clear Menu',click:()=>projectService.recents.clear()}]:[{label:'No Recent Items',enabled:false}];
  const buildMenu=()=>Menu.setApplicationMenu(Menu.buildFromTemplate([

    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),

    {label:'File',submenu:[
      {label:'New Notepad',accelerator:'CmdOrCtrl+N',click:command('new')},
      {label:'Quick Note',accelerator:'CmdOrCtrl+Alt+N',click:command('quickNote')},
      {label:'Open…',accelerator:'CmdOrCtrl+O',click:command('open')},
      {label:'Open Recent',submenu:recentMenu(recentFiles,file=>win?.webContents.send('file:open-request',file))},
      {type:'separator'},
      {label:'Save',accelerator:'CmdOrCtrl+S',click:command('save')},
      {label:'Save As…',accelerator:'CmdOrCtrl+Shift+S',click:command('saveAs')},
      {id:'delete-note',label:'Delete Notepad…',enabled:win.canDelete!==false,accelerator:'CmdOrCtrl+Backspace',click:command('deleteNote')},
      {type:'separator'},
      {label:'Import',submenu:[{label:'Markdown as Notepad…',click:command('importMarkdown')},{label:'Word or PDF…',click:command('importDocument')},{label:'Read Text from Image…',click:command('readImage')}]},
      {label:'Export',submenu:[{label:'Export as PDF…',accelerator:'CmdOrCtrl+Shift+E',click:command('exportPDF')},{label:'Word…',click:command('exportWord')},{label:'Drawing…',click:command('exportDrawing')}]},
      {type:'separator'},
      {label:'Welcome',click:command('welcome')},
      {label:'Close Tab',accelerator:'CmdOrCtrl+W',click:command('closeTab')},
      {label:'Close Window',click:()=>win.close()},
    ]},

    {label:'Projects',submenu:[{label:'New Project…',accelerator:'CmdOrCtrl+Shift+N',click:command('projectNew')},{label:'Open Project…',click:command('projectOpen')},{label:'Open Recent',submenu:recentMenu(recentProjects,file=>projectService.open(file).then(project=>win?.webContents.send('workspace:open',project)).catch(error=>dialog.showErrorBox('Open Project',error.message)))},{label:'Open Default Workspace',click:command('projectDefault')},{type:'separator'},{label:'Save Project As…',click:command('projectSaveAs')},{label:'Rename Project…',click:command('projectRename')},{label:'Project Menu…',click:command('projectMenu')},{label:'Open Project in New Window',click:command('workspaceWindow')},{type:'separator'},{label:'Add Folder…',accelerator:'CmdOrCtrl+Shift+A',click:command('chooseFolder')},{label:'Add Files…',click:command('projectAddFiles')}]},

    { label: 'Edit', submenu: [{label:'Undo',accelerator:'CmdOrCtrl+Z',click:command('undoText')}, {label:'Redo',accelerator:process.platform==='darwin'?'CmdOrCtrl+Shift+Z':'Ctrl+Y',click:command('redoText')},{label:'Undo File Action',click:command('undoFile')},{label:'Redo File Action',click:command('redoFile')}, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },{type:'separator'},{label:'Find in Notepad',accelerator:'CmdOrCtrl+F',click:command('findNote')},{label:'Find and Replace…',accelerator:process.platform==='darwin'?'Alt+Cmd+F':'Ctrl+H',click:command('findReplace')},{label:'Find Next',accelerator:'F3',click:command('findNext')},{label:'Find Previous',accelerator:'Shift+F3',click:command('findPrevious')},{label:'Use Selection for Find',accelerator:'CmdOrCtrl+E',click:command('findSelection')},{label:'Search Notepads',accelerator:'CmdOrCtrl+Shift+F',click:command('searchNotepads')}] },

    { label: 'Format', submenu: formatMenu },
    { label: 'View', submenu: [{ label: 'Toggle Notepads Sidebar', click: command('sidebarToggle') }, { label: 'Rendered Page', click: command('visual') }, { label: 'Markdown Source', click: command('markdown') }, { label: 'Toggle Capture Pane', accelerator:'CmdOrCtrl+Shift+Y',click: command('paneToggle') }, { type: 'separator' }, { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: command('zoomReset') }, { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: command('zoomIn') }, { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: command('zoomOut') }, { label:'Toggle Editor Pane',click:command('toggleEditor') }] },

    {label:'Drawing',submenu:[['undo','Undo Drawing'],['redo','Redo Drawing'],['toggleErase','Erase Tool'],['toggleSelect','Select Tool'],['togglePenDraws','Pen Always Draws'],['nextColour','Next Colour'],['prevColour','Previous Colour'],['wider','Wider Line'],['thinner','Thinner Line'],['deleteSelection','Delete Selection'],['clearSelection','Clear Selection'],['sendWriting','Send Drawing'],['sendPage','Send Picture'],['clearSheet','Clear Sheet'],['nextSheet','Next Sheet'],['prevSheet','Previous Sheet']].map(([id,label])=>({label,click:command('pen:'+id)}))},

    {label:'Capture',submenu:[{label:'Switch Wacom Screen / Window',click:command('padToggle')},{type:'separator'},{label:'Drawing',click:command('source:tablet')},{label:'Camera',click:command('source:camera')},{label:'Turn Input Off',click:command('inputOff')},{label:'Tablet Settings…',click:command('penSettings')},{label:'Refresh Device List',accelerator:'CmdOrCtrl+Alt+R',click:command('cameraRefresh')},{label:'Aspect Ratio',submenu:[['free','Free'],['1.3333333333333333','4:3'],['1.7777777777777777','16:9'],['1','Square']].map(([value,label])=>({label,click:command('cameraAspect:'+value)}))}]},

    {label:'Notepad',submenu:[['writingTools','Formatting Options…'],['noteInfo','Tags and Pin…'],['attachments','Attachments…'],['attachFiles','Attach Files…'],['scanPages','Multipage Scan…'],['insertNoteLink','Link to Notepad…'],['indexImages','Read Images for Search'],['library','All Notepads…'],['smartFolders','Smart Folders…'],['versions','Version History…'],['recentlyDeleted','Recently Deleted…']].map(([id,label])=>({label,click:command(id)}))},

    { label: 'Tools', submenu: [{ label: 'Run Python', accelerator: 'F5', click: command('run') },{label:'Stop Python',click:()=>stopPython()},{label:'Python Interpreter…',click:command('pythonSetup')},{type:'separator'},{label:'Clean Up Unused Images…',click:command('cleanAssets')}] },

    {label:'Help',submenu:[{label:'Welcome to NoteMind',click:command('welcomeNote')},{label:'Quick Reference',click:command('quickReference')},{label:'Keyboard Shortcuts',accelerator:'F1',click:command('shortcuts')},{label:'About NoteMind',click:()=>dialog.showMessageBox(win,{message:'NoteMind',detail:'A private Markdown and drawing workspace. Version '+app.getVersion()})}]},

    {label:'Window',submenu:[{label:'Minimize',click:()=>win.minimize()},{label:'Zoom',click:()=>win.isMaximized()?win.unmaximize():win.maximize()},{type:'separator'},{label:'Move Tab Left',click:command('moveTabLeft')},{label:'Move Tab Right',click:command('moveTabRight')},{label:'Close Window',click:()=>win.close()}]},

  ]));
  buildMenu();
  const refreshRecents=async()=>{const all=await projectService.recents.read();recentFiles.splice(0,recentFiles.length,...all.files.map(x=>x.path));recentProjects.splice(0,recentProjects.length,...all.projects.map(x=>x.path));buildMenu();};
  projectService.recents.onChange(refreshRecents);refreshRecents();

  const log = message => { void fs.appendFile(path.join(app.getPath('userData'), 'startup.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {}); };

  win.webContents.on('console-message', (...args) => log(`renderer: ${JSON.stringify(args.slice(1))}`));

  win.webContents.on('render-process-gone', (_, details) => log(`renderer stopped: ${JSON.stringify(details)}`));

  win.webContents.on('did-fail-load', (_, code, description) => log(`load failed: ${code} ${description}`));

  win.webContents.on('did-finish-load', () => { if (pendingDocument) { win.show();win.focus();welcome.dispose();win.webContents.send('file:open-request', path.resolve(pendingDocument)); pendingDocument = null; } else if(guidePending){guidePending=false;win.show();win.focus();win.webContents.send('menu:command','welcomeNote');} else if(showWelcomeAtStart)welcome.show(); });

  win.on('closed',()=>{padController?.dispose();padController=null;documentIO.dispose();welcome.dispose();app.quit();});
  win.loadFile(path.join(__dirname, 'index.html'));

  pen = require('./pen-bundle.cjs').startPenSubsystem({ app, screen, ipc: ipcMain, powerMonitor, window: () => win, e2e: false, env: process.env, platform: process.platform, penHelper: process.platform === 'darwin' ? path.join(__dirname, 'helpers', 'wm-pen') : null, displayHelper: process.platform === 'darwin' ? path.join(__dirname, 'helpers', 'wm-pen-display') : null, onDisplayStatus:status=>{const request=inputMonitoring.onStatus(status);if(request)void request.then(result=>{if(result.access==='granted')pen?.displayRetry?.();});}, displayTarget:()=>padController?.captureEligible()&&win&&!win.isDestroyed()?{id:win.id,rotation:padController.state().rotation}:null, log: line => console.log(line) });

  pen.attachWindow();

  win.on('close', event => {

    if (win.confirmedClose) {try{require('node:fs').writeFileSync(path.join(app.getPath('userData'),'window.json'),JSON.stringify(win.getNormalBounds()));}catch{}stopPython();return;}

    event.preventDefault(); if (closing) return;

    // Every open draft is flushed before the window closes.

    closing = true; win.webContents.send('sheets:flush-request');

    closeTimer = setTimeout(() => sheetSaveFailed('The save request timed out.'), 10000);

  });

});

app.on('window-all-closed', () => { globalShortcut.unregisterAll();pen?.dispose(); app.quit(); });

ipcMain.handle('dirty', (event,value,canDelete) => {const window=BrowserWindow.fromWebContents(event.sender);if(!window)return;window.isDirty=value;if(typeof canDelete==='boolean'){window.canDelete=canDelete;if(window===win){const item=Menu.getApplicationMenu()?.getMenuItemById('delete-note');if(item)item.enabled=canDelete;}}});

async function openPath(file, recover = true) {
  try{file=await fs.realpath(file);}catch(error){if(error.code!=='ENOENT')throw error;file=path.resolve(file);}
  const ext = path.extname(file).toLowerCase();
  if(recover&&['.nm','.wm','.md','.txt','.py'].includes(ext)){const known=(await notesStore.list({paths:[file]})).find(r=>r.path&&keyPath(r.path)===keyPath(file));if(known)try{const kept=await notesStore.loadDraft(known.id);if(kept.dirty&&kept.path&&keyPath(kept.path)===keyPath(file))return kept;}catch{}}


  if(ext==='.wmpr')return {workspace:await projectService.open(file)};
  if(['.docx','.pdf','.png','.jpg','.jpeg','.webp','.gif','.bmp','.svg','.avif'].includes(ext))return {preview:{path:file,name:path.basename(file)}};
  if (!['.nm', '.wm', '.md', '.txt', '.py'].includes(ext)) throw Error('Unsupported file type.');

  const bytes = await fs.readFile(file);

  if(ext==='.md')return notesStore.register({...await require('./markdown-files.cjs').read(file,bytes.toString('utf8')),revision:digest(bytes)});
  if (!['.nm','.wm'].includes(ext)) return notesStore.register({ path: file, text: bytes.toString('utf8'), assets: {},revision:digest(bytes) });

  const parsed=notepadFormat.decode(bytes),files=parsed.files; if(files['workspace.json'])return {workspace:await projectService.open(file)}; if (!files['document.md']) throw Error('This file does not contain document.md.');

  const assets = {}; for (const [name, data] of Object.entries(files)) if (name.startsWith('assets/')) assets[name] = data.toString('base64');

  return notesStore.register({ path: file, text: parsed.text, assets, id:parsed.id, title:parsed.title,meta:parsed.meta,created:parsed.created,revision:digest(bytes) });

}

ipcMain.handle('open', async () => {

  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['nm','wm', 'md', 'txt', 'py','docx','pdf','png','jpg','jpeg','webp','gif','bmp','svg','avif'] }] });

  if (result.canceled) return null;
  const opened = await openPath(result.filePaths[0]);
  if (opened && !opened.workspace) projectService.recents.remember(result.filePaths[0], 'file').catch(() => {});
  return opened;

});

ipcMain.handle('open-path', (_, file) => openPath(file));

ipcMain.handle('choose-folder', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });

ipcMain.handle('list-folder', async (_, folder) => {

  const entries = await fs.readdir(folder, { withFileTypes: true });

  return entries.filter(e => !e.name.startsWith('.') && (e.isDirectory() || (e.isFile() && /\.(nm|wm|md|txt|py|docx|pdf|png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(e.name))))

    .map(e => ({ name: e.name, path: path.join(folder, e.name), type: e.isDirectory() ? 'directory' : 'file' }))

    .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'directory' ? -1 : 1);

});

ipcMain.handle('search-folder', async (_, folder, query) => {

  if (typeof query !== 'string' || !query.trim()) return [];

  const needle = query.trim().toLocaleLowerCase(), pending = [folder], results = []; let seen = 0;

  while (pending.length && seen < 5000 && results.length < 100) {

    const directory = pending.pop(); let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }

    for (const entry of entries) {

      if (entry.name.startsWith('.')) continue;

      const file = path.join(directory, entry.name);

      if (entry.isDirectory()) { pending.push(file); continue; }

      if (!entry.isFile() || !/\.(nm|wm|md|txt|py|docx|pdf|png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(entry.name)) continue;

      if (++seen > 5000) break;

      try {

        const stat = await fs.stat(file); if (stat.size > 10 * 1024 * 1024) continue;

        const bytes = await fs.readFile(file); const text = /\.(nm|wm)$/i.test(file) ? unpack(bytes)['document.md']?.toString('utf8') : bytes.toString('utf8');

        if (text == null) continue;

        const index = text.toLocaleLowerCase().indexOf(needle); if (index < 0) continue;

        const excerpt = text.slice(Math.max(0, index - 70), Math.min(text.length, index + needle.length + 90)).replace(/\s+/g, ' ').trim();

        results.push({ path: file, name: entry.name, excerpt }); if (results.length >= 100) break;

      } catch { /* A single unreadable or invalid file does not stop search. */ }

    }

  }

  return results;

});

ipcMain.handle('load-sheets', async () => {
  await sheetWrite;

  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'sheets.json'), 'utf8')); }

  catch (error) { if (error.code === 'ENOENT') return null; throw error; }

});

ipcMain.handle('save-sheets', async (_, data) => {

  if (!Array.isArray(data)) throw Error('Invalid sheet data');

  const content = JSON.stringify(data); if (Buffer.byteLength(content) > 100 * 1024 * 1024) throw Error('Sheet data is too large');

  const file = path.join(app.getPath('userData'), 'sheets.json');

  const write = async () => { const temp = `${file}.${require('node:crypto').randomUUID()}.tmp`; try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => {}); } };

  const pending = sheetWrite.then(write, write); sheetWrite = pending.catch(() => {}); await pending;

});

ipcMain.handle('load-camera-pages', async () => { await cameraWrite; try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'camera-pages.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } });

ipcMain.handle('save-camera-pages', async (_, data) => { if (!Array.isArray(data)) throw Error('Invalid camera page data'); const content = JSON.stringify(data); if (Buffer.byteLength(content) > 200 * 1024 * 1024) throw Error('Camera pages are too large'); const file = path.join(app.getPath('userData'), 'camera-pages.json'); const write = async () => { const temp = `${file}.${require('node:crypto').randomUUID()}.tmp`; try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => {}); } }; const pending = cameraWrite.then(write, write); cameraWrite = pending.catch(() => {}); await pending; });

ipcMain.on('sheets:flush-done', (event, error) => { if (!closing || event.sender !== win.webContents) return; clearTimeout(closeTimer); if (error) { sheetSaveFailed(String(error)); return; } closing = false; win.confirmedClose = true; win.close(); });

const validName = name => typeof name === 'string' && name.trim() === name && name.length > 0 && name !== '.' && name !== '..' && !/[\\/:*?"<>|]/.test(name);

ipcMain.handle('create-folder', async (_, parent, name) => { if (!validName(name)) throw Error('Choose a valid folder name.'); const target = path.join(parent, name); return fileActions.create(target); });

ipcMain.handle('rename-entry', async (_, source, name) => { if (!validName(name)) throw Error('Choose a valid name.'); const target = path.join(path.dirname(source), name); if (source === target) return target; try { await fs.access(target); throw Error('An item with that name already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } await settleDocumentWrites(source);await fileActions.rename(source,target);await notesStore.rename(source,target);notesIPC.send();return target; });

ipcMain.handle('duplicate-entry', async (_, source) => { const ext = path.extname(source), stem = path.basename(source, ext); for (let i = 1; i < 10000; i++) { const target = path.join(path.dirname(source), `${stem} copy${i === 1 ? '' : ` ${i}`}${ext}`); try { return await fileActions.duplicate(source,target); } catch (error) { if (error.code !== 'EEXIST') throw error; } } throw Error('Could not find an available name.'); });

ipcMain.handle('move-entry', async (_, source, folder) => { const src = path.resolve(source), dir = path.resolve(folder), target = path.join(dir, path.basename(src)); const key = p => process.platform === 'win32' ? p.toLowerCase() : p; if (key(src) === key(target)) return src; const stat = await fs.lstat(src); if (stat.isDirectory() && (key(dir) === key(src) || key(dir).startsWith(key(src) + path.sep))) throw Error('A folder cannot be moved inside itself.'); try { await fs.access(target); throw Error('An item with that name already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } await settleDocumentWrites(src);await fileActions.rename(src,target);await notesStore.rename(src,target);notesIPC.send();return target; });

ipcMain.handle('trash-entry', async (_, source) => {await settleDocumentWrites(source);await fileActions.trash(source);notesIPC.send();});
const ownsPadEvent=event=>!!win&&!win.isDestroyed()&&event.sender===win.webContents;
ipcMain.handle('pad:request-access',async event=>{if(!ownsPadEvent(event))return null;const result=await inputMonitoring.request();if(result.access==='granted')pen?.displayRetry?.();return result;});
ipcMain.handle('pad:retry',event=>{if(ownsPadEvent(event))pen?.displayRetry?.();});
ipcMain.handle('pad:state',event=>ownsPadEvent(event)?padController?.state():null);
ipcMain.handle('pad:close',event=>{if(!ownsPadEvent(event))return null;padController?.setEnabled(false);return padController?.state();});
ipcMain.handle('pad:set',async(event,enabled)=>{if(!ownsPadEvent(event)||typeof enabled!=='boolean')return null;padController?.setEnabled(enabled);const file=path.join(projectHome,'pad.json'),temp=file+'.'+require('node:crypto').randomUUID()+'.tmp';await fs.mkdir(projectHome,{recursive:true});try{await fs.writeFile(temp,JSON.stringify({enabled}));await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}return padController?.state();});
ipcMain.handle('pad:ready',event=>{if(ownsPadEvent(event))padController?.markReady();});
ipcMain.on('pad:input',(event,input)=>{if(ownsPadEvent(event))padController?.input(input);});
ipcMain.on('pad:activity',event=>{if(ownsPadEvent(event))padController?.activity();});
ipcMain.on('pad:pen-heartbeat',event=>{if(ownsPadEvent(event))pen?.displayHeartbeat?.();});
ipcMain.on('pad:pen-stop',event=>{if(ownsPadEvent(event))pen?.displayStop?.();});
ipcMain.handle('edit-native',(_,action)=>{if(!['cut','copy','paste','selectAll'].includes(action))throw Error('Invalid edit action');win?.webContents[action]();});
ipcMain.handle('spell-add',(_,word)=>{if(typeof word!=='string'||!word.trim()||word.length>100)throw Error('Invalid word');win?.webContents.session.addWordToSpellCheckerDictionary(word.trim());});
ipcMain.handle('recent-remember',(_,file)=>{if(typeof file!=='string'||!file)throw Error('Invalid file');return projectService.recents.remember(path.resolve(file),'file');});
ipcMain.handle('shortcuts-list',()=>require('./shortcuts.cjs').list(Menu.getApplicationMenu()));
ipcMain.handle('welcome-note',async(_,options)=>{
  const file=await require('./welcome-note.cjs').ensure({directory:path.join(app.getPath('documents'),'NoteMind'),stateFile:path.join(projectHome,'preferences','welcome-note.json'),version:app.getVersion(),preserve:options?.preserve===true,blocked:(await notesStore.deleted()).map(item=>item.path).filter(Boolean)});
  const current=(await projectService.registry.list()).find(w=>w.id==='default')||{id:'default',name:'Default Workspace',folders:[],files:[]};
  const {sameFile}=require('./workspaces.cjs'),covered=current.folders.some(folder=>{const rel=path.relative(folder,file);return !rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);});
  if(!covered&&!(current.files||[]).some(p=>sameFile(p,file)))await projectService.registry.put({...current,files:[...(current.files||[]),file]});
  return file;
});
ipcMain.handle('quick-reference',async()=>{
  const file=path.join(projectHome,'NoteMind Quick Reference.nm'),version=app.getVersion();let current=null;
  try{current=notepadFormat.decode(await fs.readFile(file)).meta?.quickReference;}catch{}
  if(current!==version){
    const shortcuts=require('./shortcuts.cjs'),text=require('./quick-reference.cjs').markdown(shortcuts.markdown(shortcuts.list(Menu.getApplicationMenu())));
    const bytes=notepadFormat.encode({text,assets:{},title:'NoteMind Quick Reference',meta:{quickReference:version}}),temp=file+'.'+require('node:crypto').randomUUID()+'.tmp';
    await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(temp,bytes,{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}
  }
  return file;
});
ipcMain.handle('project-history',(_,label,before,after)=>fileActions.project(String(label),before,after));
ipcMain.handle('file-history',async(_,which)=>{if(!['undo','redo'].includes(which))throw Error('Invalid action');const result=await fileActions.step(which);if(result?.change)await notesStore.rename(result.change.from,result.change.to);await notesStore.reconcileDeleted(result?.restored);notesIPC.send();return result;});

ipcMain.handle('reveal-path', (_, source) => shell.showItemInFolder(source));

ipcMain.handle('open-external',(_,url)=>{if(typeof url!=='string'||!['https:','http:','mailto:'].includes(new URL(url).protocol))throw Error('Unsupported link.');return shell.openExternal(url);});

ipcMain.handle('copy-table', (_, data) => { if(typeof data?.text!=='string'||typeof data?.html!=='string'||data.html.length>5_000_000)throw Error('Invalid table clipboard data.'); return ClipboardItem ? clipboard.write([new ClipboardItem({'text/plain':data.text,'text/html':data.html})]) : clipboard.write({text:data.text,html:data.html}); });
ipcMain.handle('copy-png', (_, base64) => { const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64')); if (image.isEmpty()) throw Error('Could not copy image.'); return ClipboardItem ? clipboard.write([new ClipboardItem({'image/png':new Blob([image.toPNG()],{type:'image/png'})})]) : clipboard.writeImage(image); });

const documentWrites=new Map();
async function settleDocumentWrites(source){const key=keyPath(source);await Promise.allSettled([...documentWrites.entries()].filter(([file])=>file===key||file.startsWith(key+path.sep)).map(([,pending])=>pending));}
async function saveDocument(doc,saveAs=false,automatic=false){
 let file=saveAs?null:doc.path;
 if(automatic&&!file)throw Error('Choose a file before saving.');
 if(!file){const suggested=(doc.title||titleOf(doc.text)).replace(/[\\/:*?"<>|]/g,'-')+'.nm';const result=await dialog.showSaveDialog(win,{defaultPath:doc.path||(doc.initialFolder?path.join(doc.initialFolder,suggested):suggested),filters:[{name:'Notepad',extensions:['nm','wm']},{name:'Markdown',extensions:['md']},{name:'Python',extensions:['py']},{name:'Text',extensions:['txt']}]});if(result.canceled)return null;file=result.filePath;}
 file=physicalPath(file);
 const key=keyPath(file);
 const write=async()=>{
  const ext=path.extname(file).toLowerCase();if(!['.nm','.wm','.md','.txt','.py'].includes(ext))throw Error('Choose a .nm, .md, .txt, or .py file.');
  if((doc.otherOpenPaths||[]).some(other=>keyPath(other)===key))throw Error('That file is already open in another tab.');
  if(!['.nm','.wm','.md'].includes(ext)&&Object.keys(doc.assets||{}).length)throw Error('Save as .nm to keep attachments.');
  let previous;try{previous=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!saveAs&&doc.revision&&(!previous||digest(previous)!==doc.revision))throw Error('The file changed outside this window. Your draft is safe. Use Save As to keep both, or reopen the file.');
  doc=await notesStore.register({...doc,path:file},{meta:doc.meta});
  if(previous){try{const old=['.nm','.wm'].includes(ext)?notepadFormat.decode(previous):ext==='.md'?await require('./markdown-files.cjs').read(file,previous.toString('utf8')):{text:previous.toString('utf8'),assets:{}};await notesStore.version({...old,id:doc.id,title:doc.title},'Before save');}catch(error){if(['.nm','.wm'].includes(ext))throw error;}}
  if(ext==='.md')doc=await require('./markdown-files.cjs').prepare(doc,file,{metadata:false});
  if(['.nm','.wm'].includes(ext))doc=require('./markdown-files.cjs').canonical(doc);
  const bytes=['.nm','.wm'].includes(ext)?notepadFormat.encode(doc):Buffer.from(doc.text);
  await require('./guarded-write.cjs').replaceIfUnchanged(file,bytes,previous??null,{afterCommit:ext==='.md'?()=>require('./markdown-files.cjs').writeMetadata(doc,file):undefined});
  doc={...doc,path:file,revision:digest(bytes)};delete doc.otherOpenPaths;
  await notesStore.version(doc,automatic?'Autosaved':'Saved');await notesStore.draft({...doc,dirty:false});notesIPC.send();return doc;
 };
 const next=(documentWrites.get(key)||Promise.resolve()).catch(()=>{}).then(write);documentWrites.set(key,next);try{return await next}finally{if(documentWrites.get(key)===next)documentWrites.delete(key);}
}
ipcMain.handle('save',(_,doc,saveAs)=>saveDocument(doc,saveAs));

ipcMain.handle('image', async () => {
  const systemPictures=require('node:fs').existsSync('/usr/bin/sips');
  const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','gif','webp','svg','bmp','avif',...(systemPictures?['heic','heif','tif','tiff']:[])]}]});
  if(result.canceled)return null;
  const file=result.filePaths[0];let bytes,name=path.basename(file);
  if(systemPictures&&/\.(heic|heif|tif|tiff)$/i.test(file)){
    const temp=path.join(app.getPath('temp'),'notemind-'+require('node:crypto').randomUUID()+'.png');
    try{await require('node:util').promisify(require('node:child_process').execFile)('/usr/bin/sips',['-s','format','png',file,'--out',temp]);bytes=await fs.readFile(temp);name=path.basename(file,path.extname(file))+'.png';}finally{await fs.unlink(temp).catch(()=>{});}
  }else bytes=await fs.readFile(file);
  return {name:'assets/'+Date.now()+'-'+name.replace(/[^a-zA-Z0-9._-]/g,'-'),data:bytes.toString('base64')};
});

ipcMain.handle('run-python', async (_, file) => {

  let executable; try{executable=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'python.json'),'utf8')).executable;}catch{} return runPython(file,process.platform,executable,text=>{if(win&&!win.isDestroyed())win.webContents.send('python:output',text)});

});


ipcMain.handle('python-stop',()=>stopPython());

ipcMain.handle('close-sheet-choice',async(_,name)=>{const r=await dialog.showMessageBox(win,{type:'question',message:'Save changes to '+name+'?',buttons:['Save','Don’t Save','Cancel'],defaultId:0,cancelId:2});return ['save','discard','cancel'][r.response]});
