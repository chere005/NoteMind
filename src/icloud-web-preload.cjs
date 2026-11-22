'use strict';
// The Notepads on the Web page's only reach into NoteMind (src/icloud-web-bridge.cjs): it reports its sign-in state and
// the outcome of each request, receives requests and the summary it shows, and can ask to open the reader.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('notemindWeb',{
 state:value=>ipcRenderer.send('icloud-web:state',value),
 result:value=>ipcRenderer.send('icloud-web:result',value),
 upload:value=>ipcRenderer.invoke('icloud-web:upload',value),
 openReader:()=>ipcRenderer.send('icloud-web:open-reader'),
 onJob:fn=>{ipcRenderer.on('icloud-web:job',(_,job)=>fn(job));},
 onSummary:fn=>{ipcRenderer.on('icloud-web:summary',(_,summary)=>fn(summary));},
});
