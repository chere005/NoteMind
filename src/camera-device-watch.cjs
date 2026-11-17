// Touch media services only while a camera workflow needs hot-plug updates.
function watchCameraDevices(getMediaDevices,enabled,changed){
 if(!enabled)return()=>{};
 const media=getMediaDevices();if(!media?.addEventListener)return()=>{};
 media.addEventListener('devicechange',changed);let closed=false;
 return()=>{if(closed)return;closed=true;media.removeEventListener?.('devicechange',changed);};
}
module.exports={watchCameraDevices};
