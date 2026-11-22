// The window behind File > Show Notepads on the Web. It shows Apple's sign-in, and while hidden it carries the writes of
// src/icloud-web.cjs to CloudKit. Its page (src/icloud-web.html + src/icloud-web-page.js) is NoteMind's own, loaded as a
// data: page whose origin is the seancheren.com address the CloudKit web token allows, in a session of its own. Apple's
// sign-in opens in a child window (CloudKit JS hands the session back to its opener); every other link opens in the
// browser. A hidden window that has nothing to do closes after a few minutes and comes back when needed.
'use strict';
const {app,BrowserWindow,ipcMain,shell}=require('electron'),fs=require('node:fs'),path=require('node:path');

const SAVE_TIMEOUT_MS=15*60*1000,REMOVE_TIMEOUT_MS=5*60*1000,START_TIMEOUT_MS=30000,IDLE_MS=3*60*1000;
const webURL=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url:null;}catch{return null;}};
/** Apple's sign-in pages: the only places the sign-in window may go. */
const isApple=url=>{const host=url.hostname;return host==='apple.com'||host.endsWith('.apple.com')||host==='icloud.com'||host.endsWith('.icloud.com')||host.endsWith('.apple-cloudkit.com');};

/** Post the original bytes to Apple's short-lived asset URL without browser credentials. */
async function uploadAsset(address,bytes,{send=fetch,signal}={}){
 const url=webURL(address),host=url?.hostname||'';
 if(!url||url.port||!(/\.(icloud-content|apple-cloudkit)\.com$/.test(host)||/^[a-z0-9-]+-content\.icloud\.com$/.test(host))){
  throw Error('CloudKit returned an unexpected file upload host'+(host?' ('+host+')':'')+'.');
 }
 const response=await send(url.href,{method:'POST',body:bytes,headers:{'content-type':'application/octet-stream'},redirect:'error',signal});
 if(!response.ok){await response.body?.cancel();throw Error('The iCloud file upload returned HTTP '+response.status+'.');}
 const asset=(await response.json())?.singleFile;
 if(typeof asset?.receipt!=='string'||!asset.receipt)throw Error('iCloud did not return a file upload receipt.');
 return {singleFile:asset};
}

/** The page, with the container settings in it. */
function pageHTML(config){
 const settings=JSON.stringify({container:config.container,environment:config.environment,apiToken:config.apiToken}).replace(/</g,'\\u003c');
 const script=fs.readFileSync(path.join(__dirname,'icloud-web-page.js'),'utf8').replace(/<\/script/gi,'<\\/script');
 return fs.readFileSync(path.join(__dirname,'icloud-web.html'),'utf8').replace('/*CONFIG*/',()=>settings).replace('/*PAGE*/',()=>script);
}

function createWebBridge({config,icon,partition='persist:notemind-icloud-web',summary=()=>null,onState=()=>{},openReader=()=>{},log=()=>{},idleMs=IDLE_MS}){
 let win=null,started=null,state=null,quitting=false,disposed=false,idle=null,seq=0;
 const jobs=new Map();
 const own=event=>!!win&&!win.isDestroyed()&&event.sender===win.webContents;

 const onStateMessage=(event,value)=>{
  if(!own(event))return;
  const before=state;
  state={signedIn:value?.signedIn===true,appleId:typeof value?.appleId==='string'?value.appleId:null,error:typeof value?.error==='string'?value.error:null};
  if(before?.signedIn&&before.appleId!==state.appleId)failJobs('The Apple ID changed.');
  started?.resolve();
  if(state.error)log('Notepads on the web: '+state.error);
  try{onState(state,before);}catch{}
  sendSummary();
 };
 const onResult=(event,value)=>{
  if(!own(event))return;
  const job=jobs.get(value?.id);if(!job)return;
  jobs.delete(value.id);clearTimeout(job.timer);job.abort.abort();
  if(value.ok)job.resolve();else job.reject(Error(typeof value.error==='string'?value.error:'iCloud did not take it.'));
 };
 const onUploadAsset=async(event,{id,index,url}={})=>{
  const job=own(event)&&jobs.get(id),record=job?.record;
  const bytes=index===-1?record?.file?.bytes:Number.isSafeInteger(index)&&index>=0?record?.parts?.[index]?.bytes:null;
  if(!state?.signedIn||state.appleId!==job?.appleId||!Buffer.isBuffer(bytes))throw Error('This file upload has ended.');
  try{return await uploadAsset(url,bytes,{signal:job.abort.signal});}
  catch(error){if(!job.abort.signal.aborted)log('Notepads on the web: '+error.message);throw error;}
 };
 const onOpenReader=event=>{if(own(event))openReader();};
 ipcMain.on('icloud-web:state',onStateMessage);
 ipcMain.on('icloud-web:result',onResult);
 ipcMain.on('icloud-web:open-reader',onOpenReader);
 ipcMain.handle('icloud-web:upload',onUploadAsset);
 const beforeQuit=()=>{quitting=true;};
 app.on('before-quit',beforeQuit);

 function failJobs(message){for(const job of jobs.values()){clearTimeout(job.timer);job.abort.abort();job.reject(Error(message));}jobs.clear();}
 function create(){
  if(disposed)throw Error('NoteMind is closing.');
  if(win&&!win.isDestroyed())return;
  state=null;
  let resolve;const promise=new Promise(done=>{resolve=done;});started={promise,resolve};
  win=new BrowserWindow({show:false,width:520,height:330,resizable:false,minimizable:false,maximizable:false,fullscreenable:false,title:'Notepads on the Web',icon,
   webPreferences:{preload:path.join(__dirname,'icloud-web-preload.cjs'),partition,contextIsolation:true,sandbox:true,nodeIntegration:false,spellcheck:false}});
  win.setMenuBarVisibility(false);
  const contents=win.webContents;
  contents.on('will-navigate',event=>event.preventDefault());
  contents.setWindowOpenHandler(({url})=>{
   const target=webURL(url);
   if(target&&isApple(target))return {action:'allow',overrideBrowserWindowOptions:{width:640,height:720,title:'Sign in with Apple',autoHideMenuBar:true,icon,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}};
   if(target)void shell.openExternal(target.href).catch(()=>{});
   return {action:'deny'};
  });
  contents.on('did-create-window',child=>{
   child.webContents.on('will-navigate',(event,url)=>{const target=webURL(url);if(!target||!isApple(target))event.preventDefault();});
   child.webContents.setWindowOpenHandler(({url})=>{const target=webURL(url);if(target)void shell.openExternal(target.href).catch(()=>{});return {action:'deny'};});
  });
  win.on('close',event=>{if(!quitting&&!disposed){event.preventDefault();win.hide();touch();}});
  win.on('closed',()=>{win=null;state=null;failJobs('The iCloud window closed.');});
  void win.loadURL('data:text/html;charset=utf-8;base64,'+Buffer.from(pageHTML(config)).toString('base64'),{baseURLForDataURL:config.page}).catch(error=>log('Notepads on the web: '+error.message));
 }
 /** Close the hidden window once nothing has used it for a while. */
 function touch(){
  clearTimeout(idle);
  idle=setTimeout(()=>{if(win&&!win.isDestroyed()&&!win.isVisible()&&!jobs.size)win.destroy();else if(win)touch();},idleMs);
  idle.unref?.();
 }
 async function ready(){
  create();touch();
  let timeout;
  await Promise.race([started.promise,new Promise(done=>{timeout=setTimeout(done,START_TIMEOUT_MS);})]).finally(()=>clearTimeout(timeout));
  if(!state)throw Error('iCloud did not start.');
 }
 /** The signed-in Apple ID (its CloudKit record name), or null. */
 async function appleId(){await ready();return state.signedIn?state.appleId||'signed-in':null;}
 async function job(op,payload,timeout){
  await ready();
  try{
   return await new Promise((resolve,reject)=>{
    const id=++seq,abort=new AbortController();
    const timer=setTimeout(()=>{jobs.delete(id);abort.abort();reject(Error('iCloud did not answer in time.'));},timeout);
    jobs.set(id,{resolve,reject,timer,abort,appleId:payload.appleId,record:payload.record});
    win.webContents.send('icloud-web:job',{id,op,...payload});
   });
  }finally{touch();}
 }
 const save=(record,appleId)=>job('save',{record,appleId},SAVE_TIMEOUT_MS);
 const remove=(names,appleId)=>job('remove',{names,appleId},REMOVE_TIMEOUT_MS);
 function sendSummary(){if(win&&!win.isDestroyed()){try{win.webContents.send('icloud-web:summary',summary());}catch{}}}
 function show(){create();win.show();win.focus();sendSummary();touch();}
 function dispose(){
  disposed=true;clearTimeout(idle);
  ipcMain.removeListener('icloud-web:state',onStateMessage);ipcMain.removeListener('icloud-web:result',onResult);ipcMain.removeListener('icloud-web:open-reader',onOpenReader);
  ipcMain.removeHandler('icloud-web:upload');
  app.removeListener('before-quit',beforeQuit);
  failJobs('NoteMind is closing.');
  if(win&&!win.isDestroyed())win.destroy();
 }
 return {appleId,save,remove,show,sendSummary,dispose,state:()=>state,isOpen:()=>!!win&&!win.isDestroyed()};
}

module.exports={createWebBridge,pageHTML,isApple,uploadAsset};
