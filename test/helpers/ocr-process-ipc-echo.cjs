// Tiny system-Node IPC authority only; never imports OCR/model/native runtimes.
const {decodeInput}=require('./ocr-native-process.cjs');
process.once('message',frame=>{let response;try{const {packet,ack}=decodeInput(frame,frame.generation),view=packet.pixels?.data||packet.bytes;response={nodeOnly:true,electron:!!process.versions.electron,ack,byteOffset:view.byteOffset,byteLength:view.byteLength,backingLength:view.buffer.byteLength};}catch(error){response={error:error.message};process.exitCode=1;}process.send(response,error=>{if(error)process.exitCode=1;process.disconnect();});});
