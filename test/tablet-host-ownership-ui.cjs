// The production App and PadHost run in hidden windows with synthetic media and
// in-memory persistence. Instrumentation exposes owners; it replaces no behavior.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-tablet-host-'));
const output=path.join(root,'test-results/performance-0.37/tablet-host');
app.setPath('userData',path.join(directory,'profile'));
app.dock?.hide();app.disableHardwareAcceleration();
for(const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
app.on('window-all-closed',()=>{});
let win,finished=false,phase='setup',peak=0;
const children=new Set(),errors=[],results=[];
require('./native-failure-exit.cjs').installNativeFailureExit({app,report:path.join(output,'result.json'),telemetry:{fixture:'tablet-host',results,errors}});
const watchdog=setTimeout(()=>finish(Error('Tablet host ownership fixture timed out.')),60000);
const memory=setInterval(()=>{
 if(!app.isReady())return;
 const bytes=app.getAppMetrics().reduce((total,item)=>total+item.memory.workingSetSize*1024,0);
 peak=Math.max(peak,bytes);
 if(bytes>1024**3)finish(Error('Owned Electron working set exceeded 1 GiB.'));
},40);
function finish(error){
 if(finished)return;if(!error&&errors.length)error=Error('App runtime: '+errors.join('; '));finished=true;clearTimeout(watchdog);clearInterval(memory);
 const value={ok:!error,phase,error:error?.stack,peakWorkingSetBytes:peak,results,errors};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(value,null,2));
 console.log(JSON.stringify(value));
 for(const child of children)if(!child.isDestroyed())child.destroy();
 if(win&&!win.isDestroyed())win.destroy();
 fs.rmSync(directory,{recursive:true,force:true});app.exit(error?1:0);
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=expression=>win.webContents.executeJavaScript(expression);
async function until(expression){
 for(let turn=0;turn<400&&!finished;turn++){if(await evaluate(expression))return;await wait(10);}
 const diagnostic=await evaluate(`(()=>{const value=window.fixturePDFView;return{pdf:window.fixturePDF&&{opens:fixturePDF.opens,closes:fixturePDF.closes,saves:fixturePDF.saves},view:value&&{status:value.getSnapshot().status,stroke:value.refs.current.current?.model.strokes[0],page:value.getSnapshot().page,current:value.refs.current.current?.number,models:value.refs.models.current.size,edits:[...(value.refs.state.current?.edits.values||[])].map(([page,edit])=>({page,saved:edit.saved,hasPromise:!!edit.promise,generation:edit.generation,strokes:edit.strokes?.length}))},errors:window.fixtureErrors}})()`);
 throw Error('Condition timed out: '+expression+'; '+JSON.stringify(diagnostic));
}
const bootstrap=`
window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.error?.stack||e.message));
addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
const canvas=document.createElement('canvas');canvas.width=96;canvas.height=144;
canvas.getContext('2d').fillStyle='#2266cc';canvas.getContext('2d').fillRect(0,0,96,144);
window.fixturePNG=canvas.toDataURL('image/png');window.fixtureReleased=[];
window.fixtureCameraLoads=0;window.fixtureCameraWrites=[];window.fixtureSheetWrites=[];
window.fixtureMediaCalls=0;window.fixtureShutdowns=0;window.fixtureMounts=0;window.fixtureDetaches=0;
window.fixtureObserveOwners=owners=>{
 if(window.fixtureOwners){if(fixtureOwners.camera!==owners.camera||fixtureOwners.previews!==owners.previews||fixtureOwners.sheets!==owners.sheets||fixtureOwners.pdf!==owners.pdf)throw Error('App replaced a stable owner');return;}
 window.fixtureOwners=owners;
 const camera=owners.camera,attach=camera.attachView.bind(camera),detach=camera.detachView.bind(camera),shutdown=camera.shutdown.bind(camera);
 camera.attachView=(...args)=>{fixtureMounts++;return attach(...args)};
 camera.detachView=(...args)=>{fixtureDetaches++;return detach(...args)};
 camera.shutdown=(...args)=>{fixtureShutdowns++;return shutdown(...args)};
};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
 getUserMedia:async()=>{fixtureMediaCalls++;throw Error('Physical camera must not open');},
 enumerateDevices:async()=>[],addEventListener(){},removeEventListener(){}
}});
localStorage.setItem('notemind.inputSource','camera');
const subscriptions=new Set(),off=()=>()=>{},nothing=async()=>null;
window.fixturePadState={available:true,enabled:false,owned:true,open:false,bounds:{width:1080,height:1788},rotation:0};
window.fixtureSetPad=enabled=>{fixturePadState={...fixturePadState,enabled,open:enabled};for(const receive of subscriptions)receive(fixturePadState);return fixturePadState;};
window.notemind={platform:'darwin',
 loadSheets:async()=>null,saveSheets:async value=>fixtureSheetWrites.push(value),onSheetsFlush:off,sheetsFlushDone(){},
 loadCameraPages:async()=>{fixtureCameraLoads++;return [0,1].map(i=>({name:'Saved '+i,picture:fixturePNG,strokes:[],aspect:'free',rotation:0,device:''}));},
 saveCameraPages:async value=>fixtureCameraWrites.push(value),
 ocrAvailable:async()=>false,preferenceGet:nothing,preferenceSet:nothing,onPreference:off,
 previewDocument:async()=>({kind:'image',pages:[{width:96,height:144,image:fixturePNG.split(',')[1]}]}),
 pad:{state:async()=>fixturePadState,onState:receive=>{subscriptions.add(receive);return()=>subscriptions.delete(receive)},onFrame:off,
 set:async enabled=>fixtureSetPad(enabled),close:async()=>fixtureSetPad(false),ready:nothing,activity(){},input(){},
 onPenSamples:off,onPenStatus:off,penStop(){},penHeartbeat(){}},
 pen:{onSamples:off,onStatus:off,sheet(){}}
};
window.fixturePDF={opens:0,closes:[],saves:[],pages:new Map(),saveGate:null,openGate:null};
window.fixtureHoldPDFSave=()=>{fixturePDF.saveGate=new Promise(resolve=>{fixturePDF.releaseSave=()=>{fixturePDF.saveGate=null;resolve();};});};
window.fixtureHoldPDFOpen=()=>{fixturePDF.openGate=new Promise(resolve=>{fixturePDF.releaseOpen=()=>{fixturePDF.openGate=null;resolve();};});};
window.notemind.reference={
 open:async()=>{const id='source-'+(++fixturePDF.opens);await fixturePDF.openGate;return{id,sourceHash:'a'.repeat(64),pageCount:3,index:{pages:{}},previous:[]};},
 info:async()=>({width:600,height:900,rotation:0}),page:async()=>({data:fixturePNG.split(',')[1],width:96,height:144}),text:async()=>'',cancel:async()=>{},retain:async()=>{},
 ink:async(id,page)=>fixturePDF.pages.get(id+':'+page)||null,
 save:async(id,value)=>{fixturePDF.saves.push({id,page:value.page,bytes:value.bytes.length});await fixturePDF.saveGate;const revision='saved-'+fixturePDF.saves.length,data=btoa(String.fromCharCode(...value.bytes));fixturePDF.pages.set(id+':'+value.page,{revision,data});return{revision};},
 close:async id=>fixturePDF.closes.push(id),export:async()=>null
};
window.NoteMindPDFReferences={isOwnerOpen:()=>true};
window.NoteMindNotes={api:{releaseAttachmentPreview:async token=>fixtureReleased.push(token)},captureInsertion:()=>({id:'original-note'})};
document.getElementById('paneToggle').onclick=()=>{document.getElementById('pane').hidden=!document.getElementById('pane').hidden};
`;
async function setup(){
 const entry=path.join(root,'src/tablet-entry.tsx');
 await esbuild.build({entryPoints:[entry],bundle:true,platform:'browser',format:'iife',outfile:path.join(directory,'bundle.js'),
  alias:{'@notemind/core':path.join(root,'src/tablet/core.js')},jsx:'automatic',plugins:[{name:'observe-production-owners',setup(build){
   build.onLoad({filter:/\/tablet-entry\.tsx$/},async args=>{
    let contents=await fs.promises.readFile(args.path,'utf8');
    const marker=' const [loaded,setLoaded]';assert.ok(contents.includes(marker));
    contents=contents.replace(marker,' window.fixtureSetSource=source=>setSource(source);window.fixtureNewPage=()=>new TabletPage(1);window.fixturePenCommand=runPenAction;window.fixtureObserveOwners({camera:cameraSession.current,previews:previewModels.current,sheets:sheetModels.current,pdf:pdfViews.current});\n'+marker);
    const overviewMarker=' const chooseOverview=';assert.ok(contents.includes(overviewMarker));contents=contents.replace(overviewMarker,' window.fixtureOverview=overview;\n'+overviewMarker);
    const mount="createRoot(document.getElementById('tablet-root')).render(<App/>);";assert.ok(contents.includes(mount));
    contents=contents.replace(mount,"const fixtureRoot=createRoot(document.getElementById('tablet-root'));window.fixtureUnmount=()=>fixtureRoot.unmount();fixtureRoot.render(<App/>);");
    return{contents,loader:'tsx',resolveDir:path.dirname(args.path)};
   });
  }}]});
 for(const name of ['drawing','camera','overview-thumbnail'])await esbuild.build({entryPoints:[path.join(root,'src/'+name+'-worker.ts')],bundle:true,platform:'browser',format:'iife',outfile:path.join(directory,name+'-worker.js'),alias:{'@notemind/core':path.join(root,'src/tablet/core.js')},minify:true});
 fs.writeFileSync(path.join(directory,'bootstrap.js'),bootstrap);
 fs.writeFileSync(path.join(directory,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self' file:; img-src 'self' data: blob:; media-src blob:; style-src 'self' 'unsafe-inline'; script-src 'self' file:; worker-src 'self' file: blob:"><link rel="stylesheet" href="bundle.css"><style>html,body{margin:0;height:100%;overflow:hidden}main{display:none}#pane{height:100%;width:100%}#tablet-root{height:100%}.tablet-pane{height:100%;display:flex;flex-direction:column}.camera-workspace{flex:1;min-height:0}.camera-stage{flex:1;min-height:0}</style></head><body><nav id="sidebar" hidden></nav><div id="documentTabs"></div><main><article id="rich"></article></main><button id="paneToggle" hidden></button><button id="open" hidden></button><aside id="pane"><div id="tablet-root"></div></aside><script src="bootstrap.js"></script><script src="bundle.js"></script></body></html>`);
 win=new BrowserWindow({width:1100,height:900,show:false,focusable:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 win.webContents.session.setPermissionRequestHandler((_,__,done)=>done(false));
 win.webContents.setWindowOpenHandler(()=>({action:'allow',overrideBrowserWindowOptions:{show:false,focusable:false,width:1080,height:1788,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}}}));
 win.webContents.on('did-create-window',child=>{children.add(child);child.webContents.on('console-message',event=>{if(event.level==='warning'||event.level==='error'||Number(event.level)>=2)errors.push(event.message)});child.on('closed',()=>children.delete(child));});
 win.webContents.on('console-message',event=>{if(event.level==='warning'||event.level==='error'||Number(event.level)>=2)errors.push(event.message)});
 await win.loadFile(path.join(directory,'index.html'));
}
async function run(){
 await app.whenReady();await setup();phase='initial-camera';
 await until('window.fixtureOwners?.camera.state.cameraLoaded&&document.querySelectorAll("#camera-tabs .sheet-tab").length===2');
 await evaluate(`(()=>{const camera=fixtureOwners.camera,owner=camera.models.current[0].page;owner.mark();owner.add({colorHex:'#123456',width:3,points:[{x:.1,y:.2},{x:.3,y:.4}]});camera.setter('box')({x:.1,y:.2,width:.3,height:.4});})()`);
 await evaluate('fixtureOwners.camera.flush()');
 assert.equal(await evaluate('fixtureCameraLoads'),1);
 results.push({phase,loads:1,mounts:await evaluate('fixtureMounts')});
 phase='camera-page-overview';
 await evaluate(`document.querySelector('[aria-label="Page overview"]').click()`);await until(`!!document.querySelector('.page-overview')&&document.querySelectorAll('.page-overview-preview img').length===2`);
 await evaluate('window.fixtureOverviewCoordinator=fixtureOverview.coordinator;window.fixtureOverviewCamera=fixtureOwners.camera.page.current;void 0');
 await evaluate(`document.querySelector('.page-overview-page[aria-current="page"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}))`);
 await until('fixtureOwners.camera.models.current[1].page===fixtureOverviewCamera');assert.equal(await evaluate('fixtureOwners.camera.page.current===fixtureOverviewCamera'),true);
 await evaluate(`document.querySelector('.page-overview-page[aria-current="page"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}))`);await until('fixtureOwners.camera.models.current[0].page===fixtureOverviewCamera');
 await evaluate('fixtureSetPad(true)');await until('!!document.querySelector(".pad-placeholder")');assert.equal(await evaluate('fixtureOverview.coordinator===fixtureOverviewCoordinator'),true);
 await evaluate('fixtureSetPad(false)');await until('!!document.querySelector(".page-overview")&&!document.querySelector(".pad-placeholder")');
 await evaluate("fixturePenCommand('clearSheet');fixturePenCommand('sendWriting');fixturePenCommand('deleteSelection')");assert.equal(await evaluate('fixtureOverviewCamera.strokes.length'),1);
 await evaluate(`document.querySelector('[aria-label="Close page overview"]').click()`);await until('!document.querySelector(".page-overview")');await until('document.activeElement?.hasAttribute("data-page-overview-toggle")');
 results.push({phase,keyboardFocusRestored:true,thumbnails:2,keptSelectedOwner:true,portalCoordinatorRetained:true,suspendedInkCommands:true});
 phase='virtual-drawing-overview';
 await evaluate(`window.fixtureOriginalSheets=fixtureOwners.sheets.current;fixtureOwners.sheets.update(Array.from({length:3000},(_,index)=>({pageId:'overview-'+index,name:'Drawing '+index,page:fixtureNewPage()})));fixtureSetSource('tablet')`);
 await until(`!!document.querySelector('[data-tablet="surface"]')`);await evaluate(`document.querySelector('[aria-label="Page overview"]').click()`);await until(`!!document.querySelector('.page-overview')&&document.querySelectorAll('.page-overview-preview img').length>0`);
 const virtual=await evaluate(`({mounted:document.querySelectorAll('.page-overview-page').length,pages:fixtureOverview.pages.length})`);assert.equal(virtual.pages,3000);assert.ok(virtual.mounted>0&&virtual.mounted<64);
 await evaluate(`document.querySelector('.page-overview-page[tabindex="0"]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);await until(`!!document.querySelector('[data-overview-page-id="overview-2999"] .page-overview-page')`);
 await evaluate(`document.querySelector('[data-overview-page-id="overview-2999"] .page-overview-page').click()`);await until(`!document.querySelector('.page-overview')&&document.querySelector('.sheet-tab.on')?.textContent.includes('Drawing 2999')`);
 await until('document.activeElement?.hasAttribute("data-page-overview-toggle")');assert.equal(await evaluate('fixtureOwners.sheets.current.length'),3000);results.push({phase,keyboardFocusRestored:true,pages:3000,mounted:virtual.mounted,lastPageSelected:true});
 await evaluate(`fixtureOwners.sheets.update(fixtureOriginalSheets);fixtureSetSource('camera')`);await until('!!document.querySelector(".camera-workspace")');
 phase='previews-and-portal';
 await evaluate(`for(const [name,previewToken]of [['A','token-A'],['B','token-B']])dispatchEvent(new CustomEvent('notemind-preview',{detail:{path:'/fixture/'+name+'.png',name,previewToken}}))`);
 await until('document.querySelectorAll("[data-doc-tab]").length===2');
 for(let turn=0;turn<2;turn++){
  await evaluate('fixtureSetPad(true)');await until('!!document.querySelector(".pad-placeholder")&&fixtureMounts>fixtureDetaches');
  assert.equal(children.size,1);assert.deepEqual(await evaluate('fixtureReleased'),[]);
  await evaluate('fixtureSetPad(false)');await until('!document.querySelector(".pad-placeholder")&&document.querySelectorAll("[data-doc-tab]").length===2');
  assert.deepEqual(await evaluate('fixtureReleased'),[]);assert.equal(await evaluate('fixtureShutdowns'),0);
 }
 assert.equal(await evaluate('fixtureCameraLoads'),1);
 assert.equal(await evaluate('fixtureOwners.camera.models.current[0].page.strokes.length'),1);
 assert.deepEqual(await evaluate('fixtureOwners.camera.state.box'),{x:.1,y:.2,width:.3,height:.4});
 results.push({phase,mounts:await evaluate('fixtureMounts'),detaches:await evaluate('fixtureDetaches'),releases:0});
 phase='pdf-ink-portal-save';
 await evaluate(`dispatchEvent(new CustomEvent('notemind-preview',{detail:{path:'/fixture/reference.pdf',name:'Reference',previewToken:'token-PDF'}}))`);
 await until(`!!document.querySelector('[data-doc-kind="pdf"] [data-tablet="surface"]')&&!document.querySelector('.pdf-reference-loading')`);
 await evaluate(`window.fixturePDFView=fixtureOwners.pdf.values.get('/fixture/reference.pdf');window.fixturePDFModel=fixturePDFView.refs.current.current.model;fixtureHoldPDFSave();(()=>{const el=document.querySelector('[data-doc-kind="pdf"] [data-tablet="surface"]'),r=el.getBoundingClientRect();for(const[type,x,y,buttons]of[['pointerdown',.2,.2,1],['pointermove',.6,.5,1],['pointerup',.6,.5,0]])el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'pen',pointerId:31,button:0,buttons,pressure:buttons?.5:0,clientX:r.left+x*r.width,clientY:r.top+y*r.height}));})()`);
 await until('fixturePDFModel.strokes.length===1');assert.equal(await evaluate('Number.isFinite(fixturePDFModel.strokes[0].width)&&fixturePDFModel.strokes[0].width>0'),true,'PDF ink receives the current valid pen width');
 for(let turn=0;turn<2;turn++){
  await evaluate('fixtureSetPad(true)');await until('!!document.querySelector(".pad-placeholder")&&fixtureMounts>fixtureDetaches');
  assert.equal(await evaluate(`fixtureOwners.pdf.values.get('/fixture/reference.pdf')===fixturePDFView&&fixturePDFView.refs.models.current.get(1).model===fixturePDFModel`),true);
  assert.equal(await evaluate('fixturePDF.closes.length'),0);assert.equal(await evaluate('fixturePDF.opens'),1);
  if(turn===0){await until('fixturePDF.saves.length===1');await evaluate('fixturePDF.releaseSave()');}
  await evaluate('fixtureSetPad(false)');await until(`!document.querySelector('.pad-placeholder')&&!!document.querySelector('[data-doc-kind="pdf"] [data-tablet="surface"]')&&!document.querySelector('.pdf-reference-loading')`);
  assert.equal(await evaluate('fixturePDFModel.strokes.length'),1);assert.equal(await evaluate('fixturePDFModel.canUndo'),true);
 }
 phase='active-pdf-pen-commands';
 await evaluate("fixturePenCommand('nextSheet')");await until('fixturePDFView.getSnapshot().page===2&&!fixturePDFView.getSnapshot().loading');
 assert.equal(await evaluate('fixtureOwners.camera.models.current[0].page.strokes.length'),1);
 await evaluate("fixturePenCommand('prevSheet')");await until('fixturePDFView.getSnapshot().page===1&&!fixturePDFView.getSnapshot().loading');
 await evaluate("window.fixturePDFBackdrop=fixturePDFModel.backdrop;fixturePenCommand('clearSheet')");await until('fixturePDFModel.strokes.length===0');
 assert.equal(await evaluate('fixturePDFModel.backdrop===fixturePDFBackdrop'),true,'clear removes PDF markup while preserving its page backdrop');
 assert.equal(await evaluate('fixtureOwners.camera.models.current[0].page.strokes.length'),1,'an active PDF command cannot clear hidden camera ink');
 await evaluate("fixturePenCommand('undo')");await until('fixturePDFModel.strokes.length===1');
 await evaluate("fixturePenCommand('clearSelection');fixturePenCommand('deleteSelection');fixturePDFView.flush()");
 assert.equal(await evaluate('fixturePDFModel.strokes.length'),1);assert.equal(await evaluate('fixtureOwners.camera.models.current[0].page.strokes.length'),1);
 results.push({phase,nextPrevious:true,clearMarkupOnly:true,undoRestored:true,hiddenCameraPreserved:true});
 const savedBeforeClose=await evaluate('fixturePDF.saves.length');phase='pdf-ink-portal-save';
 await evaluate(`fixtureHoldPDFSave();(()=>{const el=document.querySelector('[data-doc-kind="pdf"] [data-tablet="surface"]'),r=el.getBoundingClientRect();for(const[type,x,y,buttons]of[['pointerdown',.3,.3,1],['pointermove',.7,.6,1],['pointerup',.7,.6,0]])el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'pen',pointerId:32,button:0,buttons,pressure:buttons?.5:0,clientX:r.left+x*r.width,clientY:r.top+y*r.height}));})()`);
 await until('fixturePDFModel.strokes.length===2');await evaluate(`document.querySelector('[data-doc-close="/fixture/reference.pdf"]').click()`);await until('fixturePDF.saves.length==='+String(savedBeforeClose+1));
 assert.equal(await evaluate('fixtureReleased.includes("token-PDF")'),false);assert.equal(await evaluate('fixturePDF.closes.length'),0);
 await evaluate('fixturePDF.releaseSave()');await until('fixtureReleased.includes("token-PDF")');assert.equal(await evaluate('fixturePDF.closes.length'),1);assert.equal(await evaluate('fixtureOwners.pdf.values.size'),0);
 results.push({phase,opens:1,closes:1,strokes:2,portalMoves:4,keptUndo:true,releaseAfterSave:true});
 phase='pdf-close-during-open';await evaluate(`fixtureHoldPDFOpen();dispatchEvent(new CustomEvent('notemind-preview',{detail:{path:'/fixture/pending.pdf',name:'Pending',previewToken:'token-Pending'}}))`);await until('fixturePDF.opens===2');
 await evaluate(`document.querySelector('[data-doc-close="/fixture/pending.pdf"]').click()`);await wait(20);assert.equal(await evaluate('fixtureReleased.includes("token-Pending")'),false);
 await evaluate('fixturePDF.releaseOpen()');await until('fixtureReleased.includes("token-Pending")');assert.equal(await evaluate('fixturePDF.closes.length'),2);assert.equal(await evaluate('fixtureOwners.pdf.values.size'),0);
 results.push({phase,returnedSourceClosedOnce:true,releaseAfterOpenSettles:true});
 phase='close-and-root-disposal';
 await evaluate(`dispatchEvent(new CustomEvent('notemind-preview',{detail:{path:'/fixture/A.png',name:'A again',previewToken:'redundant-A'}}))`);
 await until('fixtureReleased.includes("redundant-A")');
 await evaluate(`document.querySelector('[data-doc-close="/fixture/A.png"]').click()`);
 await until('fixtureReleased.includes("token-A")&&document.querySelectorAll("[data-doc-tab]").length===1');
 assert.equal(await evaluate('fixtureReleased.includes("token-B")'),false);
 await evaluate('fixtureUnmount()');await until('fixtureOwners.camera.closed&&fixtureReleased.includes("token-B")');
 assert.equal(await evaluate('fixtureShutdowns'),1);assert.equal(await evaluate('fixtureMediaCalls'),0);
 assert.deepEqual(await evaluate('fixtureReleased.slice().sort()'),['redundant-A','token-A','token-B','token-PDF','token-Pending']);
 assert.deepEqual(await evaluate('fixtureErrors'),[]);assert.deepEqual(errors,[]);
 results.push({phase,shutdowns:1,physicalMediaCalls:0,released:await evaluate('fixtureReleased')});finish();
}
run().catch(finish);
