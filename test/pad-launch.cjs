// Exercise ordinary app launch without the test profile flag that skips Welcome.
const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app}=electron,variant=process.argv[2];
if(process.platform==='darwin')app.dock.hide();
app.disableHardwareAcceleration();
if(!variant){
 const {spawn}=require('node:child_process'),root=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-launch-reports-')),report={checks:[]};
 app.whenReady().then(async()=>{
  try{
   for(const name of ['enabled','disabled','unavailable']){
    const file=path.join(root,name+'.json');
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[__filename,name],{windowsHide:true,stdio:'inherit',env:{...process.env,NOTEMIND_LAUNCH_REPORT:file}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Launch check failed: '+name)));});
    const result=JSON.parse(fs.readFileSync(file,'utf8'));if(!result.ok)throw Error(result.error||'Launch check failed: '+name);report.checks.push(...result.checks);
   }
   report.ok=true;
  }catch(error){report.ok=false;report.error=error.stack;}
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/pad-launch.json',JSON.stringify(report,null,2));fs.rmSync(root,{recursive:true,force:true});console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
 });
}else{
 if(!['enabled','disabled','unavailable'].includes(variant))throw Error('Unknown launch variant: '+variant);
 require('./disable-native-pen.cjs');delete process.env.NOTEMIND_TEST_NO_PAD;delete process.env.NOTEMIND_DATA;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-launch-'));app.setPath('userData',root);app.setPath('documents',root);process.env.NOTEMIND_HOME=root;process.env.NOTEMIND_WORKSPACES=path.join(root,'workspaces');
 fs.writeFileSync(path.join(root,'pad.json'),JSON.stringify({enabled:variant!=='disabled'}));
 process.once('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
 // Keep every native window hidden while retaining the visibility and focus the app requested.
 const states=new WeakMap();
 function suppress(window,visible=false){
  let state=states.get(window);if(state){state.visible=visible;state.focused=visible;return;}
  state={visible,focused:visible};states.set(window,state);window.show=()=>{state.visible=true;state.focused=true;window.emit('show');window.emit('focus');};window.showInactive=()=>{state.visible=true;window.emit('show');};window.hide=()=>{state.visible=false;state.focused=false;window.emit('hide');};window.isVisible=()=>state.visible;window.isFocused=()=>state.focused;window.focus=()=>{state.focused=state.visible;if(state.focused)window.emit('focus');};
 }
 const Module=require('node:module'),load=Module._load;let realScreen;
 Module._load=function(request,parent,isMain){const result=load.call(this,request,parent,isMain);if(request!=='electron')return result;
  return {...result,screen:new Proxy({},{get(_target,key){realScreen ||= result.screen;const primary=realScreen.getPrimaryDisplay();if(key==='getAllDisplays'){const bounds={x:primary.bounds.x+primary.bounds.width,y:primary.bounds.y,width:1920,height:1080};return ()=>variant==='unavailable'?[primary]:[primary,{...primary,id:primary.id+100,label:'Wacom launch test',internal:false,rotation:0,bounds,workArea:bounds}];}const value=realScreen[key];return typeof value==='function'?value.bind(realScreen):value;}}),BrowserWindow:class extends result.BrowserWindow{constructor(options){super({...options,show:false});suppress(this,options?.show!==false);}}};
 };
 const report={variant,checks:[]};let tested=false,finished=false;
 function finish(error){if(finished)return;finished=true;report.ok=!error;if(error)report.error=error.stack;fs.writeFileSync(process.env.NOTEMIND_LAUNCH_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(error?1:0);}
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 app.on('browser-window-created',(_,window)=>{
  suppress(window);window.webContents.setBackgroundThrottling(false);if(tested)return;tested=true;
  window.webContents.once('did-finish-load',async()=>{
   try{
    for(let i=0;i<100;i++){
     const children=electron.BrowserWindow.getAllWindows().filter(other=>other!==window),pad=children.find(child=>child.webContents.getURL()==='about:blank'),welcome=children.find(child=>child.webContents.getURL().endsWith('welcome.html'));
     if(variant==='enabled'){
      if(welcome)throw Error('Automatic Welcome blocked the enabled Wacom launch');
      const ready=pad&&await pad.webContents.executeJavaScript(`!!document.querySelector('#notemind-pad-root .tablet-pane [data-tablet="surface"]')`).catch(()=>false);
      if(ready&&pad.isVisible()&&window.isVisible()){
       const state=await window.webContents.executeJavaScript('window.notemind.pad.state()');if(!state.enabled||!state.available||!state.owned||!state.open)throw Error('Wacom launch did not own an open display');report.checks.push('saved enabled Wacom launches directly into a visible workspace and populated drawing display');finish();return;
      }
     }else if(welcome&&!welcome.webContents.isLoading()){
      if(window.isVisible())throw Error('The workspace bypassed automatic Welcome without an enabled Wacom');if(pad)throw Error('A drawing display opened without an enabled Wacom');
      report.checks.push(variant==='disabled'?'saved window drawing preference preserves automatic Welcome':'launch without a Wacom preserves automatic Welcome');finish();return;
     }
     await pause(100);
    }
    throw Error('Launch did not reach the expected '+variant+' state');
   }catch(error){finish(error);}
  });
 });
 setTimeout(()=>finish(Error('Launch check timed out')),15000).unref();
 require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));
}
