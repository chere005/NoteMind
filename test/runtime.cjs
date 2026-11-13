const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const profile=path.resolve(__dirname,'../test-results/profile-'+Date.now());fs.mkdirSync(profile,{recursive:true});process.env.NOTEMIND_DATA=profile;
app.disableHardwareAcceleration();app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
let report={profile,checks:[]},tested=false;const errors=[];
function check(value,label){if(!value)throw Error(label);report.checks.push(label);}
app.on('browser-window-created',(_,win)=>{win.webContents.on('console-message',(_e,details)=>{if(details?.level==='error')errors.push(details.message)});win.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;try{
 const js=code=>win.webContents.executeJavaScript(code);await new Promise(r=>setTimeout(r,2000));
 check(await js("!!document.querySelector('[data-tablet=surface]')"),'tablet mounts');
 check(await js("!!document.querySelector('#sidebarTree') && !!document.querySelector('#documentTabs')"),'shell mounts');
 await js("window.dispatchEvent(new CustomEvent('notemind-command',{detail:'quickReference'}))");await new Promise(r=>setTimeout(r,900));check(await js("tabs.some(t=>t.doc.path&&/Quick Reference\\.nm$/.test(t.doc.path))"),'quick reference opens');await js("closeTab(activeTab)");
 await js("window.dispatchEvent(new CustomEvent('tablet-edit-image',{detail:{url:'data:image/svg+xml;base64,'+btoa('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"><rect width=\"100\" height=\"100\" fill=\"red\"/></svg>')}}))");await new Promise(r=>setTimeout(r,200));
 check(await js("Array.from(document.querySelectorAll('.sheet-tab button')).some(b=>b.textContent==='Image')"),'image edit creates sheet');
 await js(`(()=>{const el=document.querySelector('[data-tablet=surface]'),r=el.getBoundingClientRect();for(const [type,x,buttons] of [['pointerdown',.25,1],['pointermove',.5,1],['pointerup',.6,0]])el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'pen',pointerId:4242,clientX:r.left+r.width*x,clientY:r.top+r.height*.4,pressure:buttons?.7:0,buttons,button:0}));})()`);
 await new Promise(r=>setTimeout(r,700));check(JSON.parse(fs.readFileSync(path.join(profile,'sheets.json'),'utf8')).some(s=>s.backdrop&&s.strokes.length),'annotated image persists');
 await js("window.dispatchEvent(new CustomEvent('notemind-command',{detail:'source:camera'}))");await new Promise(r=>setTimeout(r,2000));check(await js("document.querySelector('video').videoWidth > 0"),'camera starts');
 const image=await win.webContents.capturePage();fs.writeFileSync(path.join(profile,'screen.png'),image.toPNG());
 await js("window.dispatchEvent(new CustomEvent('notemind-command',{detail:'source:tablet'}))");
 const {dialog}=require('electron');const paneFile=path.join(profile,'drawing.wm');dialog.showSaveDialog=async()=>({canceled:false,filePath:paneFile});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[paneFile]});
 await js(`window.notemind.savePane({name:'Test',aspect:1.6,strokes:[]},btoa('<svg xmlns="http://www.w3.org/2000/svg"/>'))`);const opened=await js('window.notemind.openPane()');check(opened.sheet.name==='Test','pane Notepad round trip');
 report.errors=errors;check(errors.length===0,'no renderer errors');report.ok=true;
 fs.writeFileSync(path.join(__dirname,'../test-results/latest.json'),JSON.stringify(report,null,2));win.close();
 }catch(error){report.ok=false;report.error=error.stack;report.errors=errors;fs.writeFileSync(path.join(__dirname,'../test-results/latest.json'),JSON.stringify(report,null,2));win.destroy();process.exitCode=1;}})});
require('../src/main.cjs');setTimeout(()=>{if(!report.ok){fs.writeFileSync(path.join(__dirname,'../test-results/latest.json'),JSON.stringify({...report,error:report.error||'timeout'},null,2));app.exit(1)}},20000).unref();
