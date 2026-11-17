const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('notemindPDFWorker',{onRequest(fn){const receive=(_event,value)=>fn(value);ipcRenderer.on('pdf-reference:request',receive);return()=>ipcRenderer.removeListener('pdf-reference:request',receive);},reply:value=>ipcRenderer.send('pdf-reference:reply',value)});
