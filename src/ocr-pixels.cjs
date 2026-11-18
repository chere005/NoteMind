const {createHash}=require('node:crypto'),{isMarkedAsUntransferable}=require('node:worker_threads');
// Only the private index converter may lend an exact transferable RGBA backing.
// This is separate from the public PNG API and its existing cache namespace.
function validatePixels(value,{owned=false}={}){
 const width=value?.width,height=value?.height,data=value?.data;
 if(!Number.isSafeInteger(width)||width<1||width>32768||!Number.isSafeInteger(height)||height<1||height>32768||width*height>16000000||!(data instanceof Uint8Array||data instanceof Uint8ClampedArray)||data.byteLength!==width*height*4)throw Error('The text reader needs exact RGBA pixels.');
 if(owned&&(!(data.buffer instanceof ArrayBuffer)||data.byteOffset||data.byteLength!==data.buffer.byteLength||isMarkedAsUntransferable(data.buffer)||typeof data.buffer.transfer!=='function'))throw Error('The private text reader needs an exclusively owned pixel backing.');
 return{width,height,data};
}
function pixelKey(pixels,language){return createHash('sha256').update('notemind-index-rgba8\0'+pixels.width+','+pixels.height+'\0').update(pixels.data).update('\0'+language).digest('hex');}
module.exports={validatePixels,pixelKey};
