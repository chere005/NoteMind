const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/welcome-tour-'+Date.now());fs.mkdirSync(root,{recursive:true});process.env.NOTEMIND_DATA=root;app.setPath('documents',root);process.argv.push('--tour');app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const sourceRoot=process.env.NOTEMIND_TEST_APP||path.resolve('src'),{NotesStore}=require(path.join(sourceRoot,'notes-store.cjs')),store=new NotesStore(path.join(root,'notes-library'),path.join(root,'note-recovery'));
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{if(tested)return;tested=true;w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{const js=code=>w.webContents.executeJavaScript(code),check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};try{
 for(let i=0;i<150&&!await js("window.NoteMindNotes?.ready&&doc.title==='Welcome to NoteMind'");i++)await pause(100);
 check(await js("doc.title==='Welcome to NoteMind'&&visual"),'Tour launch opens the rendered feature guide after recovery');
 check(await js("tabs.some(t=>t.doc.id==='retained-draft'&&t.doc.text==='Keep my unfinished writing'&&t.dirty)"),'Recovered dirty draft survives opening the guide');
 check(fs.existsSync(path.join(root,'NoteMind','Welcome to NoteMind.nm')),'Tour creates the visible native guide');
 await js('NoteMindNotes.flush()');check((await store.recover()).tabs.some(t=>t.id==='retained-draft'&&t.text==='Keep my unfinished writing'),'The preserved draft remains in recovery after saving the session');report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}fs.writeFileSync('test-results/welcome-tour.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);});});
(async()=>{await store.draft({id:'retained-draft',text:'Keep my unfinished writing',assets:{},dirty:true});await store.session({tabs:[{id:'retained-draft',path:null,visual:true}],active:'retained-draft'});require(path.join(sourceRoot,'main.cjs'));})().catch(error=>{console.error(error);app.exit(1)});setTimeout(()=>app.exit(1),30000).unref();
