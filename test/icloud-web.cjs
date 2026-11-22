// Notepads on the web, end to end in the app: File > Show Notepads on the Web opens the sign-in window, signing in sends
// what is in the copied folder to iCloud, a Notepad saved later follows, and signing out forgets. Apple's CloudKit JS is
// replaced by a stand-in served at its own address in the window's session, so nothing reaches Apple or a real iCloud.
// Run: npx electron test/icloud-web.cjs
const {app,Menu,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve('test-results/icloud-web-'+Date.now()),home=path.join(root,'home'),cloud=path.join(root,'iCloud Drive'),target=path.join(cloud,'NoteMind'),data=path.join(root,'data');
for(const dir of [home,target,data])fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(data,'icloud-copy.json'),JSON.stringify({enabled:true}));
process.env.NOTEMIND_DATA=data;process.env.NOTEMIND_HOME=home;process.env.NOTEMIND_ICLOUD_DIR=target;
if(process.platform==='darwin')app.setActivationPolicy('accessory');
app.disableHardwareAcceleration();for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
const notepad=require(path.resolve('src/notepad-format.cjs'));
fs.mkdirSync(path.join(target,'Drafts'),{recursive:true});
fs.writeFileSync(path.join(target,'Drafts','Old Cooking Notes.nm'),notepad.encode({text:'# Old Cooking Notes\n\nflour, salt\n',assets:{},meta:{tags:['cooking']}}));

// The stand-in for CloudKit JS: the calls src/icloud-web-page.js makes, keeping records in the page.
const FAKE=`(function(){
 const records={},signIns=[],signOuts=[];let who=null;
 window.__fake={records,signIn(){who={userRecordName:'_test-user'};document.getElementById(window.__fake.signInId).innerHTML='';signIns.splice(0).forEach(r=>r(who));},signOut(){who=null;signOuts.splice(0).forEach(r=>r());}};
 const read=async value=>value instanceof Blob?{name:value.name,size:value.size,text:await value.text()}:value;
 window.CloudKit={
  configure(config){const c=config.containers[0];window.__fake.config={container:c.containerIdentifier,environment:c.environment,persist:c.apiTokenAuth.persist};window.__fake.signInId=c.apiTokenAuth.signInButton.id;},
  getDefaultContainer(){return {
   setUpAuth:async()=>{if(!who){const b=document.createElement('div');b.className='apple-auth-button';b.textContent='Sign in with Apple';document.getElementById(window.__fake.signInId).replaceChildren(b);}return who;},
   whenUserSignsIn:()=>new Promise(r=>signIns.push(r)),
   whenUserSignsOut:()=>new Promise(r=>signOuts.push(r)),
   privateCloudDatabase:{newRecordsBatch(){const ops=[];return {forceReplace(r){ops.push(['save',r]);},forceDelete(r){ops.push(['delete',r]);},async commit(){
    if(!who)return {hasErrors:true,errors:[{ckErrorCode:'AUTHENTICATION_REQUIRED'}],records:[]};
    for(const [op,r] of ops){if(op==='delete'){delete records[r.recordName];continue;}const fields={};for(const [k,v] of Object.entries(r.fields))fields[k]=await read(v.value);records[r.recordName]={recordType:r.recordType,fields};}
    return {hasErrors:false,errors:[],records:[]};}};}},
  };}
 };
})();`;
app.whenReady().then(()=>session.fromPartition('persist:notemind-icloud-web').protocol.handle('https',request=>request.url==='https://cdn.apple-cloudkit.com/ck/2/cloudkit.js'?new Response(FAKE,{headers:{'content-type':'text/javascript'}}):new Response('',{status:404})));

const report={root,checks:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));let tested=false;
const waitFor=async(test,ms)=>{const end=Date.now()+ms;while(Date.now()<end){if(await test())return true;await pause(250);}return false;};
app.on('browser-window-created',(_,w)=>{w.setFocusable(false);w.webContents.setBackgroundThrottling(false);if(tested)return;tested=true;w.webContents.once('did-finish-load',async()=>{
 const js=(fn,...args)=>w.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
 try{
  await pause(1000);
  const item=()=>Menu.getApplicationMenu().items.find(i=>i.label==='File').submenu.items.find(i=>i.label==='Show Notepads on the Web…');
  check(item()&&item().visible,'File > Show Notepads on the Web… is there when iCloud Drive is');
  item().click();
  let web=null;
  check(await waitFor(()=>(web=BrowserWindow.getAllWindows().find(x=>x.getTitle()==='Notepads on the Web'))&&web.isVisible(),10000),'It opens the Notepads on the Web window');
  const page=(fn,...args)=>web.webContents.executeJavaScript('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
  check(await waitFor(()=>page(()=>document.getElementById('notemind-web-status').textContent.startsWith('Sign in with your Apple ID')),10000),'Signed out, it asks for an Apple ID sign-in');
  check(await page(()=>location.origin)==='https://seancheren.com','The page has the seancheren.com origin the CloudKit token allows');
  check(JSON.stringify(await page(()=>window.__fake.config))===JSON.stringify({container:'iCloud.com.seancheren.acctmind',environment:'development',persist:true}),'It uses the reader\'s container and keeps the sign-in');
  check(await page(()=>!!document.querySelector('#notemind-web-sign-in .apple-auth-button')),'Apple\'s sign-in button is shown');
  check(!fs.existsSync(path.join(data,'icloud-web-state.json'))||!JSON.parse(fs.readFileSync(path.join(data,'icloud-web-state.json'),'utf8')).appleId,'Nothing is sent before signing in');
  await page(()=>window.__fake.signIn());
  const record=name=>page(n=>window.__fake.records[n]||null,name);
  const {recordName,INDEX_NAME}=require(path.resolve('src/icloud-web.cjs'));
  check(await waitFor(async()=>!!(await record(INDEX_NAME)),20000),'Signing in sends the copied folder to iCloud');
  const cooking=await record(recordName('Drafts/Old Cooking Notes.nm'));
  check(cooking&&cooking.recordType==='NoteMindFile'&&cooking.fields.path==='Drafts/Old Cooking Notes.nm','Each file is a record named by its place');
  check(cooking.fields.file.size===fs.statSync(path.join(target,'Drafts','Old Cooking Notes.nm')).size&&cooking.fields.file.name==='Old Cooking Notes.nm','The record carries the file itself');
  check(cooking.fields.text.includes('flour, salt')&&JSON.parse(cooking.fields.meta).tags[0]==='cooking','And the Notepad\'s text and tags for the reader\'s list');
  check(JSON.parse((await record(INDEX_NAME)).fields.files).files.some(entry=>entry[0]==='Drafts/Old Cooking Notes.nm'),'The index names it');
  check(await waitFor(()=>page(()=>/^Signed in\. 1 Notepad is on the web/.test(document.getElementById('notemind-web-status').textContent)),5000),'The window says how many Notepads are on the web');
  const file=path.join(home,'Week.nm');
  const unrelated=path.join(home,'Unrelated.nm');
  for(const name of [file,unrelated])await js(f=>window.dispatchEvent(new CustomEvent('notemind-keep-file',{detail:f})),name);
  const indicator=f=>js(value=>[...document.querySelectorAll('.note-row')].find(row=>row.dataset.path===value)?.querySelector('.note-sync')?.dataset.state,f);
  await js(f=>window.notemind.save({text:'# Week\n\nThe plan.\n',assets:{},meta:{},title:'Week',path:f},false),file);
  check(await waitFor(async()=>await indicator(file)==='syncing',4000),'The pending file has a sync icon beside its name');
  check(await indicator(unrelated)==='waiting','A different filename keeps its own state');
  check(await waitFor(async()=>{const r=await record(recordName('Week.nm'));return !!r&&r.fields.text.includes('The plan.');},40000),'A Notepad saved later is copied to iCloud Drive and then sent');
  check(await waitFor(async()=>await indicator(file)==='synced',5000),'The icon confirms the file appears in the web index');
  await js(f=>{
    const badge=[...document.querySelectorAll('.note-row')].find(row=>row.dataset.path===f).querySelector('.note-sync');
    const box=badge.getBoundingClientRect();
    badge.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse',clientX:box.x,clientY:box.y}));
  },file);
  check(await waitFor(()=>js(()=>document.querySelector('[role=tooltip]')?.textContent==='Copied to iCloud Drive and available in the web viewer.'),3000),'Hovering the synced file icon shows its copy and web status');
  web.close();
  check(!web.isDestroyed()&&!web.isVisible(),'Closing the window hides it; sending goes on');
  await page(()=>window.__fake.signOut());
  check(await waitFor(()=>!JSON.parse(fs.readFileSync(path.join(data,'icloud-web-state.json'),'utf8')).appleId,5000),'Signing out forgets what was sent');
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;report.log=fs.existsSync(path.join(data,'icloud-copy.log'))?fs.readFileSync(path.join(data,'icloud-copy.log'),'utf8'):null;}
 fs.writeFileSync('test-results/icloud-web.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});});require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),120000).unref();
