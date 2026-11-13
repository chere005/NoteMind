const {app,Menu,BrowserWindow,nativeTheme}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/footer-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const set=async(text,visualMode)=>{await js((text,visualMode)=>{addTab({path:null,text,assets:{},meta:{}});if(visual!==visualMode)switchMode(visualMode);},text,visualMode);await pause(700);};
 const command=async detail=>{await js(detail=>window.dispatchEvent(new CustomEvent('notemind-command',{detail})),detail);await pause(80);};
 const words=()=>js(()=>document.getElementById('wordCount').textContent);
 try{
  await pause(1000);
  check(await js(()=>{const footer=document.querySelector('main footer').getBoundingClientRect(),zoom=document.getElementById('zoomBox').getBoundingClientRect();return footer.right-zoom.right<20&&document.getElementById('modeLabel').hidden;}),'Zoom percentage occupies the far right of the footer');
  await set('one two three four',true);check(await words()==='4 words','The footer counts the words on the page');
  await set('single',true);check(await words()==='1 word','One word is singular');
  await set('# Title\n\nsome **bold** words here',false);check(await words()==='5 words','Markdown markers are not counted as words');
  await set('# Open\n\nvisible text\n\n# Closed\n\nhidden paragraph here',true);
  await js(()=>{document.querySelectorAll('#rich > h1').forEach(h=>h.dispatchEvent(new Event('x')));window.NoteMindWriting.collapseAll(true);});await pause(700);
  check(Number((await words()).split(' ')[0])<=5,'Folded sections are not counted');
  await js(()=>{document.getElementById('status').textContent='Saved';});await pause(150);
  check(await js(()=>/^Saved \d/.test(document.getElementById('savedAt').textContent)),'The footer says when the Notepad was saved');
  await js(()=>addTab({path:null,text:'A different draft',assets:{}}));check(await js(()=>document.getElementById('savedAt').textContent===''),'Switching notes clears the previous note’s saved timestamp');

  const view=Menu.getApplicationMenu().items.find(i=>i.label==='View').submenu.items;
  check(view.some(i=>i.label==='Zoom In'&&i.accelerator==='CmdOrCtrl+=')&&view.some(i=>i.label==='Zoom Out'&&i.accelerator==='CmdOrCtrl+-')&&view.some(i=>i.label==='Actual Size'&&i.accelerator==='CmdOrCtrl+0'),'View has Zoom In, Zoom Out and Actual Size');
  await command('zoomIn');check(await js(()=>document.getElementById('zoomBox').value==='110'&&document.getElementById('rich').style.zoom==='1.1'&&document.getElementById('source').style.zoom==='1.1'),'Zoom In steps to 110% on both pages');
  check(await js(()=>document.getElementById('tablet-root').style.zoom===''&&document.documentElement.style.zoom===''),'Zoom leaves the drawing pane alone');
  await command('zoomOut');await command('zoomOut');check(await js(()=>document.getElementById('zoomBox').value==='90'),'Zoom Out steps down');
  await js(()=>{const box=document.getElementById('zoomBox');box.value='150';box.dispatchEvent(new Event('change'));});check(await js(()=>document.getElementById('rich').style.zoom==='1.5'),'The footer box sets the zoom');
  await pause(500);check(JSON.stringify(await js(()=>window.notemind.preferenceGet('view')))==='{"zoom":150}','The zoom is remembered');
  await command('zoomReset');check(await js(()=>document.getElementById('zoomBox').value==='100'&&document.getElementById('rich').style.zoom==='1'),'Actual Size returns to 100%');
  const background=BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase();
  check(background===(nativeTheme.shouldUseDarkColors?'#1e1e20':'#f4f3ef'),'The window background follows the system theme');
  fs.writeFileSync(path.join(root,'footer.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>document.querySelector('footer').innerText).catch(()=>null);}
 fs.writeFileSync('test-results/footer.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
