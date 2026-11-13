const {app,clipboard,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/tables-styles-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const clipboardHtml=async()=>clipboard.readHTML?clipboard.readHTML():await(await (await clipboard.read())[0].getType('text/html')).text();
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 const clickMenu=async label=>{await pause(70);const found=await js(label=>{const b=[...document.querySelectorAll('[role=menu] button,[role=menuitem],[role=menuitemcheckbox]')].find(b=>b.textContent.replace(/^✓/,'').trim()===label);if(!b)return false;b.click();return true;},label);if(!found)throw Error('Missing menu item: '+label);await pause(80);};
 const set=async(text,mode=true)=>{await js((text,mode)=>{addTab({path:null,text,assets:{},meta:{}});if(visual!==mode)switchMode(mode);rich.focus();const r=document.createRange();r.selectNodeContents(rich);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);},text,mode);await pause(50);};
 const focus=async(r,c,end=false)=>js((r,c,end)=>NoteMindTables.focus(rich.querySelector('table').rows[r].children[c],end),r,c,end);
 const key=async(key,modifiers=[])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers});await pause(45);};
 const shape=()=>js(()=>{const table=rich.querySelector('table');return table?[...table.rows].map(row=>[...row.children].map(td=>td.textContent)):null;});
 try{
  await pause(950);
  await set('');await js(()=>$('insertTable').click());await pause(80);
  check(JSON.stringify(await shape())===JSON.stringify([['',''],['','']]),'Table button immediately inserts a 2 by 2 table');
  check(await js(()=>getSelection().anchorNode.closest?.('td,th')===rich.querySelector('td,th')),'Insertion focuses the first entry');
  check(await js(()=>!document.querySelector('.table-controls').hidden&&!document.querySelector('.table-row').hidden&&!document.querySelector('.table-column').hidden),'Row and column handles appear on the active table');
  await js(()=>{const list=[...rich.querySelectorAll('td,th')];['Alpha','Bravo','Charlie','Delta'].forEach((s,i)=>list[i].textContent=s);rich.dispatchEvent(new Event('input'));NoteMindTables.focus(list[3],true);});await key('Tab');
  check((await shape()).length===3,'Tab from final entry adds a row');
  await focus(2,1);await key('Return');check((await shape()).length===4,'Return moves down and adds a row at the bottom');
  await focus(0,0);await key('Tab');check(await js(()=>getSelection().anchorNode.closest('td,th').cellIndex===1),'Tab moves to next column');
  await key('Tab',['shift']);check(await js(()=>getSelection().anchorNode.closest('td,th').cellIndex===0),'Shift Tab moves to previous column');
  await js(()=>document.querySelector('.table-row').click());await clickMenu('Add Row Above');check((await shape()).length===5&&(await shape())[1][0]==='Alpha','Row handle adds above without disturbing existing text');
  await js(()=>document.querySelector('.table-column').click());await clickMenu('Add Column After');check((await shape())[0].length===3,'Column handle adds a column');
  await js(()=>NoteMindHistory.step());check((await shape())[0].length===2,'Column insertion is undoable');await js(()=>NoteMindHistory.step(true));check((await shape())[0].length===3,'Column insertion can be redone');
  await focus(1,0);await js(()=>document.querySelector('.table-row').click());await clickMenu('Move Row Down');check((await shape())[2][0]==='Alpha','Row menu moves the complete row');
  await focus(2,0);await js(()=>document.querySelector('.table-column').click());await clickMenu('Move Column Right');check((await shape())[2][1]==='Alpha','Column menu moves the complete column');
  await js(()=>document.querySelector('.table-column').click());await clickMenu('Copy Column');check((await clipboardHtml()).includes('<table>')&&(await clipboard.readText()).includes('Alpha'),'Copy Column writes portable HTML and text');
  await key('Delete');check((await shape()).every(row=>row[1]===''),'Delete first clears selected column contents');
  await key('Delete');check((await shape())[0].length===2,'Delete on an empty selected column removes it');
  await set('| A | B |\n| --- | --- |\n| C | D |');await focus(0,0);
  await js(()=>{const data=new DataTransfer();data.setData('text/plain','One\tTwo\nThree\tFour\nFive\tSix');rich.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  check(JSON.stringify(await shape())===JSON.stringify([['One','Two'],['Three','Four'],['Five','Six']]),'Pasting tab separated text expands and fills a table');
  await focus(1,0,true);await key('Return',['shift']);await w.webContents.insertText('second line');await pause(50);
  check(await js(()=>currentText().includes('<br>')),'Shift Return adds a persistent line break within an entry');
  await js(()=>{switchMode(false);switchMode(true);});check(await js(()=>rich.querySelector('table').rows[1].children[0].querySelector('br')&&rich.textContent.includes('second line')),'Multiline entry survives Markdown and visual round trip');
  await focus(0,0);await js(()=>$('insertTable').click());await clickMenu('Copy Table');check((await clipboard.readText()).includes('One\tTwo')&&(await clipboardHtml()).includes('second line'),'Table button offers complete table copy');
  await js(()=>$('insertTable').click());await clickMenu('Convert to Text');check(await shape()===null&&await js(()=>rich.textContent.includes('One')&&rich.textContent.includes('Six')),'Convert to Text preserves every row');
  await js(()=>NoteMindHistory.step());check((await shape()).length===3,'Table conversion is undoable');
  await set('# First\n\nSecond');await js(()=>{const r=document.createRange();r.selectNodeContents(rich);getSelection().removeAllRanges();getSelection().addRange(r);});await pause(30);await js(()=>$('insertTable').click());check(JSON.stringify(await shape())===JSON.stringify([['First',''],['Second','']]),'Selected paragraphs convert into rows without formatting controls or extra empty rows');
  await set('');await js(()=>{const data=new DataTransfer();data.setData('text/html','<table><tr><td><b>Bold</b></td><td><img src=x onerror="window.bad=true">Safe</td></tr></table>');rich.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});check(await js(()=>!!rich.querySelector('table strong')&&!rich.querySelector('[onerror]')&&!window.bad),'HTML table paste retains inline formatting and excludes executable attributes');
  await set('Select a style');
  await js(()=>$('heading').click());await clickMenu('Heading 3');check(await js(()=>!!rich.querySelector('h3')&&$('heading').textContent==='Heading 3 ▾'),'Style picker applies Heading 3 and reflects the active style');
  for(const [style,tag]of [['Heading 1','h1'],['Heading 2','h2'],['Heading 4','h4'],['Heading 5','h5'],['Heading 6','h6'],['Body','p'],['Quote','blockquote'],['Body','p'],['Code Block','pre'],['Body','p'],['Bulleted List','ul'],['Numbered List','ol'],['Checklist','li.task-item'],['Body','p']]){
    await js(()=>$('heading').click());await clickMenu(style);check(await js(tag=>!!rich.querySelector(tag),tag),'Visual style picker applies '+style+' ('+tag+')');check(await js(()=>rich.textContent.includes('Select a style')),'Style preserves text: '+style);
  }
  check(await js(()=>!rich.querySelector('ul,ol,blockquote,pre,input')&&rich.textContent.includes('Select a style')),'Returning to Body removes the previous block style without losing text');
  for(const [style,token]of [['Heading 1','# One'],['Heading 2','## One'],['Heading 3','### One'],['Heading 4','#### One'],['Heading 5','##### One'],['Heading 6','###### One'],['Quote','> One'],['Bulleted List','- One'],['Numbered List','1. One'],['Checklist','- [ ] One'],['Code Block','```\nOne'],['Body','One']]){
    await set('One\nTwo',false);await js(()=>source.setSelectionRange(0,source.value.length));await js(()=>$('heading').click());await clickMenu(style);check(await js(token=>source.value.startsWith(token)&&!$('toolbar').hidden,token),'Markdown style picker applies '+style+' with toolbar visible');
  }
  await set('```js\nconst answer = 42;\n```',false);await js(()=>{source.setSelectionRange(15,15);NoteMindStyles.apply('p');});check(await js(()=>source.value==='const answer = 42;'),'Applying Body inside a fenced block removes the whole fence');
  await set('## Keep\n\nParagraph',false);await js(()=>{source.setSelectionRange(9,9);NoteMindStyles.apply('h4');});check(await js(()=>source.value==='## Keep\n\n#### Paragraph'),'Styling one Markdown paragraph preserves adjacent blocks');
  await set('| First | Second |\n| --- | --- |\n| Third | Fourth |');await focus(0,0);await js(()=>NoteMindTables.select('column',0));await js(()=>formatText('bold'));check(await js(()=>[...rich.querySelector('table').rows].every(row=>!!row.children[0].querySelector('b,strong'))),'Inline formatting applies to a selected column');
  await js(()=>NoteMindHistory.step());check(await js(()=>!rich.querySelector('table b,table strong')),'A single Undo reverses formatting across the whole selected column');await js(()=>NoteMindHistory.step(true));await focus(0,0);
  await js(()=>NoteMindTables.clearSelection());await focus(0,0);await js(()=>NoteMindStyles.apply('h1'));check(await js(()=>!rich.querySelector('table h1')),'Table entries retain simple text styles');
  await js(()=>NoteMindTables.move('row',0,1));await js(()=>NoteMindTables.move('column',0,1));check((await shape())[1][1]==='First','Reordering preserves content and inline formatting');
  for(const axis of ['row','column']){
    await focus(1,1);await pause(80);
    const points=await js(axis=>{const h=document.querySelector('.table-'+axis).getBoundingClientRect(),t=rich.querySelector('table'),to=(axis==='row'?t.rows[0]:t.rows[0].children[0]).getBoundingClientRect();return {x:Math.round(h.left+h.width/2),y:Math.round(h.top+h.height/2),toX:Math.round(to.left+to.width/2),toY:Math.round(to.top+to.height/2)};},axis);
    w.webContents.sendInputEvent({type:'mouseDown',x:points.x,y:points.y,button:'left',clickCount:1});await pause(30);
    w.webContents.sendInputEvent({type:'mouseMove',x:axis==='column'?points.toX:points.x,y:axis==='row'?points.toY:points.y,button:'left',modifiers:['leftButtonDown']});await pause(30);
    w.webContents.sendInputEvent({type:'mouseUp',x:axis==='column'?points.toX:points.x,y:axis==='row'?points.toY:points.y,button:'left',clickCount:1});await pause(80);
    check(axis==='row'?(await shape())[0][1]==='First':(await shape())[0][0]==='First','Dragging the '+axis+' handle reorders its complete contents');
  }
  await focus(0,0);await key('Escape');check(await js(()=>!getSelection().anchorNode.closest?.('td,th')&&!getSelection().anchorNode.parentElement?.closest('td,th')),'Escape leaves the table for normal writing');
  await set('```\nPlain code\n```');await js(()=>NoteMindStyles.apply('p'));check(await js(()=>!rich.querySelector('pre,code')&&rich.textContent.includes('Plain code')),'Body removes code typography as well as its block');
  await set('Before\n\nFirst\n\nSecond\n\nAfter');await js(()=>{const p=rich.querySelectorAll('p'),r=document.createRange();r.setStart(p[1].firstChild,0);r.setEnd(p[2].firstChild,6);getSelection().removeAllRanges();getSelection().addRange(r);});await pause(30);await js(()=>NoteMindStyles.apply('h2'));check(await js(()=>rich.querySelectorAll('h2').length===2&&rich.firstElementChild.tagName==='P'&&rich.lastElementChild.tagName==='P'),'Visual style changes all selected paragraphs and preserves surrounding paragraphs');
  await js(()=>NoteMindHistory.step());check(await js(()=>rich.querySelectorAll('p').length===4&&!rich.querySelector('h2')),'A single Undo reverses styling multiple paragraphs');
  await set('First\n\nSecond');await js(()=>{const r=document.createRange();r.selectNodeContents(rich);getSelection().removeAllRanges();getSelection().addRange(r);});await pause(30);await js(()=>NoteMindStyles.apply('pre'));check(await js(()=>rich.querySelector('pre').textContent.includes('First\nSecond')),'Code style preserves line breaks between selected paragraphs');
  await set('- [x] Keep complete\n- [ ] Change this\n- [x] Also complete');await js(()=>{const li=rich.querySelectorAll('li')[1],r=document.createRange();r.selectNodeContents(li);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);});await pause(30);await js(()=>NoteMindStyles.apply('p'));check(await js(()=>rich.querySelectorAll('input[checked]').length===2&&currentText().includes('Change this')),'Styling one task preserves the other tasks and completion states');
  for(const mode of [true,false]){await set('- [x] Complete',mode);await js(()=>NoteMindStyles.apply('task'));check(await js(()=>currentText().includes('[x]')),'Reapplying Checklist preserves completion in '+(mode?'visual':'Markdown')+' mode');}
  await set('- One\n- Two');await js(()=>{const r=document.createRange();r.selectNodeContents(rich);getSelection().removeAllRanges();getSelection().addRange(r);});await pause(30);check(await js(()=>$('heading').dataset.style==='ul'),'Style picker recognizes a fully selected list');await js(()=>NoteMindStyles.apply('p'));check(await js(()=>!rich.querySelector('ul,ol')&&rich.textContent.includes('One')&&rich.textContent.includes('Two')),'Body converts a fully selected list to ordinary text');
  await set('# Packing list\n\n| Item | Quantity |\n| --- | --- |\n| Pens | 2 |\n| Paper | 1 pad |');await focus(1,0);
  const intact=await shape();await js(()=>{const r=document.createRange();r.selectNodeContents(rich);getSelection().removeAllRanges();getSelection().addRange(r);});await pause(30);await js(()=>NoteMindStyles.apply('h1'));check(JSON.stringify(await shape())===JSON.stringify(intact)&&await js(()=>NoteMindStyles.items().every(item=>item.disabled)),'Block styles protect a selection containing a table');await focus(1,0);
  const savedFile=path.join(root,'Tables and styles.wm');dialog.showSaveDialog=async()=>({canceled:false,filePath:savedFile});await js(()=>save());const beforeSave=await shape();
  await js(async file=>{const reopened=await window.notemind.openPath(file);addTab({...reopened,id:crypto.randomUUID()});},savedFile);
  check(JSON.stringify(await shape())===JSON.stringify(beforeSave)&&await js(()=>!!rich.querySelector('h1')),'Saving and reopening a .wm preserves tables and paragraph styles');await focus(1,0);
  await js(()=>NoteMindNotes.flush());await pause(90);fs.writeFileSync(path.join(root,'tables.png'),(await w.webContents.capturePage()).toPNG());
  await js(()=>{NoteMindTables.clearSelection();rich.focus();const r=document.createRange();r.selectNodeContents(rich.lastElementChild);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);$('heading').click();});await pause(100);fs.writeFileSync(path.join(root,'styles.png'),(await w.webContents.capturePage()).toPNG());
  check(await js(()=>!$('toolbar').hidden),'Formatting bar remains visible after table and style edits');report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.state=await js(()=>({html:rich.innerHTML,text:currentText(),selection:getSelection()?.anchorNode?.parentElement?.outerHTML?.slice(0,2000),menu:document.querySelector('[role=menu]')?.textContent})).catch(()=>null);}
 fs.writeFileSync('test-results/tables-styles.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),60000).unref();
