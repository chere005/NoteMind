const {app,dialog,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/pdf-export-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const setField=(key,value)=>js((key,value)=>{const f=document.querySelector('.pdf-dialog [data-k='+key+']');if(f.type==='checkbox')f.checked=value;else f.value=value;f.dispatchEvent(new Event('change'));},key,value);
 const box=()=>js(()=>{const f=document.querySelector('.pdf-frame'),i=document.querySelector('.pdf-sheet iframe');return {w:parseFloat(f.style.width),h:parseFloat(f.style.height),left:parseFloat(i.style.left),folio:document.querySelector('.pdf-folio').textContent};});
 const mediaBox=file=>{const text=fs.readFileSync(file).toString('latin1');const m=text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);return m?[Math.round(Number(m[1])),Math.round(Number(m[2]))]:null;};
 try{
  await pause(1000);
  const item=Menu.getApplicationMenu().items.find(i=>i.label==='File').submenu.items.find(i=>i.label==='Export').submenu.items.find(i=>i.label==='Export as PDF…');
  check(item&&item.accelerator==='CmdOrCtrl+Shift+E','File has Export as PDF… on Ctrl+Shift+E');
  const image=fs.readFileSync('test/fixtures/ocr-english.png').toString('base64');
  await js(image=>{addTab({path:null,text:'# Quarterly notes\n\n![Photo](assets/photo.png)\n\n'+Array.from({length:60},(_,i)=>'Line '+i+' of the report.').join('\n\n'),assets:{'assets/photo.png':image},meta:{}});},image);await pause(200);
  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'exportPDF'})));await pause(900);
  check(await js(()=>!!document.querySelector('.pdf-dialog')&&document.querySelectorAll('.pdf-dialog [data-k]').length===6),'The dialog offers paper, orientation, margins, page numbers, picture backgrounds and open after export');
  check(await js(()=>document.querySelector('.pdf-sheet iframe').srcdoc.includes('Quarterly notes')),'The preview shows the Notepad');
  const originalPreview=await js(()=>document.querySelector('.pdf-sheet iframe').srcdoc);await setField('clean',true);for(let i=0;i<60;i++){if(await js(()=>document.querySelector('.pdf-note').textContent.startsWith('First page')))break;await pause(100);}
  check(await js(original=>{const html=document.querySelector('.pdf-sheet iframe').srcdoc;return html!==original&&html.includes('data:image/png;base64,');},originalPreview),'The background-removal option updates the picture in the preview');
  await setField('clean',false);await pause(300);check(await js(original=>document.querySelector('.pdf-sheet iframe').srcdoc===original,originalPreview),'Turning background removal off restores the original preview');
  await setField('pageSize','Letter');await pause(400);const letter=await box();
  await setField('pageSize','A4');await pause(400);const a4=await box();
  check(Math.abs(letter.w/letter.h-8.5/11)<0.01&&Math.abs(a4.w/a4.h-8.27/11.69)<0.01,'The preview sheet takes the shape of the chosen paper');
  await setField('orientation','landscape');await pause(400);check((await box()).w>(await box()).h,'Landscape turns the sheet');
  await setField('orientation','portrait');await setField('margin','none');await pause(400);check((await box()).left===0,'No margin puts the text at the edge');
  await setField('margin','normal');await setField('pageNumbers',true);await pause(600);check(/^1 \/ \d+$/.test((await box()).folio),'Page numbers show 1 / N');
  check(await js(()=>JSON.parse(localStorage.getItem('notemind.pdfExport')).pageNumbers===true),'The options are remembered');

  const file=path.join(root,'out.pdf');dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
  await setField('pageSize','Letter');await setField('pageNumbers',false);
  await js(()=>document.querySelector('.pdf-dialog [data-go]').click());await pause(4000);
  check(fs.existsSync(file)&&fs.readFileSync(file).subarray(0,4).toString()==='%PDF','Export writes a PDF');
  check(JSON.stringify(mediaBox(file))==='[612,792]','The PDF is Letter portrait');
  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'exportPDF'})));await pause(700);
  await setField('orientation','landscape');await setField('pageSize','Letter');await setField('pageNumbers',true);await setField('margin','narrow');
  const second=path.join(root,'landscape.pdf');dialog.showSaveDialog=async()=>({canceled:false,filePath:second});
  await js(()=>document.querySelector('.pdf-dialog [data-go]').click());await pause(4000);
  check(JSON.stringify(mediaBox(second))==='[792,612]','Landscape and page numbers produce a Letter landscape PDF');
  fs.writeFileSync(path.join(root,'pdf.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>document.querySelector('.pdf-dialog')?.innerText||document.getElementById('status').textContent).catch(()=>null);}
 fs.writeFileSync('test-results/pdf-export.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),90000).unref();
