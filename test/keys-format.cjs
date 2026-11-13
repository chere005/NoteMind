const {app,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/keys-format-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const submenu=label=>Menu.getApplicationMenu().items.find(item=>item.label===label)?.submenu.items||[];
 const chooseFormat=async label=>{const item=submenu('Format').find(i=>i.label===label);if(!item)throw Error('Missing Format item: '+label);item.click();await pause(90);};
 const set=async(text,visualMode)=>{await js((text,visualMode)=>{addTab({path:null,text,assets:{},meta:{}});if(visual!==visualMode)switchMode(visualMode);(visualMode?rich:source).focus();if(visualMode){const r=document.createRange();r.selectNodeContents(rich);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);}else source.setSelectionRange(0,0);},text,visualMode);await pause(60);};
 const selectWord=word=>js(word=>{const walker=document.createTreeWalker(rich,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const at=node.data.indexOf(word);if(at>=0){const r=document.createRange();r.setStart(node,at);r.setEnd(node,at+word.length);getSelection().removeAllRanges();getSelection().addRange(r);return true;}}return false;},word);
 const selectSource=(from,to)=>js((from,to)=>{source.focus();source.setSelectionRange(from,to);},from,to);
 try{
  await pause(950);
  const accelerators=Object.fromEntries(submenu('Format').filter(i=>i.accelerator).map(i=>[i.label,i.accelerator]));
  check(accelerators.Bold==='CmdOrCtrl+B'&&accelerators.Italic==='CmdOrCtrl+I'&&accelerators.Underline==='CmdOrCtrl+U'&&accelerators.Strikethrough==='CmdOrCtrl+Shift+X','Format menu carries Bold, Italic, Underline and Strikethrough shortcuts');
  check([1,2,3,4,5,6].every(n=>accelerators['Heading '+n]==='CmdOrCtrl+'+n)&&accelerators.Body==='CmdOrCtrl+7'&&accelerators['Code Block']==='CmdOrCtrl+8','Ctrl+1 to 6 are headings, Ctrl+7 body, Ctrl+8 code block');
  const every=Menu.getApplicationMenu().items.flatMap(top=>top.submenu?.items||[]).filter(i=>i.accelerator).map(i=>i.accelerator);
  check(new Set(every).size===every.length,'No two menu items share a shortcut');
  check(submenu('Tools').find(i=>i.label==='Run Python').accelerator==='F5','Run Python moved to F5 so Ctrl+B is Bold');

  await set('hello world today',true);
  await selectWord('world');await chooseFormat('Bold');
  check(await js(()=>/<(b|strong)>world<\/(b|strong)>/.test(rich.innerHTML)),'Bold wraps the visual selection');
  check(await js(()=>currentText().includes('**world**')),'Bold is written as Markdown');
  await selectWord('today');await chooseFormat('Underline');
  check(await js(()=>/<u>today<\/u>/.test(rich.innerHTML)&&currentText().includes('<u>today</u>')),'Underline is kept in visual mode and in Markdown');
  await selectWord('hello');await chooseFormat('Strikethrough');
  check(await js(()=>currentText().includes('~~hello~~')),'Strikethrough is written as ~~ in Markdown');
  await selectWord('hello');await chooseFormat('Inline Code');
  check(await js(()=>!!rich.querySelector('code')&&currentText().includes('`')),'Inline Code wraps the visual selection');
  await js(()=>{switchMode(false);switchMode(true);});
  check(await js(()=>!!rich.querySelector('u')&&!!rich.querySelector('s,del,strike')&&!!rich.querySelector('code')&&!!rich.querySelector('b,strong')),'Underline, strikethrough, code and bold survive a Markdown round trip');

  await set('plain line',true);
  for(const [label,expect] of [['Heading 1','# plain line'],['Heading 4','#### plain line'],['Quote','> plain line'],['Bulleted List','-   plain line']]){
   await chooseFormat(label);check(await js(expect=>currentText().trim().startsWith(expect),expect),label+' restyles the paragraph');
   await chooseFormat('Body');check(await js(()=>currentText().trim()==='plain line'),'Body after '+label+' returns plain text');
  }
  await chooseFormat('Code Block');check(await js(()=>!!rich.querySelector('pre')&&currentText().includes('```')),'Code Block fences the paragraph');

  await set('alpha beta gamma',false);
  await selectSource(6,10);await chooseFormat('Bold');check(await js(()=>source.value==='alpha **beta** gamma'),'Bold wraps the Markdown selection');
  await selectSource(0,5);await chooseFormat('Underline');check(await js(()=>source.value.startsWith('<u>alpha</u>')),'Underline writes <u> in Markdown mode');
  await selectSource(0,0);await chooseFormat('Heading 3');check(await js(()=>source.value.startsWith('### ')),'Heading 3 prefixes the Markdown line');
  await chooseFormat('Heading 1');check(await js(()=>source.value.startsWith('# ')&&!source.value.startsWith('# #')),'Changing heading level replaces the old marker');
  await chooseFormat('Body');check(await js(()=>!/^#/.test(source.value)),'Body removes the heading marker');

  await js(()=>$('toolbar').querySelectorAll('[data-format]').length);
  check(await js(()=>['fmtUnderline','fmtStrike','fmtCode'].every(id=>!!$('toolbar').querySelector('[data-format='+id+']'))),'Toolbar shows Underline, Strikethrough and Inline Code buttons');
  fs.writeFileSync(path.join(root,'format.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>({html:rich.innerHTML,source:source.value,text:currentText()})).catch(()=>null);}
 fs.writeFileSync('test-results/keys-format.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
