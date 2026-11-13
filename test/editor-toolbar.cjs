const {app,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/editor-toolbar-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;const js=s=>w.webContents.executeJavaScript(s.includes(';')&&!s.startsWith('(()=>')?'(()=>{'+s+'})()':s),check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name)};
 try{
  await pause(1000);
  const barVisible=()=>js("(()=>{const bar=document.getElementById('toolbar'),r=bar.getBoundingClientRect();return !bar.hidden&&getComputedStyle(bar).display!=='none'&&r.height>=28&&r.width>0&&r.bottom<=innerHeight})()");
  const toggle=async()=>{await js("document.querySelector('[aria-label=\"Toggle Markdown\"]').click()");await pause(120);};
  check(await barVisible()&&w.isMenuBarVisible(),'formatting bar and native menu are visible on startup');
  await toggle();check(await js("!document.getElementById('source').hidden")&&await barVisible(),'visible mode toggle enters Markdown without hiding the bar');
  fs.writeFileSync(path.join(root,'markdown.png'),(await w.webContents.capturePage()).toPNG());
  await js("const source=document.getElementById('source');source.value='A small note';source.setSelectionRange(2,7);source.dispatchEvent(new Event('input'));document.querySelector('[data-command=bold]').click();undefined");
  check(await js("document.getElementById('source').value==='A **small** note' && !document.getElementById('toolbar').hidden"),'Markdown toolbar stays visible and formats only the selected text');
  await toggle();check(await js("document.querySelector('#rich strong')?.textContent==='small'")&&await barVisible(),'WYSIWYG keeps the formatting bar and renders Markdown formatting');fs.writeFileSync(path.join(root,'wysiwyg.png'),(await w.webContents.capturePage()).toPNG());
  await toggle();check(await js("document.getElementById('source').value==='A **small** note'"),'mode round trip preserves the document');
  await js("const source=document.getElementById('source');source.value='First\\nSecond';source.setSelectionRange(0,source.value.length);document.querySelector('[data-command=insertUnorderedList]').click();undefined");
  check(await js("document.getElementById('source').value==='- First\\n- Second'"),'Markdown list action formats every selected line');
  await js("document.getElementById('new').click();document.getElementById('documentTabs').querySelector('button').click()");
  check(await js("!document.getElementById('toolbar').hidden && !document.getElementById('source').hidden"),'returning to a Markdown tab keeps the toolbar available');
  for(const mode of ['visual','markdown','visual','markdown']){w.webContents.send('menu:command',mode);await pause(120);check(await barVisible()&&w.isMenuBarVisible(),'native View '+mode+' keeps both bars visible');}
  await js("document.querySelector('[data-command=italic]').click()");check(await js("document.getElementById('source').value.includes('*')"),'formatting control remains usable after repeated mode switches');
  check(Menu.getApplicationMenu().items.some(item=>item.label==='Notepad'),'Notepad application menu remains installed');
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 fs.writeFileSync('test-results/editor-toolbar.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});
require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),15000).unref();
