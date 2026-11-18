const {app,Menu,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/welcome-guide-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.setPath('documents',root);app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const sourceRoot=process.env.NOTEMIND_TEST_APP||path.resolve('src'),format=require(path.join(sourceRoot,'notepad-format.cjs'));
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);if(tested)return;tested=true;w.webContents.once('did-finish-load',async()=>{
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')'),check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const wait=async(fn)=>{for(let i=0;i<150;i++){if(await js(fn))return;await pause(100);}throw Error('Timed out: '+fn.toString());};
 try{
  await wait(()=>!!window.NoteMindNotes?.ready);await js(()=>{switchMode(false);source.value='My unfinished draft';source.dispatchEvent(new Event('input'));return NoteMindNotes.flush();});
  const draft=await js(()=>doc.id);
  const help=Menu.getApplicationMenu().items.find(i=>i.label==='Help').submenu.items.find(i=>i.label==='Welcome to NoteMind');check(!!help,'Help exposes the feature guide');help.click();
  await wait(()=>doc.title==='Welcome to NoteMind');
  const file=await js(()=>doc.path);check(file===path.join(root,'NoteMind','Welcome to NoteMind.nm')&&fs.existsSync(file),'Guide is a visible native Notepad');
  check(await js(id=>tabs.some(t=>t.doc.id===id&&t.doc.text.includes('unfinished')),draft),'Opening the guide preserves the active draft');
  check(await js(()=>visual&&rich.querySelector('h1').textContent.includes('Welcome to NoteMind')&&rich.querySelectorAll('input[type=checkbox]').length===4&&rich.querySelectorAll('table').length===2),'Rendered guide demonstrates real writing controls');
  await pause(500);check(await js(()=>[...document.querySelectorAll('#sidebarTree .tree-row')].some(r=>r.textContent.includes('Welcome to NoteMind'))),'Guide appears in the Default Workspace sidebar');
  check((await js(()=>window.notemind.workspaceList())).find(w=>w.id==='default').files.includes(file),'Sidebar link persists in the workspace registry');
  check(await js(()=>!!rich.querySelector('mark')&&!!rich.querySelector('u')&&!!rich.querySelector('pre code.language-python')),'Formatting and code examples render correctly');
  const original=format.decode(fs.readFileSync(file));
  await js(()=>{rich.querySelector('input[type=checkbox]').click();NoteMindTables.focus(rich.querySelector('td'));});
  // Select only the sample cell; ordinary keyboard input then uses the real editor.
  await js(()=>{const cell=rich.querySelector('td'),r=document.createRange();r.selectNodeContents(cell);getSelection().removeAllRanges();getSelection().addRange(r);});await w.webContents.insertText('My edited example');await js(()=>NoteMindNotes.flush());
  const edited=format.decode(fs.readFileSync(file));check(edited.text.includes('My edited example')&& /\[x\]\s+Tick this box\./.test(edited.text),'Checklist and table edits save through the normal editor');check(JSON.stringify(edited.assets)===JSON.stringify(original.assets),'Editing examples retains the drawing and PDF assets');
  await js(()=>NoteMindHelp.welcomeNote());check(await js(()=>tabs.filter(t=>t.doc.path===doc.path).length===1&&currentText().includes('My edited example')&&rich.querySelector('input').checked),'Reopening Help preserves guide edits and uses one tab');
  await js(()=>{const ink=rich.querySelector('img[data-asset="assets/welcome-ink.svg"]');ink.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:100}));});
  await wait(()=>!!document.querySelector('.float-menu [data-menu-label="Edit with Tablet"]'));
  await js(()=>document.querySelector('.float-menu [data-menu-label="Edit with Tablet"]').click());
  await wait(()=>document.querySelector('.sheet-scroll .sheet-tab.on .name')?.textContent==='Welcome sketch');
  await js(()=>document.querySelector('.sheet-tabs [data-bar=pane-menu]').click());
  await wait(()=>!!document.querySelector('.float-menu [data-bar=pane-save-original]'));
  check(await js(()=>!!document.querySelector('[data-tablet=surface]')&&!!document.querySelector('.float-menu [data-bar=pane-save-original]')),'The ink example opens in the actual drawing editor with an original target');
  await js(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  await js(()=>{rich.querySelector('[data-attachment]').click();});
  await wait(()=>document.querySelector('.pdf-reference:not([hidden]) [aria-label="PDF page number"]')?.max==='2'&&!!document.querySelector('.pdf-reference:not([hidden]) .pdf-reference-paper canvas'));
  check(await js(()=>document.querySelector('.pdf-reference:not([hidden])').dataset.docKind==='pdf'&&!!document.querySelector('.pdf-reference:not([hidden]) .pdf-reference-paper canvas')),'The bundled reference opens as a real two-page PDF');
  Menu.getApplicationMenu().items.find(i=>i.label==='File').submenu.items.find(i=>i.label==='Welcome').click();let start;for(let i=0;i<100&&!start;i++){start=BrowserWindow.getAllWindows().find(b=>b!==w&&b.webContents.getURL().endsWith('welcome.html'));if(!start)await pause(50);}if(!start)throw Error('Welcome screen missing');
  if(start.webContents.isLoading())await new Promise(resolve=>start.webContents.once('did-finish-load',resolve));await pause(300);const sj=code=>start.webContents.executeJavaScript(code);
  check(await sj("!!document.querySelector('[data-start=guide]')"),'Welcome screen offers Explore Features');
  start.setContentSize(660,392);await pause(150);check(await sj("[...document.querySelectorAll('.start-button')].every(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})"),'All welcome actions fit at the minimum window size');
  await sj("document.querySelector('[data-start=guide]').click()");await pause(600);check(start.isDestroyed()&&await js(()=>tabs.filter(t=>t.doc.title==='Welcome to NoteMind').length===1&&currentText().includes('My edited example')),'Explore Features reopens the edited guide without duplicate tabs');
  await js(()=>NoteMindNotes.flush());fs.writeFileSync(path.join(root,'guide.png'),(await w.webContents.capturePage()).toPNG());report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>({status:$('status').textContent,title:doc.title,dialogs:[...document.querySelectorAll('dialog')].map(d=>d.innerText)})).catch(()=>null);}
 fs.writeFileSync('test-results/welcome-guide.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
 });});require(path.join(sourceRoot,'main.cjs'));setTimeout(()=>app.exit(1),65000).unref();
