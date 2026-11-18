'use strict';
const realFs=require('node:fs'),path=require('node:path');
const sameInode=(a,b)=>!!a&&!!b&&a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a,b)=>sameInode(a,b)&&['mode','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const absent=(fs,name)=>{try{return fs.lstatSync(name,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}};
function directory(fs,folder,create=false){
 const absolute=path.resolve(folder),parts=absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean);let current=path.parse(absolute).root;
 for(const part of parts){current=path.join(current,part);let stat=absent(fs,current);if(!stat&&create){fs.mkdirSync(current);stat=fs.lstatSync(current,{bigint:true});}if(!stat||stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe runtime directory: '+current);}
 return fs.lstatSync(absolute,{bigint:true});
}
function regular(fs,name){const stat=fs.lstatSync(name,{bigint:true});if(stat.isSymbolicLink()||!stat.isFile())throw Error('Runtime file is not a regular file: '+name);return stat;}
function target(fs,name){const stat=absent(fs,name);if(stat&&(stat.isSymbolicLink()||!stat.isFile()))throw Error('Unsafe runtime target: '+name);return stat;}
function closeOwned(fs,fd,receipt){if(fd===null)return;let current;try{current=fs.fstatSync(fd,{bigint:true});}catch(error){if(error.code==='EBADF')return;throw error;}if(!sameInode(current,receipt))throw Error('Runtime descriptor ownership changed.');fs.closeSync(fd);}
function copyAtomic(fs,source,destination,buffer){
 const parent=path.dirname(destination),parentReceipt=directory(fs,parent,true),sourceReceipt=regular(fs,source),priorTarget=target(fs,destination);let sourceFD=null,outputFD=null,outputReceipt=null,staging=null,stagingReceipt=null,staged=null,error=null;
 try{
  const constants=fs.constants||realFs.constants;sourceFD=fs.openSync(source,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const opened=fs.fstatSync(sourceFD,{bigint:true});if(!sameFile(opened,sourceReceipt)||!opened.isFile())throw Error('Runtime source changed before copying: '+source);
  staging=fs.mkdtempSync(path.join(parent,'notemind-runtime-stage-'));stagingReceipt=fs.lstatSync(staging,{bigint:true});if(stagingReceipt.isSymbolicLink()||!stagingReceipt.isDirectory())throw Error('Runtime staging authority is unavailable.');staged=path.join(staging,'entry');outputFD=fs.openSync(staged,'wx',0o600);outputReceipt=fs.fstatSync(outputFD,{bigint:true});if(!outputReceipt.isFile())throw Error('Invalid private runtime staging file.');
  let offset=0;for(;;){const count=fs.readSync(sourceFD,buffer,0,buffer.length,null);if(!count)break;let written=0;while(written<count){const amount=fs.writeSync(outputFD,buffer,written,count-written,null);if(!Number.isSafeInteger(amount)||amount<=0)throw Error('Runtime staging write made no progress.');written+=amount;}offset+=count;}
  if(BigInt(offset)!==sourceReceipt.size||!sameFile(fs.fstatSync(sourceFD,{bigint:true}),sourceReceipt)||!sameFile(regular(fs,source),sourceReceipt))throw Error('Runtime source changed while copying: '+source);
  fs.fchmodSync(outputFD,Number(sourceReceipt.mode&0o7777n));fs.fsyncSync(outputFD);closeOwned(fs,outputFD,outputReceipt);outputFD=null;closeOwned(fs,sourceFD,sourceReceipt);sourceFD=null;
  if(!sameInode(directory(fs,parent),parentReceipt))throw Error('Runtime destination directory changed.');const currentTarget=target(fs,destination);if(priorTarget?!sameFile(priorTarget,currentTarget):currentTarget!==null)throw Error('Runtime destination changed while copying: '+destination);
  if(!sameInode(fs.lstatSync(staging,{bigint:true}),stagingReceipt)||!sameInode(regular(fs,staged),outputReceipt))throw Error('Runtime staging ownership changed.');
  fs.renameSync(staged,destination);staged=null;
 }catch(failure){error=failure;}
 finally{
  const cleanup=[];
  for(const [fd,receipt]of [[outputFD,outputReceipt],[sourceFD,sourceReceipt]])if(fd!==null&&receipt)try{closeOwned(fs,fd,receipt);}catch(failure){cleanup.push(failure);}
  if(staged&&outputReceipt)try{const current=absent(fs,staged);if(current){if(!current.isFile()||current.isSymbolicLink()||!sameInode(current,outputReceipt))throw Error('Refusing foreign runtime staging file cleanup: '+staged);fs.unlinkSync(staged);}}catch(failure){cleanup.push(failure);}
  if(staging&&stagingReceipt)try{const current=absent(fs,staging);if(current){if(!current.isDirectory()||current.isSymbolicLink()||!sameInode(current,stagingReceipt))throw Error('Refusing foreign runtime staging directory cleanup: '+staging);fs.rmdirSync(staging);}}catch(failure){cleanup.push(failure);}
  if(cleanup.length){if(error)error.cleanupErrors=cleanup;else error=new AggregateError(cleanup,'Runtime staging cleanup failed.');}if(error&&staging)error.stagingPath=staging;
 }
 if(error)throw error;
}
function refreshPortableRuntime(runtime,destination,fs=realFs){
 const source=path.resolve(runtime),output=path.resolve(destination);if(source===output||source.startsWith(output+path.sep)||output.startsWith(source+path.sep))throw Error('Runtime source and destination overlap.');directory(fs,source);directory(fs,output,true);const buffer=Buffer.alloc(196608);let files=0;
 try{const visit=(from,to)=>{const receipt=directory(fs,from);directory(fs,to,true);for(const name of fs.readdirSync(from)){const input=path.join(from,name),target=path.join(to,name),stat=fs.lstatSync(input,{bigint:true});if(stat.isSymbolicLink())throw Error('Runtime source contains a symlink: '+input);if(stat.isDirectory())visit(input,target);else if(stat.isFile()){copyAtomic(fs,input,target,buffer);files++;}else throw Error('Runtime source contains a nonregular entry: '+input);}if(!sameInode(directory(fs,from),receipt))throw Error('Runtime source directory changed: '+from);};visit(source,output);return{files};}finally{buffer.buffer.transfer?.(0);}
}
function refreshEntry(destination,sourceName,entryName,fs){const root=path.resolve(destination);directory(fs,root);const buffer=Buffer.alloc(196608);try{copyAtomic(fs,path.join(root,sourceName),path.join(root,entryName),buffer);}finally{buffer.buffer.transfer?.(0);}}
const refreshLinuxEntry=(destination,fs=realFs)=>refreshEntry(destination,'electron','NoteMind',fs);
const refreshWindowsEntry=(destination,fs=realFs)=>refreshEntry(destination,'electron.exe','NoteMind.exe',fs);
module.exports={refreshPortableRuntime,refreshLinuxEntry,refreshWindowsEntry};
