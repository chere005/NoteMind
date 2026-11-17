// Tests do not open or seize the user's physical pen; answer the optional pen API harmlessly.
process.env.NOTEMIND_PEN='off';process.env.NOTEMIND_TEST_NO_PAD='1';
const {ipcMain,app,dialog}=require('electron');
process.on('uncaughtException',error=>{console.error(error.stack||error);app.exit(1);});
process.on('unhandledRejection',error=>{console.error(error?.stack||error);app.exit(1);});
app.commandLine.appendSwitch('disable-video-capture-use-gpu-memory-buffer');
dialog.showMessageBoxSync=(_window,options)=>{console.error('Unexpected test dialog: '+options.message+' '+(options.detail||''));app.exit(1);return 0;};
for(const name of ['pen:buttons-get','pen:open','pen:close','pen:status','pen:settings','pen:settings-set','pen:mapping-retry'])ipcMain.handle(name,()=>null);
