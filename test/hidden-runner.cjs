require('./disable-native-pen.cjs');
// Run an Electron test without showing or focusing any of its windows.
const electron=require('electron'),Module=require('node:module'),path=require('node:path');
if(process.platform==='darwin')electron.app.dock.hide();
const load=Module._load;Module._load=function(request,parent,isMain){const result=load.call(this,request,parent,isMain);return request==='electron'?{...result,BrowserWindow:class extends result.BrowserWindow{constructor(options){super({...options,show:false});let visible=options?.show!==false;this.show=this.showInactive=()=>{visible=true};this.hide=()=>{visible=false};this.isVisible=()=>visible;this.focus=()=>{};}}}:result;};
const name=process.argv[2];if(!/^[\w-]+$/.test(name||''))throw Error('Choose a test by name.');require(path.join(__dirname,name+'.cjs'));
