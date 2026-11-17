import {collectCameraScans} from '../../camera-scan-pages.js'
import {CameraProcessing,pngBlobDataURL} from './cameraProcessing'

// Kept scans read and render one compact page at a time without hydrating
// every saved page's editable points in the UI.
;(window as any).notemindScanPages=async(options:any={})=>{
 const detail={promises:[]};window.dispatchEvent(new CustomEvent('camera-flush',{detail}));await Promise.all(detail.promises)
 const processor=new CameraProcessing()
 try{return await collectCameraScans((window as any).notemind,{...options,render:(packet:any,settings:any)=>processor.runCompact(packet,settings),encode:pngBlobDataURL})}
 finally{processor.dispose()}
}
