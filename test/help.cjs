const {app,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/help-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const notepad=require(path.resolve('src/notepad-format.cjs')),shortcuts=require(path.resolve('src/shortcuts.cjs'));
 try{
  await pause(1000);
  const help=Menu.getApplicationMenu().items.find(i=>i.label==='Help').submenu.items;
  check(help.find(i=>i.label==='Keyboard Shortcuts').accelerator==='F1','Help > Keyboard Shortcuts is on F1');
  const expected=shortcuts.list(Menu.getApplicationMenu());
  check(expected.some(e=>e.label==='Bold')&&expected.some(e=>e.label==='Export as PDF…')&&expected.some(e=>e.label==='Move Section Up')&&expected.some(e=>e.label==='New Project…'),'The list is read from the real menu, so every batch of shortcuts is in it');

  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'shortcuts'})));await pause(500);
  const rows=await js(()=>[...document.querySelectorAll('.shortcuts-dialog .shortcut-row')].map(r=>r.innerText.replace(/\s+/g,' ').trim()));
  check(rows.length===expected.length,'The dialog lists every shortcut ('+rows.length+')');
  check(rows.some(r=>/Bold/.test(r)&&/(Ctrl\+B|⌘B)/.test(r)),'Bold shows its key');
  check(rows.every(r=>!/CommandOrControl|Electron|Quit/.test(r))&&rows.some(r=>/Copy/.test(r)&&/(Ctrl\+C|⌘C)/.test(r)),'Roles show readable keys and the system application menu is left out');
  await js(()=>{const i=document.querySelector('.shortcuts-dialog input');i.value='pdf';i.dispatchEvent(new Event('input'));});
  const filtered=await js(()=>[...document.querySelectorAll('.shortcuts-dialog .shortcut-row')].map(r=>r.innerText.replace(/\s+/g,' ').trim()));
  check(filtered.length===1&&/Export as PDF/.test(filtered[0]),'Searching narrows the list');
  await js(()=>{const i=document.querySelector('.shortcuts-dialog input');i.value='zzzz';i.dispatchEvent(new Event('input'));});
  check(await js(()=>document.querySelector('.shortcuts-dialog').innerText.includes('No shortcut matches')),'An empty search says so');
  await js(()=>document.querySelector('.shortcuts-dialog [data-close]').click());

  const file=await js(()=>window.notemind.quickReference());
  check(file.endsWith('NoteMind Quick Reference.nm')&&fs.existsSync(file),'The Quick Reference is a Notepad file');
  const first=notepad.decode(fs.readFileSync(file));
  check(first.text.startsWith('# NoteMind Quick Reference')&&first.text.includes('## Keyboard shortcuts')&&first.text.includes('## Documents and pictures')&&first.meta.quickReference===app.getVersion(),'It holds the shortcuts and the guide, stamped with the version');
  check(expected.every(e=>first.text.includes(e.keys+' — '+e.label)),'Every shortcut is in the note');
  check(/Export as PDF/.test(first.text)&&/Find and Replace/.test(first.text),'The newer features are described');
  const stamp=fs.statSync(file).mtimeMs;await pause(50);await js(()=>window.notemind.quickReference());
  check(fs.statSync(file).mtimeMs===stamp,'An up-to-date note is left alone');
  fs.writeFileSync(file,notepad.encode({text:'# old',assets:{},meta:{quickReference:'0.0.1'}}));
  await js(()=>window.notemind.quickReference());
  check(notepad.decode(fs.readFileSync(file)).text.startsWith('# NoteMind Quick Reference'),'An out-of-date note is rewritten');
  const before=await js(()=>tabs.length);
  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'quickReference'})));await pause(900);
  check(await js(b=>tabs.length===b&&activeTab.doc.path&&activeTab.doc.path.endsWith('NoteMind Quick Reference.nm'),before),'Help > Quick Reference replaces the pristine startup tab');
  fs.writeFileSync(path.join(root,'help.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>document.querySelector('dialog')?.innerText||document.getElementById('status').textContent).catch(()=>null);}
 fs.writeFileSync('test-results/help.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
