// Test-only alternative to large advanced-IPC frames. Never a product backend.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
function fileProcessClass(Base){
 return class FileProcessWorker extends Base{
  constructor(options){
   const directory=fs.mkdtempSync(path.join(options.tempRoot,'ocr-file-process-'));
   try{super({...options,env:{...(options.env||process.env),NOTEMIND_OCR_FILE_DIRECTORY:directory}});}catch(error){fs.rmdirSync(directory);throw error;}
   this.fileDirectory=directory;this.files=new Map();this.writes=new Set();this.fileFailures=[];
  }
  sendInput(){
   const ledger=this.ledger;if(!ledger||ledger.sent||this.stopping)return;ledger.sent=true;this.transport.sent++;
   const name=`input-${ledger.sequence}.bin`,file=path.join(this.fileDirectory,name),record={file,name,sequence:ledger.sequence,metadata:null,removing:null};this.files.set(ledger.sequence,record);
   let pending;pending=Promise.resolve().then(async()=>{
    const disk=await fsp.statfs(this.fileDirectory);if(disk.bavail*disk.bsize<2*1024**3+ledger.buffer.byteLength)throw Error('Preserve the unchanged 2 GiB free-space floor.');
    let handle;try{handle=await fsp.open(file,'wx',0o600);await handle.writeFile(new Uint8Array(ledger.buffer));const stat=await handle.stat();record.metadata={dev:stat.dev,ino:stat.ino,bytes:stat.size};}finally{await handle?.close();}
    if(this.stopping||this.exited)return;
    this.send({type:'read',generation:this.generation,sequence:ledger.sequence,input:ledger.input,control:ledger.control,file:{name,...record.metadata}});
   }).finally(()=>this.writes.delete(pending));this.writes.add(pending);void pending.catch(error=>this.fail(error));
  }
  receive(message){
   const sequence=this.ledger?.sequence,received=this.transport.received;super.receive(message);
   if(this.transport.received!==received){const record=this.files.get(sequence);if(record)void this.removeInput(record).catch(error=>{this.fileFailures.push(error.message);this.fail(error);});}
  }
  removeInput(record){
   if(record.removing)return record.removing;
   return record.removing=Promise.resolve().then(async()=>{let stat;try{stat=await fsp.lstat(record.file);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(stat){if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||record.metadata&&(stat.dev!==record.metadata.dev||stat.ino!==record.metadata.ino))throw Error('Owned OCR file identity changed.');await fsp.unlink(record.file);}
    this.files.delete(record.sequence);
   }).catch(error=>{record.removing=null;throw error;});
  }
  actualExit(code,signal){
   if(this.fileExitJoining||this.exited)return;this.fileExitJoining=true;
   // The write borrows Main's private backing. Actual process exit alone must
   // not detach/decharge that backing before every accepted write has settled.
   void Promise.resolve().then(async()=>{
    await Promise.allSettled([...(this.writes||[])]);
    const results=await Promise.allSettled([...(this.files?.values()||[])].map(record=>this.removeInput(record)));
    for(const result of results)if(result.status==='rejected')this.fileFailures.push(result.reason.message);
    if(this.fileDirectory&&!this.files.size)try{await fsp.rmdir(this.fileDirectory);}catch(error){this.fileFailures.push(error.message);}
   }).catch(error=>this.fileFailures.push(error.message)).finally(()=>super.actualExit(code,signal));
  }
  snapshot(){return{...super.snapshot(),fileTransport:{directory:this.fileDirectory,pendingWrites:this.writes?.size||0,files:this.files?.size||0,failures:[...(this.fileFailures||[])],actualExitAfterWrites:true}};}
 };
}
module.exports={fileProcessClass};
