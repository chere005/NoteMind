const fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto'),{runWithNativeLock}=require('./native-file-lock.cjs'),graphics=require('./graphics-pane.js'),inkCodec=require('./pdf-ink-codec.cjs');
const HASH=/^[a-f0-9]{64}$/i,MAX_PAGE=150*1024*1024,MAX_SOURCE=150*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),missingSource=()=>Object.assign(Error('The PDF changed after it was opened.'),{code:'PDF_OPENED_BYTES_REQUIRED'});
async function atomic(file,bytes){const temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(temp,bytes,{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}
class PDFInkStore {
 constructor(root,{atomicWrite=atomic}={}){this.root=root;this.atomicWrite=atomicWrite;this.verified=new Map();}
 folder(identity,hash){if(typeof identity!=='string'||!identity||identity.length>8192||!HASH.test(hash))throw Error('Invalid PDF markup identity.');return path.join(this.root,'References',digest(identity),hash);}
 original(hash){if(!HASH.test(hash))throw Error('Invalid PDF source digest.');return path.join(this.root,'Originals',hash+'.pdf');}
 async read(identity,hash){
  const file=path.join(this.folder(identity,hash),'index.json');let value;try{const stat=await fs.stat(file);if(stat.size>5*1024*1024)throw Error('PDF markup index is too large.');value=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!value||value.version!==1||value.identity!==identity||value.sourceHash!==hash||!Number.isInteger(value.pageCount)||value.pageCount<1||value.pageCount>10000||!value.pages||typeof value.pages!=='object'||Array.isArray(value.pages))throw Error('PDF markup index is damaged.');
  for(const [number,page]of Object.entries(value.pages))if(String(Number(number))!==number||Number(number)<1||Number(number)>value.pageCount||(!HASH.test(page.revision)||page.file!==number+'-'+page.revision+'.ink'))throw Error('PDF markup page index is damaged.');return value;
 }
 async ensureOriginal(hash,{sourcePath,sourceBytes}={}){
  const file=this.original(hash);await fs.mkdir(path.dirname(file),{recursive:true});
  return runWithNativeLock(file,async()=>{
   const stat=await fs.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(stat){const before=this.verified.get(hash);if(before&&before.size===stat.size&&before.ino===stat.ino&&before.dev===stat.dev&&before.mtimeMs===stat.mtimeMs&&before.ctimeMs===stat.ctimeMs)return file;if(stat.size>MAX_SOURCE)throw Error('Stored PDF source is damaged.');const check=createHash('sha256');for await(const chunk of raw.createReadStream(file))check.update(chunk);if(check.digest('hex')!==hash)throw Error('Stored PDF source is damaged.');this.verified.set(hash,stat);return file;}
   const temp=file+'.'+randomUUID()+'.tmp';let handle,total=0;
   try{
    handle=await fs.open(temp,'wx');const check=createHash('sha256'),input=sourceBytes!==undefined?[sourceBytes]:sourcePath?raw.createReadStream(sourcePath):null;if(!input)throw missingSource();
    for await(const chunk of input){if(!(chunk instanceof Uint8Array))throw Error('Invalid original PDF bytes.');total+=chunk.byteLength;if(total>MAX_SOURCE)throw Error('The original PDF exceeds 150 MB.');check.update(chunk);await handle.writeFile(chunk);}
    if(check.digest('hex')!==hash)throw missingSource();await handle.close();handle=null;await fs.link(temp,file);this.verified.set(hash,await fs.stat(file));while(this.verified.size>128)this.verified.delete(this.verified.keys().next().value);return file;
   }catch(error){if(['ENOENT','EACCES','EPERM'].includes(error.code)&&sourceBytes===undefined)throw missingSource();throw error;}
   finally{await handle?.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});}
  });
 }
 async page(identity,hash,number){return runWithNativeLock(path.join(this.folder(identity,hash),'index.json'),async()=>{const index=await this.read(identity,hash);return this.readPage(index,number);});}
 async readPage(index,number){const entry=index?.pages[number];if(!entry)return null;const file=path.join(this.folder(index.identity,index.sourceHash),entry.file),stat=await fs.stat(file);if(stat.size>MAX_PAGE)throw Error('PDF ink page is too large.');const bytes=await fs.readFile(file);if(digest(bytes)!==entry.revision)throw Error('PDF ink page is damaged.');inkCodec.decode(bytes,{sourceHash:index.sourceHash,page:Number(number)});return {bytes,revision:entry.revision};}
 async all(identity,hash){return runWithNativeLock(path.join(this.folder(identity,hash),'index.json'),async()=>{const index=await this.read(identity,hash),pages={};if(!index)return null;for(const page of Object.keys(index.pages))pages[page]=await this.readPage(index,page);return {index,pages};});}
 async save({identity,sourceHash,pageCount,page,bytes,expectedRevision=null,sourcePath,sourceBytes,noteRevision=null}){
  if(!Number.isInteger(pageCount)||pageCount<1||pageCount>10000||!Number.isInteger(page)||page<1||page>pageCount||!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_PAGE||expectedRevision!==null&&!HASH.test(expectedRevision))throw Error('Invalid PDF ink update.');const folder=this.folder(identity,sourceHash);inkCodec.decode(bytes,{sourceHash,page});const original=await this.ensureOriginal(sourceHash,{sourcePath,sourceBytes}),file=path.join(folder,'index.json');await fs.mkdir(folder,{recursive:true});
  return runWithNativeLock(file,async()=>{
   const index=await this.read(identity,sourceHash)||{version:1,identity,sourceHash,pageCount,pages:{}};if(index.pageCount!==pageCount)throw Error('The PDF page count changed.');const previous=index.pages[page]?.revision||null;
   if(previous!==expectedRevision){const recovery=path.join(this.root,'Recovery',randomUUID()+'.ink');await this.atomicWrite(recovery,bytes);await this.atomicWrite(recovery+'.json',JSON.stringify({identity,sourceHash,page,pageCount,original,created:new Date().toISOString()}));throw Object.assign(Error('This PDF page was edited in another window. Your ink was preserved separately.'),{code:'PDF_INK_CONFLICT',recovery});}
   const revision=digest(bytes);if(previous===revision)return {revision,index,original};const previousFile=index.pages[page]?.file,nextFile=page+'-'+revision+'.ink',target=path.join(folder,nextFile);let existing;try{existing=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}if(existing){if(digest(existing)!==revision)throw Error('PDF ink page is damaged.');}else await this.atomicWrite(target,bytes);index.pages[page]={file:nextFile,revision,noteRevision:typeof noteRevision==='string'?noteRevision.slice(0,256):null};index.modified=new Date().toISOString();await this.atomicWrite(file,JSON.stringify(index));if(previousFile&&previousFile!==nextFile)await fs.unlink(path.join(folder,previousFile)).catch(()=>{});return {revision,index,original};
  });
 }
 async captureExport(identity,sourceHash){
  const folder=this.folder(identity,sourceHash);return runWithNativeLock(path.join(folder,'index.json'),async()=>{const index=await this.read(identity,sourceHash);if(!index)return null;const id=randomUUID(),directory=path.join(this.root,'Export Leases',id);await fs.mkdir(directory,{recursive:true});try{for(const entry of Object.values(index.pages))await fs.link(path.join(folder,entry.file),path.join(directory,entry.file));await atomic(path.join(directory,'index.json'),JSON.stringify(index));return{id,index};}catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}});
 }
 exportFolder(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid PDF export lease.');return path.join(this.root,'Export Leases',id);}
 async exportPage(lease,page){const entry=lease.index.pages[page];if(!entry)return[];const bytes=await fs.readFile(path.join(this.exportFolder(lease.id),entry.file));if(bytes.length>MAX_PAGE||digest(bytes)!==entry.revision)throw Error('PDF export ink is damaged.');return inkCodec.decode(bytes,{sourceHash:lease.index.sourceHash,page}).strokes;}
 releaseExport(id){return fs.rm(this.exportFolder(id),{recursive:true,force:true});}
 async previous(identity,currentHash){
  const directory=path.dirname(this.folder(identity,currentHash));let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}const result=[];
  for(const entry of entries){if(!entry.isDirectory()||!HASH.test(entry.name)||entry.name===currentHash)continue;const value=await this.read(identity,entry.name);if(value&&Object.keys(value.pages).length)result.push({sourceHash:entry.name,modified:value.modified,pageCount:value.pageCount,path:this.original(entry.name)});}
  return result.sort((a,b)=>(b.modified||'').localeCompare(a.modified||''));
 }
}
module.exports={PDFInkStore,digest,atomic};
