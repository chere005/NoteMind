const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
async function fileFrame(frame,directory){
 const {input,file}=frame||{};
 if(frame?.type!=='read'||frame.buffer!==undefined||!Number.isSafeInteger(frame.sequence)||frame.sequence<1||file?.name!==`input-${frame.sequence}.bin`||!Number.isSafeInteger(input?.bytes)||input.bytes<1||input.bytes>64*1024*1024||file.bytes!==input.bytes||!Number.isSafeInteger(file.dev)||!Number.isSafeInteger(file.ino))throw Error('Invalid owned OCR file frame.');
 if(input.kind==='rgba'){if(!Number.isSafeInteger(input.width)||input.width<1||input.width>32768||!Number.isSafeInteger(input.height)||input.height<1||input.height>32768||input.width*input.height>16000000||input.bytes!==input.width*input.height*4)throw Error('Invalid owned OCR file pixels.');}
 else if(input.kind!=='png'||input.bytes>40*1024*1024)throw Error('Invalid owned OCR file image.');
 const parent=await fsp.lstat(directory);if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o077))throw Error('Invalid private OCR directory.');
 const handle=await fsp.open(path.join(directory,file.name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes,returned=false;
 try{const stat=await handle.stat();if(!stat.isFile()||stat.uid!==process.getuid()||stat.nlink!==1||stat.size!==input.bytes||stat.dev!==file.dev||stat.ino!==file.ino)throw Error('Owned OCR file identity mismatch.');
  bytes=Buffer.allocUnsafeSlow(input.bytes);for(let at=0;at<bytes.length;){const read=await handle.read(bytes,at,Math.min(196608,bytes.length-at),at);if(!read.bytesRead)throw Error('Owned OCR file ended early.');at+=read.bytesRead;}await handle.close();returned=true;return{...frame,buffer:bytes.buffer};
 }finally{if(!returned){try{await handle.close();}finally{if(bytes?.buffer.byteLength)bytes.buffer.transfer(0);}}}
}
module.exports={fileFrame};
