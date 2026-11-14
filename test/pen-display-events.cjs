// Exercise the pen and mouse event paths in an invisible Electron window.
const {app,BrowserWindow}=require('electron'),esbuild=require('esbuild'),path=require('node:path');
if(process.platform==='darwin')app.dock.hide();app.disableHardwareAcceleration();
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:false,nodeIntegration:true}});try{
 await w.loadURL('data:text/html,<html><body><button id="target">test</button></body></html>');
 const output=await esbuild.build({stdin:{contents:`export {installPenActions,registerPenHandlers} from './src/tablet/renderer/penActions.ts';export {setNativeButtons} from './src/tablet/renderer/nativeButtons.ts';export {watchPen} from './src/tablet/renderer/penSettings.ts';export {watchLive,heldSlot,heldAction} from './src/tablet/renderer/penLive.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'iife',globalName:'PenTest',write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}});
 await w.webContents.executeJavaScript(`window.notemind={preferenceGet:async()=>null,preferenceSet:async()=>{},onPreference:()=>{}};Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem:()=>{}}});void 0;`);
 await w.webContents.executeJavaScript(output.outputFiles[0].text+"\n;void 0;");
 const result=await w.webContents.executeJavaScript(`(()=>{PenTest.watchPen();PenTest.watchLive();PenTest.installPenActions();let undo=0,redo=0,near=0,far=0;PenTest.registerPenHandlers({undo:()=>undo++,redo:()=>redo++});const base={present:true,range:true,tip:false,lower:false,upper:false};PenTest.setNativeButtons(base);window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'pen',pointerId:7,clientX:100,clientY:100,bubbles:true}));
 for(let i=0;i<2;i++){PenTest.setNativeButtons({...base,lower:true});PenTest.setNativeButtons(base)}
 for(let i=0;i<2;i++){PenTest.setNativeButtons({...base,upper:true});PenTest.setNativeButtons(base)}
 PenTest.setNativeButtons({...base,upper:true});if(PenTest.heldSlot()!=='lower'||PenTest.heldAction()!=='select')throw Error('Second-button feedback is incorrect');
 PenTest.setNativeButtons({...base,lower:true});if(PenTest.heldSlot()!=='upper'||PenTest.heldAction()!=='erase')throw Error('First-button feedback is incorrect');
 document.body.addEventListener('mousedown',e=>{if(e.clientX<200)near++;else far++});document.body.dispatchEvent(new MouseEvent('mousedown',{button:2,clientX:102,clientY:100,bubbles:true,cancelable:true}));document.body.dispatchEvent(new MouseEvent('mousedown',{button:2,clientX:500,clientY:500,bubbles:true,cancelable:true}));return {undo,redo,near,far}})()`);
 require('node:assert/strict').deepEqual(result,{undo:1,redo:1,near:0,far:1});console.log('Pen display: first/second holds, double taps, live feedback and independent mouse events passed');w.destroy();app.exit(0);
 }catch(e){console.error(e);w.destroy();app.exit(1)}}).catch(e=>{console.error(e);app.exit(1)});
