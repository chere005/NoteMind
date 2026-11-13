require('./disable-native-pen.cjs');
// Invisible app instance for the multi-process project-window check.
const electron=require('electron'),Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
if(process.platform==='darwin')electron.app.dock.hide();
process.on('SIGTERM',()=>electron.app.exit(0));
const original=Module._load;
Module._load=function(request,parent,isMain){const loaded=original.call(this,request,parent,isMain);if(request!=='electron')return loaded;return {...loaded,BrowserWindow:class extends loaded.BrowserWindow{constructor(options){super({...options,show:false});this.show=()=>{};this.focus=()=>{};}}};};
electron.app.disableHardwareAcceleration();
electron.app.on('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',()=>fs.writeFileSync(path.join(process.env.NOTEMIND_DATA,'test-ready'),String(process.pid))));
electron.app.on('second-instance',()=>fs.writeFileSync(path.join(process.env.NOTEMIND_DATA,'test-focused'),String(process.pid)));
require(path.join(process.env.NOTEMIND_TEST_APP||path.resolve(__dirname,'../src'),'main.cjs'));
