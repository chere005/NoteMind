module.exports=function installDocumentAssetIPC(ipcMain,assets){
 ipcMain.handle('document-asset-upload-begin',(event,header)=>assets.beginUpload(event.sender,header));
 ipcMain.handle('document-asset-upload-write',(event,upload,part)=>assets.writeUpload(event.sender,upload,part));
 ipcMain.handle('document-asset-upload-finish',(event,upload)=>assets.finishUpload(event.sender,upload));
 ipcMain.handle('document-asset-upload-cancel',(event,upload)=>assets.cancelUpload(event.sender,upload));
 ipcMain.handle('document-asset-read',(event,transfer,token,offset,options)=>assets.readAsset(event.sender,transfer,token,offset,options));
 ipcMain.handle('document-asset-ack',(event,transfer,receipt)=>assets.ackRead(event.sender,transfer,receipt));
 ipcMain.handle('document-asset-release',(event,transfer,options)=>assets.releaseRead(event.sender,transfer,options));
 ipcMain.handle('document-asset-adopt',(event,transfer)=>assets.adoptRead(event.sender,transfer));
 ipcMain.handle('document-asset-hold-release',(event,id)=>assets.releaseHold(event.sender,id));
 ipcMain.handle('document-asset-receiver-open',(event,bytes,options)=>assets.openReceiver(event.sender,bytes,options));
 ipcMain.handle('document-asset-reference-open',(event,id,options)=>assets.openReference(event.sender,id,options));
 ipcMain.handle('document-asset-reference-finish',(event,handle)=>assets.finishReference(event.sender,handle));
 ipcMain.handle('document-asset-reference-cancel',(event,id,options)=>assets.cancelReference(event.sender,id,options));
};
