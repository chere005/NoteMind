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
 const sync=(window as any).NoteMindDocumentSync
 let data,type,chunks,assets,name
 if(typeof image==='string'){
  const match=/^data:(image\/(?:png|jpeg|gif|webp|bmp|avif|svg\+xml));base64,/.exec(image.slice(0,128));if(!match)throw Error('Invalid scan image.');type=match[1];data=image.slice(match[0].length)
 }else{
  type=(window as any).NoteMindDocument.mime(image?.name);assets=image?.assets;name=image?.name;data=assets&&Object.hasOwn(assets,name)?assets[name]:image?.data;chunks=assets?sync?.assetChunks?.(assets,name):undefined
 }
 const process=async(blob:Blob)=>{
  const processor=new CameraProcessing()
  try{const result=await processor.runImage(blob,{rotation,signal,thumbnail:true,thumbnailOnly});if(result.blob.size>50*1024*1024)throw Error('The prepared scan image exceeds the 50 MiB image limit.');const data=await pngBlobDataURL(result.blob,{signal});return {data,thumbnail:result.thumbnail?await pngBlobDataURL(result.thumbnail,{signal}):thumbnailOnly?data:undefined}}
  finally{processor.dispose()}
 }
 if(assets&&typeof sync?.withAssetBytes==='function'){
  if(type==='image/png'||type==='image/jpeg')return (window as any).NoteMindScanLimits.withSourceImage(assets,name,{signal},(bytes:Uint8Array)=>process(new Blob([bytes],{type})))
  return sync.withAssetBytes(assets,name,{signal},(bytes:Uint8Array)=>process(new Blob([bytes],{type})))
 }
 if(typeof data!=='string')throw Error('The selected scan image is unavailable.')
 return process(await scanImageBlob(data,type,{chunks:chunks||undefined,signal}))
}
