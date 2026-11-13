const {app,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/tabs-recents-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
const note=path.join(root,'Recent Note.md');fs.writeFileSync(note,'# Recent\n\nhello\n');
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const topMenu=label=>Menu.getApplicationMenu().items.find(i=>i.label===label);
 const recent=label=>topMenu(label).submenu.items.find(i=>i.label==='Open Recent').submenu.items;
 const menuLabels=()=>js(()=>[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].map(b=>b.getAttribute('data-menu-label')||b.textContent.replace(/\s*[▸›]\s*$/,'').trim()));
 try{
  await pause(1100);
  check(recent('File')[0].label==='No Recent Items'&&recent('Projects')[0].label==='No Recent Items','Open Recent starts empty in File and Projects');
  await js(file=>window.notemind.remember(file),note);await pause(400);
  const items=recent('File');
  check(items[0].label==='Recent Note.md'&&items.some(i=>i.label==='Clear Menu'),'A file that was opened appears under File > Open Recent');
  items[0].click();await pause(500);
  check(await js(file=>tabs.some(t=>t.doc.path&&t.doc.path.toLowerCase()===file.toLowerCase()),note),'Choosing a recent file opens it');
  recent('File').find(i=>i.label==='Clear Menu').click();await pause(400);
  check(recent('File')[0].label==='No Recent Items','Clear Menu empties the list');

  await js(()=>{addTab({path:null,text:'two',assets:{},meta:{}});addTab({path:null,text:'three',assets:{},meta:{}});});await pause(150);
  const index=()=>js(()=>tabs.indexOf(activeTab));const count=await js(()=>tabs.length);
  const before=await index();
  await js(()=>document.getElementById('documentTabs').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true})));await pause(250);
  check(await index()===(before+1)%count,'The wheel over the tab row moves to the next tab');
  await js(()=>document.getElementById('documentTabs').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true})));await pause(250);
  check(await index()===before,'The wheel the other way moves back');

  await js(file=>{const found=tabs.find(t=>t.doc.path&&t.doc.path.toLowerCase()===file.toLowerCase());activateTab(found);},note);await pause(150);
  await js(()=>{const b=document.querySelector('#documentTabs .document-tab.selected button.name');b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:30}));});await pause(150);
  const labels=await menuLabels();
  check(['Close Tab','Close Other Tabs','Move Left','Move Right','Rename…','Duplicate','Move to Folder…','Show in File Manager','Move to Trash…'].every(l=>labels.includes(l)),'The tab menu offers Rename, Duplicate, Move to, Reveal and Move to Trash');
  await js(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await pause(80);

  const long=Array.from({length:120},(_,i)=>'Paragraph number '+i+' with some words in it to take up room on the page.').join('\n\n');
  await js(text=>{addTab({path:null,text,assets:{},meta:{}});if(!visual)switchMode(true);},long);await pause(300);
  const placed=await js(()=>{const wrap=rich.parentElement;wrap.scrollTop=1800;return new Promise(r=>setTimeout(()=>r(wrap.scrollTop),700));});
  check(placed>1000,'The long Notepad scrolls');
  const top=await js(()=>{const wrap=rich.parentElement,block=[...rich.children].find(el=>el.offsetTop+el.offsetHeight>wrap.scrollTop);return block.textContent.slice(0,22);});
  await js(()=>activateTab(tabs[0]));await pause(250);
  await js(text=>activateTab(tabs.find(t=>t.doc.text===text||t.doc.text.startsWith('Paragraph number 0'))),long);await pause(400);
  const back=await js(()=>{const wrap=rich.parentElement,block=[...rich.children].find(el=>el.offsetTop+el.offsetHeight>wrap.scrollTop);return block.textContent.slice(0,22);});
  check(back===top,'Coming back to a tab puts the same words at the top of the page');
  await js(()=>window.NoteMindNotes.session());await pause(300);
  const recovered=await js(()=>window.notemind.notes.recover());
  check(recovered.tabs.some(t=>t.scroll&&t.scroll.v===1&&t.scroll.block>5),'The scroll place is kept in the session for the next launch');
  fs.writeFileSync(path.join(root,'tabs.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>({tabs:tabs.length,active:tabs.indexOf(activeTab),menu:document.querySelector('[role=menu]')?.innerText})).catch(()=>null);}
 fs.writeFileSync('test-results/tabs-recents.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
