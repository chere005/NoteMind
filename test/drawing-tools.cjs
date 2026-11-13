const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/drawing-tools-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report={root,checks:[]};let started=false;
app.on('browser-window-created',(_,w)=>{if(started)return;started=true;w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s),check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name)},click=s=>js(`document.querySelector(${JSON.stringify(s)}).click()`),sheets=()=>JSON.parse(fs.readFileSync(path.join(root,'sheets.json')));
 const pointer=async(type,x,y,pen=false,cancel=false)=>{await js(`(()=>{const s=document.querySelector('[data-tablet=surface]'),r=s.getBoundingClientRect();s.dispatchEvent(new PointerEvent('${cancel?'pointercancel':type}',{bubbles:true,pointerId:4242,pointerType:'${pen?'pen':'mouse'}',button:0,buttons:${type==='pointerup'?0:1},pressure:${type==='pointerup'?0:.7},clientX:r.left+r.width*${x},clientY:r.top+r.height*${y}}))})()`);await pause(40)};
 const drag=async(a,b,pen=false)=>{await pointer('pointerdown',...a,pen);await pointer('pointermove',...b,pen);await pointer('pointerup',...b,pen);await pause(650)};
 const command=async id=>{await js(`window.dispatchEvent(new CustomEvent('notemind-command',{detail:${JSON.stringify(id)}}))`);await pause(650)};
 try{
  await pause(1200);
  check(await js(`document.querySelectorAll('#pen-control .pen-swatch').length===7 && !!document.querySelector('#pen-control select[aria-label="Pen width"]')`),'colours and width selector are directly on the drawing bar');
  check(await js(`!document.querySelector('[data-bar=pen-menu]')&&!document.querySelector('[data-docked-toggle]')&&!!document.querySelector('[data-tablet=orientation-menu]')`),'drawing controls omit redundant menus and retain tablet orientation');
  check(await js(`document.getElementById('modeLabel').hidden&&getComputedStyle(document.getElementById('rich')).maxWidth==='none'&&parseFloat(getComputedStyle(document.querySelector('.editor-wrap')).paddingLeft)<=16`),'editor uses its pane width without the mode label');
  await click('[data-tablet=orientation-menu]');await click('[data-bar=orientation-1]');await pause(200);check(await js(`localStorage.getItem('notemind.orientation')==='1'&&document.querySelector('[data-tablet=surface]').getBoundingClientRect().height>document.querySelector('[data-tablet=surface]').getBoundingClientRect().width`),'orientation is directly accessible and turns a sheet to portrait');await click('[data-tablet=orientation-menu]');await click('[data-bar=orientation-0]');await pause(200);
  await click('[data-bar=pen]');await drag([.2,.2],[.3,.3]);await drag([.7,.7],[.8,.8],true);
  check(sheets()[0].strokes.length===2,'both mouse and pen draw strokes in Pen mode');
  await click('[data-bar=select]');await drag([.1,.1],[.4,.4]);await drag([.25,.25],[.4,.25]);
  check(Math.abs(sheets()[0].strokes[0].points[0].x-.35)<.01&&Math.abs(sheets()[0].strokes[1].points[0].x-.7)<.01,'dragging a selection moves its ink and leaves other ink alone');
  await command('pen:undo');check(Math.abs(sheets()[0].strokes[0].points[0].x-.2)<.01,'one Undo restores the entire selection move');
  await command('pen:redo');check(Math.abs(sheets()[0].strokes[0].points[0].x-.35)<.01,'Redo restores the moved ink');
  await pointer('pointerdown',.4,.25);await pointer('pointermove',.5,.25);await pointer('pointercancel',.5,.25,false,true);await pause(650);check(Math.abs(sheets()[0].strokes[0].points[0].x-.35)<.01,'cancelling a selection move preserves its original ink');
  await click('[data-tablet=clear]');await pause(650);check(sheets()[0].strokes.length===0,'Clear Sheet is a direct toolbar action');await command('pen:undo');check(sheets()[0].strokes.length===2,'clearing a sheet is undoable');
  await command('pen:clearSelection');await click('[data-capture=ink]');await pause(250);
  check(await js(`document.querySelectorAll('#rich .graphics-pane').length===1&&Object.keys(doc.assets).some(n=>n.endsWith('.json'))`),'bringing in creates a docked graphics pane with editable ink');
  check(await js(`NoteMindGraphics.decode(decodeURIComponent(escape(atob(doc.assets[document.querySelector('#rich img[data-asset]').dataset.asset+'.json'])))).strokes.length===2`),'the stored graphics pane retains both strokes');
  await js(`(()=>{const name=document.querySelector('#rich img[data-asset]').dataset.asset+'.json',sheet=NoteMindGraphics.decode(decodeURIComponent(escape(atob(doc.assets[name]))));sheet.aspect=.75;doc.assets[name]=btoa(unescape(encodeURIComponent(NoteMindGraphics.encode(sheet))))})()`);
  await click('[data-edit-graphics]');await pause(650);check(sheets().length===2&&sheets()[1].strokes.length===2&&sheets()[1].aspect===.75,'Edit in Wacom restores the editable stroke data and preserves its aspect ratio');
  await click('[data-bar=pen]');await drag([.45,.6],[.55,.6]);
  check(await js(`document.querySelector('[data-tablet=pane-save]').getAttribute('aria-label')==='Save to Original'`),'editing an embedded pane makes the primary Save action update its original');await click('[data-tablet=pane-save]');await pause(300);
  check(await js(`document.querySelectorAll('#rich .graphics-pane').length===1&&NoteMindGraphics.decode(decodeURIComponent(escape(atob(doc.assets[document.querySelector('#rich img[data-asset]').dataset.asset+'.json'])))).strokes.length===3`),'Save to Original updates the same pane and its editable strokes');
  await js(`document.querySelector('#rich').focus()`);await command('undoText');
  check(await js(`NoteMindGraphics.decode(decodeURIComponent(escape(atob(doc.assets[document.querySelector('#rich img[data-asset]').dataset.asset+'.json'])))).strokes.length===2`),'a Notepad Undo restores the original pane and sidecar together');
  fs.writeFileSync(path.join(root,'drawing-tools.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.console=await js(`({errors:document.getElementById('status').textContent,sheets:[...document.querySelectorAll('.sheet-tab .name')].map(n=>n.textContent)})`).catch(()=>null);}
 fs.writeFileSync('test-results/drawing-tools.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
})});
require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),45000).unref();
