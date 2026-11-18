// Inspect bounded image metadata under the immutable file's held/named proof.
const {imageDimensions,mime}=require('./document-renderer.cjs');
const {jpegDimensions,svgDimensions}=require('./image-index-dimensions.cjs');
const {isMarkedAsUntransferable}=require('node:worker_threads');
async function inspectAssetSource(files,record,name){return files.inspect(record,async({handle,file,bytes})=>{const header=Buffer.allocUnsafeSlow(Math.min(65536,bytes));try{const read=await handle.read(header,0,header.length,0),prefix=header.subarray(0,read.bytesRead);let type=mime(name)||'',dimensions=null;
 if(prefix[0]===255&&prefix[1]===216){type='image/jpeg';dimensions=await jpegDimensions(handle,file,bytes);}
 else if(type==='image/svg+xml')dimensions=await svgDimensions(handle,file,bytes);
 else if(type)dimensions=imageDimensions(prefix);
 return{mime:type,binaryGraphics:prefix.length>=8&&prefix.subarray(0,8).toString('ascii')==='NMGFX2\r\n',...(dimensions||{})};
 }finally{if(!isMarkedAsUntransferable?.(header.buffer))try{header.buffer.transfer?.(0);}catch{}}});}
module.exports={inspectAssetSource};
