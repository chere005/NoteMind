// Tests do not open or seize the user's physical pen; answer the optional pen API harmlessly.
process.env.NOTEMIND_PEN='off';process.env.NOTEMIND_TEST_NO_PAD='1';
const {ipcMain}=require('electron');
for(const name of ['pen:buttons-get','pen:open','pen:close','pen:status','pen:settings','pen:settings-set','pen:mapping-retry'])ipcMain.handle(name,()=>null);
