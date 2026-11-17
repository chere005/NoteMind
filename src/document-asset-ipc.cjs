module.exports=function installDocumentAssetIPC(ipcMain,assets){
 ipcMain.handle('document-asset-upload-begin',(event,header)=>assets.beginUpload(event.sender,header));
 ipcMain.handle('document-asset-upload-write',(event,upload,part)=>assets.writeUpload(event.sender,upload,part));
 ipcMain.handle('document-asset-upload-finish',(event,upload)=>assets.finishUpload(event.sender,upload));
 ipcMain.handle('document-asset-upload-cancel',(event,upload)=>assets.cancelUpload(event.sender,upload));
 ipcMain.handle('document-asset-read',(event,transfer,token,offset,options)=>assets.readAsset(event.sender,transfer,token,offset,options));
 ipcMain.handle('document-asset-ack',(event,transfer,receipt)=>assets.ackRead(event.sender,transfer,receipt));
 ipcMain.handle('document-asset-release',(event,transfer)=>assets.releaseRead(event.sender,transfer));
};
