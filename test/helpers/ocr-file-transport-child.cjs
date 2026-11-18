// Headless transport attribution only: no OCR models, canvas, cache or GC calls.
const {decodeInput}=require(process.env.NOTEMIND_NATIVE_PROCESS_HELPER),{fileFrame}=require('./ocr-file-input.cjs'),generation=process.env.NOTEMIND_NATIVE_PROCESS_GENERATION;
let active=false;
process.on('message',async frame=>{if(active)throw Error('Input overlap.');active=true;try{
 const before=process.memoryUsage(),decoded=process.env.NOTEMIND_OCR_FILE_DIRECTORY?await fileFrame(frame,process.env.NOTEMIND_OCR_FILE_DIRECTORY):frame,{packet,ack}=decodeInput(decoded,generation),owned=process.memoryUsage();
 process.send(ack);const buffer=packet.pixels.data.buffer;buffer.transfer(0);const after=process.memoryUsage();
 process.send({type:'result',generation,sequence:frame.sequence,id:packet.id,packet:{id:packet.id,lines:[],pixelsReleased:true,diagnostic:{before,owned,after,sha256:ack.sha256}}});
 }finally{active=false;}});
process.send({type:'ready',generation,workerSHA:'transport-only-no-models'});
