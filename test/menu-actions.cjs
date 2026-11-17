// Exercise click-only accessibility activation and pen settings without showing a window or touching hardware.
const {app,BrowserWindow}=require('electron'),esbuild=require('esbuild'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-menu-actions-'));app.setPath('userData',profile);app.disableHardwareAcceleration();if(process.platform==='darwin')app.dock.hide();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{contextIsolation:false,nodeIntegration:false}});win.webContents.setBackgroundThrottling(false);
 const js=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 try{
  await win.loadURL('data:text/html,<html><head><style>.float-menu,.pen-pop{position:fixed;background:white;padding:8px}.float-row>button{display:block;width:160px;height:28px}</style></head><body><input id="search" value="Keep this text"><div id="mount"></div></body></html>');
  await js(`window.__padState={enabled:true,available:true,owned:true};window.__calls=[];window.__picks=0;window.notemind={platform:'darwin',preferenceGet:async()=>null,preferenceSet:async()=>{},onPreference:()=>()=>{},pad:{state:async()=>window.__padState,onState:()=>()=>{},requestAccess:()=>{window.__calls.push('requestAccess');return new Promise((resolve,reject)=>{window.__resolveAccess=resolve;window.__rejectAccess=reject})},retry:async()=>{window.__calls.push('retry')}}};window.wm={pen:{}};Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem:()=>{}}});void 0`);
  const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MenuButton} from './src/tablet/renderer/MenuButton';import {PenSheet} from './src/tablet/renderer/PenMenu';const root=createRoot(document.getElementById('mount'));let serial=0;export function menu(){root.render(<MenuButton icon="more" name="Drawing options" title="Save, open and keep drawings" data={{tablet:'pane-menu'}} items={[{label:'Save Drawing',onClick:()=>window.__picks++}]}/>)}export function pen(){root.render(<PenSheet key={++serial} at={{top:60,right:8}} onClose={()=>root.render(null)}/>);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',format:'iife',globalName:'MenuFixture',write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}});
  await js(bundle.outputFiles[0].text+'\n;MenuFixture.menu();void 0');await pause(40);
  await js(`document.getElementById('search').focus();document.getElementById('search').setSelectionRange(5,9);document.querySelector('[data-tablet=pane-menu]').click();void 0`);await pause(100);
  assert.equal(await js(`document.querySelectorAll('.float-menu').length`),1,'a click with no pointerdown opens Drawing options');
  assert.equal(await js(`document.querySelector('[data-tablet=pane-menu]').getAttribute('aria-expanded')`),'true');
  assert.deepEqual(await js(`(()=>{const field=document.getElementById('search');return [field.selectionStart,field.selectionEnd]})()`),[5,9],'opening the menu preserves the existing text selection');
  await js(`document.querySelector('[data-menu-label="Save Drawing"]').click();void 0`);await pause(40);
  assert.equal(await js('window.__picks'),1);assert.equal(await js(`document.querySelectorAll('.float-menu').length`),0,'click-only menu actions run once and close');
  for(let i=0;i<2;i++){await js(`document.querySelector('[data-tablet=pane-menu]').click();void 0`);await pause(40)}
  assert.equal(await js(`document.querySelectorAll('.float-menu').length`),0,'two accessibility presses toggle the menu closed');
  await js(`MenuFixture.pen();void 0`);await pause(60);
  assert.equal(await js(`document.querySelectorAll('[data-pen=input-monitoring],[data-pen=retry-input]').length`),2,'available Wacom exposes its permission and retry controls in pen settings');
  await js(`document.querySelector('[data-pen=input-monitoring]').click();document.querySelector('[data-pen=input-monitoring]').click();void 0`);await pause(30);
  assert.deepEqual(await js('window.__calls'),['requestAccess'],'a pending permission request cannot be duplicated');
  assert.equal(await js(`[...document.querySelectorAll('.pen-input-actions button')].every(button=>button.disabled)`),true);
  await js(`window.__resolveAccess({access:'denied',openedSettings:true});void 0`);await pause(30);
  await js(`document.querySelector('[data-pen=retry-input]').click();void 0`);await pause(30);assert.deepEqual(await js('window.__calls'),['requestAccess','retry']);
  await js(`document.querySelector('[data-pen=input-monitoring]').click();void 0`);await pause(20);await js(`window.__rejectAccess(new Error('Fixture permission failure'));void 0`);await pause(30);
  assert.equal(await js(`document.querySelector('.pen-input-actions [role=alert]')?.textContent`),'Fixture permission failure');
  assert.equal(await js(`document.querySelector('[data-pen=retry-input]').disabled`),false,'an unsuccessful request keeps manual retry available');
  await js(`window.__padState={enabled:false,available:false,owned:false};MenuFixture.pen();void 0`);await pause(60);
  assert.equal(await js(`document.querySelectorAll('.pen-input-actions').length`),0,'unavailable Wacom does not expose permission actions');
  console.log('Menus: click-only activation, selection, action routing, toggles and isolated pen permission/retry controls passed.');win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1)}finally{fs.rmSync(profile,{recursive:true,force:true})}
}).catch(error=>{console.error(error);app.exit(1)});
setTimeout(()=>app.exit(1),15000).unref();
