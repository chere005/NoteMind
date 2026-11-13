const {app,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/structure-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
const doc='# A\n\ntext a\n\n## A1\n\nsub\n\n# B\n\ntext b';
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const format=Menu.getApplicationMenu().items.find(i=>i.label==='Format').submenu.items;
 const choose=async label=>{format.find(i=>i.label===label).click();await pause(150);};
 const heads=()=>js(()=>currentText().split('\n').filter(l=>/^#+ /.test(l)).join('|'));
 const caretIn=word=>js(word=>{const walker=document.createTreeWalker(rich,NodeFilter.SHOW_TEXT);let n;while((n=walker.nextNode()))if(n.data.includes(word)){const r=document.createRange();r.setStart(n,1);r.collapse(true);rich.focus();getSelection().removeAllRanges();getSelection().addRange(r);return true;}return false;},word);
 const set=async(text,visualMode)=>{await js((text,visualMode)=>{addTab({path:null,text,assets:{},meta:{}});if(visual!==visualMode)switchMode(visualMode);(visualMode?rich:source).focus();},text,visualMode);await pause(120);};
 const key=(target,k)=>js((target,k)=>{const el=target==='rich'?rich:source;const e=new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;},target,k);
 try{
  await pause(1000);
  const accelerators=Object.fromEntries(format.filter(i=>i.accelerator).map(i=>[i.label,i.accelerator]));
  check(accelerators['Move Section Up']&&accelerators['Move Section Down']&&accelerators['Collapse All Headings']==='CmdOrCtrl+Alt+Shift+Left'&&accelerators['Expand All Headings']==='CmdOrCtrl+Alt+Shift+Right'&&accelerators['Collapse Subsections']==='CmdOrCtrl+;','The Format menu has the section and fold shortcuts');
  const plan=await js(()=>{const p=window.NoteMindStructure.plan;return [p([1,0,2,0,1,0],1,1),p([1,0,2,0,1,0],4,-1),p([1,0,2,0,1,0],2,-1),p([1,0,2,0,1,0],0,-1),p([0,0],1,1)];});
  check(JSON.stringify(plan)==='[{"start":0,"end":4,"target":6},{"start":4,"end":6,"target":0},null,null,null]','Section planning keeps a heading with everything under it and stops at its parent');

  await set(doc,true);await caretIn('text a');await choose('Move Section Down');
  check(await heads()==='# B|# A|## A1','Move Section Down takes a heading and its subsection below the next one (page)');
  await caretIn('text b');await choose('Move Section Up');
  check(await heads()==='# A|## A1|# B'||await heads()==='# B|# A|## A1','Move Section Up works on the page');
  await set(doc,true);await caretIn('sub');await choose('Move Section Up');
  check(await heads()==='# A|## A1|# B','A subsection cannot leave its parent');

  await set(doc,false);await js(()=>{source.setSelectionRange(8,8);});await choose('Move Section Down');
  check(await js(()=>source.value.split('\n').filter(l=>/^#+ /.test(l)).join('|'))==='# B|# A|## A1','Move Section Down works in the Markdown pane');
  await js(()=>{const at=source.value.indexOf('text a');source.setSelectionRange(at,at);});await choose('Move Section Up');
  check(await js(()=>source.value===('# A\n\ntext a\n\n## A1\n\nsub\n\n# B\n\ntext b')),'Move Section Up puts it back');
  await set('```\n# not a heading\n```\n\n# Real\n\ntext',false);await js(()=>source.setSelectionRange(2,2));await choose('Move Section Down');
  check(await js(()=>source.value.startsWith('```\n# not a heading\n```')),'A hash line inside a code fence is not a section');

  await set(doc,true);await choose('Collapse All Headings');
  check(await js(()=>(doc.meta.collapsed||[]).length===3&&rich.querySelectorAll('.heading-folded').length>0),'Collapse All Headings folds every section');
  await caretIn('text a').catch(()=>{});await choose('Expand All Headings');
  check(await js(()=>(doc.meta.collapsed||[]).length===0&&rich.querySelectorAll('.heading-folded').length===0),'Expand All Headings opens them again');
  await set(doc,true);await caretIn('A');await js(()=>{const r=document.createRange();r.selectNodeContents(rich.querySelector('h1'));r.collapse(true);rich.focus();getSelection().removeAllRanges();getSelection().addRange(r);});await choose('Collapse Subsections');
  check(await js(()=>(doc.meta.collapsed||[]).length===1&&rich.querySelectorAll('.heading-folded').length>0),'Collapse Subsections folds only what is below the heading');
  await set(doc,true);await js(()=>{[...rich.querySelectorAll('h1')].find(h=>h.textContent.startsWith('B')).querySelector('.heading-toggle').click();});await pause(100);
  await caretIn('text a');await choose('Move Section Down');
  check(await js(()=>{const b=[...rich.querySelectorAll('h1')].find(h=>h.textContent.startsWith('B'));return b.querySelector('.heading-toggle').getAttribute('aria-expanded')==='false';}),'A closed heading stays closed after it moves (fold keys no longer depend on position)');

  await set('> quoted',false);await js(()=>source.setSelectionRange(source.value.length,source.value.length));
  check(await key('source','Enter')&&await js(()=>source.value==='> quoted\n> '),'Return continues a quote in the Markdown pane');
  check(await key('source','Enter')&&await js(()=>source.value==='> quoted\n'),'Return on an empty quote line ends it');
  await set('        x',false);await js(()=>source.setSelectionRange(8,8));await key('source','Backspace');
  check(await js(()=>source.value==='    x'),'Backspace in indentation takes one level');
  await set('```js\n\n```',false);await js(()=>source.setSelectionRange(6,6));await key('source','(');
  check(await js(()=>source.value==='```js\n()\n```'&&source.selectionStart===7),'Typing ( in a code fence closes it');
  await key('source',')');check(await js(()=>source.value==='```js\n()\n```'&&source.selectionStart===8),'Typing the closer steps over it');
  await js(()=>source.setSelectionRange(7,7));await key('source','Backspace');check(await js(()=>source.value==='```js\n\n```'),'Backspace between a pair removes both');
  await set('( outside',false);await js(()=>source.setSelectionRange(0,0));await key('source','(');check(await js(()=>source.value==='( outside'),'Outside a code block nothing is paired');
  await set('```js\nx\n```',true);
  await js(()=>{const pre=rich.querySelector('pre');const text=pre.firstChild.firstChild||pre.firstChild;const r=document.createRange();r.setStart(text,text.data?text.data.length:0);r.collapse(true);rich.focus();getSelection().removeAllRanges();getSelection().addRange(r);});
  await key('rich','[');
  check(await js(()=>rich.querySelector('pre').textContent.includes('[]')),'Pairing also works inside a code block on the page');
  fs.writeFileSync(path.join(root,'structure.png'),(await w.webContents.capturePage()).toPNG());
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>({text:currentText(),source:source.value,meta:doc.meta})).catch(()=>null);}
 fs.writeFileSync('test-results/structure.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
