// Index-only worker prototype. An acknowledged result releases image resources;
// the caller must continue charging the persistent worker's execution context.
(function (scope) {
 let active=null;
 const unsupported=()=>Object.assign(Error('This image needs the document image converter.'),{code:'IMAGE_WORKER_UNSUPPORTED'});
 const discard=value=>{if(!(value instanceof ArrayBuffer)||!value.byteLength)return true;if(typeof value.transfer==='function')try{value.transfer(0);return !value.byteLength}catch{}return false;};
 async function convert(packet,check){
  if(!Number.isSafeInteger(packet?.id)||packet.id<1||!(packet.bytes instanceof ArrayBuffer)||!packet.bytes.byteLength||packet.bytes.byteLength>50*1024*1024)throw Error('Invalid index image input.');
  if(packet.clean||packet.type==='image/svg+xml'||typeof scope.OffscreenCanvas!=='function'||typeof scope.createImageBitmap!=='function')throw unsupported();
  const limit=Number.isInteger(packet.maxDimension)?Math.max(16,Math.min(4096,packet.maxDimension)):2400,dimensions=packet.dimensions;
  let image,canvas,blob,output,resultBytes,published=false;
  try{
   check();
   blob=new Blob([packet.bytes],{type:packet.type});
   if(dimensions){
    if(!Number.isFinite(dimensions.width)||dimensions.width<=0||!Number.isFinite(dimensions.height)||dimensions.height<=0||dimensions.width>1000000||dimensions.height>1000000)throw Error('Invalid image dimensions.');
    const scale=Math.min(1,limit/Math.max(dimensions.width,dimensions.height));
    try{image=await scope.createImageBitmap(blob,{resizeWidth:Math.max(1,Math.round(dimensions.width*scale)),resizeHeight:Math.max(1,Math.round(dimensions.height*scale)),resizeQuality:'high'})}catch{}
   }
   check();if(!image)try{image=await scope.createImageBitmap(blob)}catch{throw unsupported()}check();
   const scale=Math.min(1,limit/Math.max(image.width,image.height)),width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
   canvas=new scope.OffscreenCanvas(width,height);canvas.getContext('2d').drawImage(image,0,0,width,height);image.close();image=null;check();
   output=await canvas.convertToBlob({type:'image/png'});
   check();resultBytes=await output.arrayBuffer();check();
   if(resultBytes.byteLength>50*1024*1024)throw Error('Image conversion exceeds its output limit.');
   published=true;return{bytes:resultBytes,width,height};
  }finally{
   let failed;
   try{image?.close?.()}catch(error){failed=error;}
   try{if(canvas){canvas.width=0;canvas.height=0;}}catch(error){failed ||=error;}
   if(!discard(packet.bytes))failed ||=Error('Image input backing could not be released.');
   if(!published&&!discard(resultBytes))failed ||=Error('Image output backing could not be released.');
   packet.bytes=null;image=canvas=blob=output=null;
   if(failed){failed.resourcesReleased=false;throw failed;}
  }
 }
 scope.onmessage=async event=>{
  const packet=event.data;
  if(packet?.cancel){if(active?.id===packet.cancel)active.cancelled=true;return;}
  if(active){scope.postMessage({id:packet?.id,error:{message:'An index image is already converting.'},released:false});return;}
  const job=active={id:packet?.id,cancelled:false},check=()=>{if(job.cancelled)throw Object.assign(Error('Image conversion cancelled.'),{name:'AbortError'});};
  try{const value=await convert(packet,check);scope.postMessage({id:packet.id,...value,released:true},[value.bytes]);}
  catch(error){const released=discard(packet?.bytes)&&error?.resourcesReleased!==false;if(packet)packet.bytes=null;scope.postMessage({id:packet?.id,error:{message:error?.message||String(error),name:error?.name,code:error?.code},released});}
  finally{if(active===job)active=null;}
 };
})(self);
