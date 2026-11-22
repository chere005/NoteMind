// Copy Notepads to iCloud Drive, end to end in the app: the File menu setting, a save that is copied once saving settles,
// an unsaved Notepad copied into Drafts, and turning the setting on catching up on Notepads already there. A scratch folder stands in for iCloud Drive
// (NOTEMIND_ICLOUD_DIR); nothing reaches the real one. Run: npx electron test/icloud-copy.cjs
const {app,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/icloud-copy-'+Date.now()),home=path.join(root,'home'),cloud=path.join(root,'iCloud Drive'),target=path.join(cloud,'NoteMind'),data=path.join(root,'data');
for(const dir of [home,cloud,data])fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(data,'icloud-copy.json'),JSON.stringify({enabled:true}));
process.env.NOTEMIND_DATA=data;process.env.NOTEMIND_HOME=home;process.env.NOTEMIND_ICLOUD_DIR=target;
app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const notepad=require(path.resolve('src/notepad-format.cjs'));
fs.writeFileSync(path.join(home,'Existing.nm'),notepad.encode({text:'# Existing\n',assets:{},meta:{}}));
const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
const waitFor=async(test,ms)=>{const end=Date.now()+ms;while(Date.now()<end){if(test())return true;await pause(200);}return false;};
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 try{
  await pause(1000);
  const item=()=>Menu.getApplicationMenu().items.find(i=>i.label==='File').submenu.items.find(i=>i.label==='Copy Notepads to iCloud Drive');
  check(item()&&item().visible&&item().type==='checkbox'&&item().checked,'File > Copy Notepads to iCloud Drive is a checked setting when iCloud Drive is there');
  const file=path.join(home,'Plans','Week.nm');fs.mkdirSync(path.dirname(file),{recursive:true});
  const saved=await js(f=>window.notemind.save({text:'# Week\n\nThe plan.\n',assets:{},meta:{},title:'Week',path:f},false).then(d=>d.path),file);
  check(saved===file&&fs.existsSync(file),'The Notepad saves where it was asked to');
  check(!fs.existsSync(path.join(target,'Plans','Week.nm')),'The copy waits for saving to settle');
  check(await waitFor(()=>fs.existsSync(path.join(target,'Plans','Week.nm')),15000),'Then it is copied, in the same folder');
  check(notepad.decode(fs.readFileSync(path.join(target,'Plans','Week.nm'))).text.includes('The plan.'),'The copy is the saved Notepad');
  check(fs.existsSync(file),'The original stays where it is');
  const drafted=await js(()=>window.notemind.notes.draft({text:'# Old Cooking Notes\n\nflour\n',title:'Old Cooking Notes',meta:{},assets:{}}).then(d=>d.id));
  check(typeof drafted==='string','An unsaved Notepad is kept in the library');
  check(await waitFor(()=>fs.existsSync(path.join(target,'Drafts','Old Cooking Notes.nm')),15000),'It is copied by title into Drafts once it settles');
  check(notepad.decode(fs.readFileSync(path.join(target,'Drafts','Old Cooking Notes.nm'))).text.includes('flour'),'The copy is the unsaved Notepad');
  item().click();await pause(300);
  check(item().checked===false&&JSON.parse(fs.readFileSync(path.join(data,'icloud-copy.json'),'utf8')).enabled===false,'Unticking turns it off and is remembered');
  fs.rmSync(target,{recursive:true,force:true});
  item().click();
  check(await waitFor(()=>fs.existsSync(path.join(target,'Existing.nm'))&&fs.existsSync(path.join(target,'Plans','Week.nm'))&&fs.existsSync(path.join(target,'Drafts','Old Cooking Notes.nm')),10000),'Ticking it again copies the Notepads already in the NoteMind folder and the unsaved ones');
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.copies=fs.existsSync(target)?fs.readdirSync(target,{recursive:true}):null;report.log=fs.existsSync(path.join(data,'icloud-copy.log'))?fs.readFileSync(path.join(data,'icloud-copy.log'),'utf8'):null;}
 fs.writeFileSync('test-results/icloud-copy.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),90000).unref();
