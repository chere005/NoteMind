const {app,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/find-replace-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const edit=Menu.getApplicationMenu().items.find(i=>i.label==='Edit').submenu.items;
 const choose=async label=>{edit.find(i=>i.label===label).click();await pause(120);};
 const set=async(text,visualMode)=>{await js((text,visualMode)=>{addTab({path:null,text,assets:{},meta:{}});if(visual!==visualMode)switchMode(visualMode);(visualMode?rich:source).focus();},text,visualMode);await pause(60);};
 const query=async(value,{matchCase=false,wholeWord=false}={})=>js((value,matchCase,wholeWord)=>{const bar=document.querySelector('.note-find');const press=(name,on)=>{const b=bar.querySelector('[data-'+name+']');if((b.getAttribute('aria-pressed')==='true')!==on)b.click();};press('case',matchCase);press('word',wholeWord);const input=bar.querySelector('input');input.value=value;input.dispatchEvent(new Event('input'));return window.NoteMindFind.matches;},value,matchCase,wholeWord);
 const fill=value=>js(value=>{document.querySelector('.note-find .find-replace input').value=value;},value);
 const click=name=>js(name=>document.querySelector('.note-find [data-'+name+']').click(),name);
 try{
  await pause(1000);
  const labels=edit.map(i=>i.label),accelerator=label=>edit.find(i=>i.label===label)?.accelerator;
  check(['Find and Replace…','Find Next','Find Previous','Use Selection for Find'].every(l=>labels.includes(l))&&accelerator('Find Next')==='F3'&&accelerator('Find Previous')==='Shift+F3','Edit menu offers Find and Replace, Find Next (F3), Find Previous and Use Selection for Find');

  await set('Cat cat concatenate CAT.',true);
  const before=await js(()=>rich.getBoundingClientRect().top);
  await choose('Find and Replace…');
  check(await js(()=>!document.querySelector('.note-find').hidden&&!document.querySelector('.note-find .find-replace').hidden&&getComputedStyle(document.querySelector('.note-find')).position==='absolute'),'Find and Replace opens a floating card with the replace row');
  check(await js(b=>Math.abs(rich.getBoundingClientRect().top-b)<1,before),'The card does not move the note');
  check(await query('cat')===4,'Find ignores case and finds a word inside another');
  check(await query('cat',{wholeWord:true})===3,'Whole word skips concatenate');
  check(await query('cat',{matchCase:true})===2,'Match case skips Cat and CAT');
  check(await js(()=>document.querySelector('.note-find [role=status]').textContent==='1 of 2'),'The card says which match is current');
  await choose('Find Next');check(await js(()=>document.querySelector('.note-find [role=status]').textContent==='2 of 2'),'Find Next moves to the next match');
  await choose('Find Previous');check(await js(()=>document.querySelector('.note-find [role=status]').textContent==='1 of 2'),'Find Previous moves back');

  await query('cat',{wholeWord:true});await fill('dog');await click('replace');
  check(await js(()=>currentText().startsWith('dog cat concatenate CAT')||currentText().startsWith('Cat dog concatenate CAT')),'Replace changes one match and moves on');
  await click('all');
  check(await js(()=>/^dog dog concatenate dog\./.test(currentText().trim())),'Replace All changes every whole-word match');
  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'undoText'})));await pause(100);
  check(await js(()=>/^(Cat dog|dog cat) concatenate CAT\./.test(currentText().trim())),'Replace All is undone in one step');

  await set('one two one\nthree one',false);
  check(await query('one')===3,'Find works in Markdown mode');
  await fill('1');await click('all');
  check(await js(()=>source.value==='1 two 1\nthree 1'),'Replace All works in Markdown mode');
  await js(()=>window.dispatchEvent(new CustomEvent('notemind-command',{detail:'undoText'})));await pause(100);
  check(await js(()=>source.value==='one two one\nthree one'),'Replace All is one Undo step in Markdown mode');
  await js(()=>{source.focus();source.setSelectionRange(4,7);});await choose('Use Selection for Find');
  check(await js(()=>document.querySelector('.note-find input').value==='two'),'Use Selection for Find fills the query');
  await js(()=>document.querySelector('.note-find input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  check(await js(()=>document.querySelector('.note-find').hidden),'Escape closes the card');
  fs.writeFileSync(path.join(root,'find.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>({text:currentText(),bar:document.querySelector('.note-find')?.innerText})).catch(()=>null);}
 fs.writeFileSync('test-results/find-replace.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
