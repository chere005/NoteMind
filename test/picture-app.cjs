const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-picture-app-'));process.env.NOTEMIND_DATA=root;app.disableHardwareAcceleration();let tested=false;
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{if(tested)return;tested=true;const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=(fn,...a)=>w.webContents.executeJavaScript('('+fn.toString()+')('+a.map(JSON.stringify).join(',')+')');try{
 await wait(1000);const png=fs.readFileSync(path.join(__dirname,'fixtures/ocr-english.png'),'base64');await js(data=>{addTab({text:'![one](assets/a.png) and ![two](assets/a.png)',path:null,assets:{'assets/a.png':data},meta:{}});},png);await wait(300);
 const before=await js(()=>rich.querySelectorAll('img').length);if(before!==2)throw Error('Expected two uses of picture');await js(()=>rich.querySelector('img').click());
 if(!await js(()=>!document.querySelector('.picture-selection').hidden))throw Error('Picture selection not shown');await js(()=>document.querySelector('.picture-selection [data-rotate="90"]').click());await wait(200);
 const after=await js(()=>[...rich.querySelectorAll('img')].map(x=>x.dataset.asset));if(after[0]===after[1]||after[1]!=='assets/a.png')throw Error('Rotation changed the other use');
 await js(()=>NoteMindHistory.step());await wait(100);const undo=await js(()=>[...rich.querySelectorAll('img')].map(x=>x.dataset.asset));if(undo.some(x=>x!=='assets/a.png'))throw Error('Undo did not restore the original picture');
 await js(()=>NoteMindHistory.step(true));await wait(100);const redo=await js(()=>[...rich.querySelectorAll('img')].map(x=>x.dataset.asset));if(redo[0]===redo[1])throw Error('Redo did not restore the edit');
 console.log('Picture selection: independent edit, undo and redo passed');w.destroy();app.exit(0);
 }catch(e){console.error(e);w.destroy();app.exit(1);}finally{fs.rmSync(root,{recursive:true,force:true});}});});require('../src/main.cjs');setTimeout(()=>app.exit(1),30000).unref();
