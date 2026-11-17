// Flush while camera pages are hydrating, including a remount; never open the physical camera.
require('./disable-native-pen.cjs');
const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-camera-flush-'));process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();
const file=path.join(root,'camera-pages.json'),saved=[{name:'Kept camera ink',picture:null,strokes:[{colorHex:'#ee5533',width:3,points:[{x:.2,y:.3},{x:.4,y:.5}]}],rotation:0,device:'',aspect:'free'}];fs.writeFileSync(file,JSON.stringify(saved));
process.once('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
let loads=0;const handle=ipcMain.handle;ipcMain.handle=function(name,fn){return handle.call(this,name,name==='load-camera-pages'?async(...args)=>{loads++;await new Promise(resolve=>setTimeout(resolve,400));return fn(...args);}:fn);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let tested=false;
app.on('browser-window-created',(_,w)=>{if(tested)return;tested=true;w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{
 const js=code=>w.webContents.executeJavaScript(code);
 try{
  for(const pass of [1,2]){
   if(pass===2){const loaded=new Promise(resolve=>w.webContents.once('did-finish-load',resolve));w.webContents.reload();await loaded;}
   for(let n=0;n<100&&loads<pass;n++)await wait(20);if(loads<pass)throw Error('Camera hydration never started');
   await wait(20);await js(`(async()=>{const detail={promises:[]};window.dispatchEvent(new CustomEvent('camera-flush',{detail}));if(!detail.promises.length)throw Error('Camera flush listener is missing');await Promise.all(detail.promises)})()`);
   const result=JSON.parse(fs.readFileSync(file,'utf8'));if(JSON.stringify(result[0].strokes)!==JSON.stringify(saved[0].strokes)||result[0].name!==saved[0].name)throw Error('A flush during hydration overwrote saved camera ink');
  }
  const invalid='[]';fs.writeFileSync(file,invalid);const loaded=new Promise(resolve=>w.webContents.once('did-finish-load',resolve));w.webContents.reload();await loaded;for(let n=0;n<100&&loads<3;n++)await wait(20);await wait(20);
  const failure=await js(`(async()=>{const detail={promises:[]};window.dispatchEvent(new CustomEvent('camera-flush',{detail}));try{await Promise.all(detail.promises);return null}catch(error){return error.message}})()`);
  if(!failure?.includes('invalid structure')||fs.readFileSync(file,'utf8')!==invalid)throw Error('Invalid camera data was overwritten or allowed to flush');
  console.log('Camera flush waits for hydration after mount/remount, preserves saved ink and rejects invalid data');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});});
require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve('src'),'main.cjs'));setTimeout(()=>app.exit(1),15000).unref();
