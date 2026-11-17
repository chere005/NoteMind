import {collectCameraScans} from '../../camera-scan-pages.js'
import {CameraProcessing,pngBlobDataURL} from './cameraProcessing'
import {scanImageBlob} from '../../scan-image-blob.js'

// Kept scans read and render one compact page at a time without hydrating
// every saved page's editable points in the UI.
;(window as any).notemindScanPages=async(options:any={})=>{
 const detail={promises:[]};window.dispatchEvent(new CustomEvent('camera-flush',{detail}));await Promise.all(detail.promises)
 const processor=new CameraProcessing()
 try{return await collectCameraScans((window as any).notemind,{...options,render:(packet:any,settings:any)=>processor.runCompact(packet,settings),encode:pngBlobDataURL})}
 finally{processor.dispose()}
}

// Conversion/rotation encodes in a private worker; the UI retains only source
// strings/chunk references and the resulting small thumbnail.
;(window as any).notemindScanImage=async(image:any,{rotation=0,signal,thumbnailOnly=false}:any={})=>{
 let data,type,chunks
 if(typeof image==='string'){
  const match=/^data:(image\/(?:png|jpeg|gif|webp|bmp|avif|svg\+xml));base64,/.exec(image.slice(0,128));if(!match)throw Error('Invalid scan image.');type=match[1];data=image.slice(match[0].length)
 }else{
  type=(window as any).NoteMindDocument.mime(image?.name);data=image?.data;chunks=image?.assets?(window as any).NoteMindDocumentSync?.assetChunks(image.assets,image.name):undefined
 }
 const blob=await scanImageBlob(data,type,{chunks:chunks||undefined,signal}),processor=new CameraProcessing()
 try{const result=await processor.runImage(blob,{rotation,signal,thumbnail:true,thumbnailOnly});if(result.blob.size>50*1024*1024)throw Error('The prepared scan image exceeds the 50 MiB image limit.');const data=await pngBlobDataURL(result.blob,{signal});return {data,thumbnail:result.thumbnail?await pngBlobDataURL(result.thumbnail,{signal}):thumbnailOnly?data:undefined}}
 finally{processor.dispose()}
}
