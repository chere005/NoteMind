const fs=require('node:fs/promises'),{runWithNativeLock}=require('../../src/native-file-lock.cjs');
const [file,registry,mode]=process.argv.slice(2);
process.send({type:'attempting'});
runWithNativeLock(file,async()=>{
 if(mode==='replace'){const temp=file+'.replacement';await fs.writeFile(temp,'replacement');await fs.rename(temp,file);}
 process.send({type:'entered'});
 await new Promise(resolve=>process.on('message',message=>{if(message==='release')resolve();}));
},{registry,requireNative:true,maxWaitMs:3000,pollMs:5}).then(()=>{process.send({type:'released'});process.disconnect();},error=>{process.send({type:'error',message:error.message,code:error.code});process.exitCode=1;process.disconnect();});
