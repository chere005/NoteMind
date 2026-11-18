// The product viewer never owns these oracle canvases or full RGBA readbacks.
// Each image uses an independent renderer, and the next image waits for its PID.
const fs=require('node:fs/promises'),native=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url'),{createHash,randomUUID}=require('node:crypto');
const AUTHORITY_SHA='1690a249b7b7c7340850c51b2d913a67b3fccba8d0a11dfbde889f40525229bb',AUTHORITY_BYTES=93893;
const HTML='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src file: blob:; connect-src file:; script-src \'none\'"><title>Owned pixel oracle</title>';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)}),same=(stat,owned)=>String(stat.dev)===owned.dev&&String(stat.ino)===owned.ino;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),kernelAlive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});promise.catch(()=>{});return{promise,resolve,reject};}
async function loadAuthority(file){
 const handle=await fs.open(file,native.constants.O_RDONLY|(native.constants.O_NOFOLLOW||0)|(native.constants.O_NONBLOCK||0));let bytes;
 try{const before=await handle.stat({bigint:true});if(!before.isFile()||before.size!==BigInt(AUTHORITY_BYTES))throw Error('The fixed original pixel authority changed.');bytes=Buffer.allocUnsafeSlow(AUTHORITY_BYTES);let at=0;while(at<bytes.length){const part=await handle.read(bytes,at,bytes.length-at,at);if(!part.bytesRead)throw Error('The original pixel authority was truncated.');at+=part.bytesRead;}const after=await handle.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});if(!named.isFile()||named.isSymbolicLink()||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]||before[key]!==named[key])||sha(bytes)!==AUTHORITY_SHA)throw Error('The fixed original pixel authority changed.');const value=JSON.parse(bytes.toString('utf8'));if(!value.ok||value.rows?.length!==100)throw Error('The original pixel authority is incomplete.');return value.rows.map((row,index)=>{if(row.index!==index||!/^[a-f0-9]{64}$/.test(row.sourceSha256)||!/^[a-f0-9]{64}$/.test(row.hashes?.[0])||row.width!==1800||row.height!==2400)throw Error('Invalid original pixel authority row.');return{sourceSHA:row.sourceSha256,cpuSHA:row.hashes[0]};});}
 finally{if(bytes?.byteLength)bytes.buffer.transfer(0);await handle.close();}
}
async function createOracleFolder(tempRoot){
 if(!path.isAbsolute(tempRoot||''))throw Error('Pixel oracle requires its owned profile folder.');
 const directory=await fs.mkdtemp(path.join(tempRoot,'word-pixel-oracle-')),real=await fs.realpath(directory),directoryIdentity=identity(await fs.lstat(directory,{bigint:true})),file=path.join(directory,'oracle.html');let owned,stamp;
 const assertDirectory=async()=>{const stat=await fs.lstat(directory,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||!same(stat,directoryIdentity)||await fs.realpath(directory)!==real)throw Error('Pixel oracle directory ownership changed.');};
 try{const handle=await fs.open(file,'wx',0o600);try{owned=identity(await handle.stat({bigint:true}));await handle.writeFile(HTML);stamp=await handle.stat({bigint:true});}finally{await handle.close();}}
 catch(error){await assertDirectory();if(owned){const stat=await fs.lstat(file,{bigint:true}).catch(missing=>{if(missing.code!=='ENOENT')throw missing});if(stat?.isFile()&&!stat.isSymbolicLink()&&same(stat,owned))await fs.unlink(file);}await fs.rmdir(directory).catch(failure=>{if(failure.code!=='ENOTEMPTY')throw failure});throw error;}
 const validate=async()=>{await assertDirectory();const handle=await fs.open(file,native.constants.O_RDONLY|(native.constants.O_NOFOLLOW||0)|(native.constants.O_NONBLOCK||0));let bytes;try{const before=await handle.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});if(!before.isFile()||!named.isFile()||named.isSymbolicLink()||['dev','ino','size'].some(key=>before[key]!==stamp[key])||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==named[key]))throw Error('Pixel oracle shell ownership changed.');bytes=Buffer.allocUnsafeSlow(Buffer.byteLength(HTML));const read=await handle.read(bytes,0,bytes.length,0),after=await handle.stat({bigint:true}),last=await fs.lstat(file,{bigint:true});if(read.bytesRead!==bytes.length||bytes.toString('utf8')!==HTML||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]||before[key]!==last[key]))throw Error('Pixel oracle shell content changed.');}finally{if(bytes?.byteLength)bytes.buffer.transfer(0);await handle.close();}};
 return{file,directory,validate,async cleanup(){await assertDirectory();let stat;try{stat=await fs.lstat(file,{bigint:true});}catch(error){if(error.code!=='ENOENT')throw error;}if(stat){await validate();await fs.unlink(file);}try{await fs.rmdir(directory);}catch(error){if(error.code==='ENOTEMPTY')throw Error('Pixel oracle folder contains an unowned file.');throw error;}}};
}
async function stopOwnedRenderer(record,{app,sample=()=>{},isAlive=kernelAlive,wait=pause,now=Date.now,timeoutMs=15000}={}){
 const {win,contents}=record;let pid=record.pid;if(!Number.isSafeInteger(pid)||pid<=0)try{pid=contents.getOSProcessId();if(Number.isSafeInteger(pid)&&pid>0)record.pid=pid;}catch{}
 if(!win.isDestroyed())win.destroy();if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Pixel oracle has no captured renderer PID.');const began=now();let observationError;
 for(;;){const running=isAlive(pid),listed=app.getAppMetrics().some(row=>row.pid===pid);if(!running&&!listed)break;if(now()-began>=timeoutMs)throw Error('Pixel oracle renderer exit could not be confirmed.');try{await sample()}catch(error){observationError ||=error;}await wait(10);}
 contents.removeAllListeners?.();const receipt={pid,exited:true,exitWallMs:now()-began};if(observationError){observationError.rendererExitReceipt=receipt;throw observationError;}return receipt;
}
async function createWordPixelOracle({app,BrowserWindow,authorityFile,tempRoot,sample=()=>{},onRow}={}){
 if(!app||typeof BrowserWindow!=='function'||typeof sample!=='function')throw Error('Pixel oracle services are missing.');
 const authority=await loadAuthority(authorityFile),folder=await createOracleFolder(tempRoot);let active=null,pendingStop=null,closed=false,broken=null,closing;
 const stop=job=>{if(job.stop)return job.stop;job.stop=stopOwnedRenderer(job,{app,sample}).then(value=>{job.row={...job.row,...value};if(pendingStop===job)pendingStop=null;return value},error=>{job.stop=null;if(error.rendererExitReceipt){job.row={...job.row,...error.rendererExitReceipt};if(pendingStop===job)pendingStop=null;}else pendingStop=job;throw error;});return job.stop;};
 async function run(job,index,url,expected){
  let timer,operationError,row={index,url,sourceSha256:expected.sourceSHA,exited:false};job.row=row;
  try{
   await sample();if(closed)throw Error('Pixel oracle closed.');await folder.validate();const previous=new Set(app.getAppMetrics().map(value=>value.pid)),partition='word-pixel-oracle-'+randomUUID();
   const win=job.win=new BrowserWindow({show:false,focusable:false,webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}}),contents=job.contents=win.webContents;
   win.show=win.showInactive=win.focus=()=>{};contents.setWindowOpenHandler?.(()=>({action:'deny'}));const deny=event=>event.preventDefault?.();contents.on('will-navigate',deny);contents.on('will-redirect',deny);contents.on('will-attach-webview',deny);const session=job.session=contents.session;job.download=(_event,item)=>item.cancel();session?.setPermissionRequestHandler?.((_contents,_permission,callback)=>callback(false));session?.setPermissionCheckHandler?.(()=>false);session?.on?.('will-download',job.download);
   const capture=()=>{try{const pid=contents.getOSProcessId();if(Number.isSafeInteger(pid)&&pid>0){if(previous.has(pid))throw Error('Pixel oracle did not receive an independent renderer.');if(job.pid&&job.pid!==pid)throw Error('Pixel oracle renderer identity changed.');job.pid=pid;job.row.pid=pid;}}catch(error){job.fail(error);}};
   for(const event of ['did-start-loading','dom-ready','did-finish-load'])contents.on(event,capture);
   let sampling=false;timer=setInterval(()=>{if(sampling)return;sampling=true;Promise.resolve().then(sample).catch(job.fail).finally(()=>sampling=false);},50);
   await Promise.race([win.loadFile(folder.file),job.aborted.promise]);capture();if(job.failure)throw job.failure;if(!job.pid)throw Error('Pixel oracle renderer was not captured.');
   row=await Promise.race([contents.executeJavaScript(`(async()=>{
    const url=${JSON.stringify(url)},image=new Image(),reference=new Image(),canvases=[];let bytes,blobURL;
    const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const decode=async image=>{await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Original oracle image did not decode.')),20000))]);if(image.naturalWidth!==1800||image.naturalHeight!==2400)throw Error('Original oracle dimensions changed.');};
    const pixels=async(image,cpu)=>{const canvas=document.createElement('canvas');canvases.push(canvas);canvas.width=1800;canvas.height=2400;let data;try{const context=canvas.getContext('2d',cpu?{willReadFrequently:true}:{});context.drawImage(image,0,0);data=context.getImageData(0,0,1800,2400).data;return await hash(data);}finally{if(data?.byteLength)data.buffer.transfer(0);canvas.width=canvas.height=0;}};
    try{image.src=url;await decode(image);const cpuSHA=await pixels(image,true),displaySHA=await pixels(image,false);bytes=await(await fetch(url)).arrayBuffer();const sourceSHA=await hash(bytes),blob=new Blob([bytes],{type:'image/jpeg'});bytes.transfer(0);bytes=null;blobURL=URL.createObjectURL(blob);reference.src=blobURL;await decode(reference);const referenceSHA=await pixels(reference,false);return{cpuSHA,displaySHA,referenceSHA,sourceSHA,width:image.naturalWidth,height:image.naturalHeight,referenceWidth:reference.naturalWidth,referenceHeight:reference.naturalHeight};}
    finally{if(bytes?.byteLength)bytes.transfer(0);image.removeAttribute('src');reference.removeAttribute('src');if(blobURL)URL.revokeObjectURL(blobURL);for(const canvas of canvases)canvas.width=canvas.height=0;}
   })()`),job.aborted.promise]);
   job.row={...job.row,...row};if(job.failure)throw job.failure;if(row.sourceSHA!==expected.sourceSHA||row.cpuSHA!==expected.cpuSHA||row.displaySHA!==row.referenceSHA)throw Error('Original Word source bytes or full-resolution pixels changed.');await sample();if(job.failure)throw job.failure;
  }catch(error){operationError=error;}
  finally{
   clearInterval(timer);
   if(job.win){try{await stop(job);}catch(error){operationError ||=error;}}
   if(job.row.exited){job.session?.removeListener?.('will-download',job.download);job.session?.setPermissionRequestHandler?.(null);job.session?.setPermissionCheckHandler?.(null);}
   if(active===job)active=null;
  }
  if(operationError){broken=operationError;operationError.oracleRow={...job.row,error:operationError.message};throw operationError;}return job.row;
 }
 function verify({index,url,sourceSha256}={}){
  if(closed||broken)return Promise.reject(broken||Error('Pixel oracle closed.'));if(active)return Promise.reject(Error('A pixel oracle is already active.'));
  const expected=authority[index];try{if(!Number.isSafeInteger(index)||index<0||!expected||sourceSha256!==expected.sourceSHA)throw Error('Pixel oracle source does not match its frozen index.');const parsed=new URL(url);if(parsed.protocol!=='file:'||parsed.host&&parsed.host!=='localhost'||!path.isAbsolute(fileURLToPath(parsed)))throw Error('Pixel oracle needs the managed original file URL.');}catch(error){return Promise.reject(error);}
  const aborted=deferred(),job={aborted,pid:null,win:null,stop:null,row:null};job.fail=error=>{job.failure ||=error;aborted.reject(error);if(job.win&&!job.win.isDestroyed()){try{const pid=job.contents.getOSProcessId();if(!job.pid&&Number.isSafeInteger(pid)&&pid>0)job.pid=pid;}catch{}job.win.destroy();}};active=job;job.work=run(job,index,url,expected);
  return job.work.then(async row=>{await onRow?.(row);return row},async error=>{if(error.oracleRow)await onRow?.(error.oracleRow);throw error;});
 }
 function close(){if(closing)return closing;closed=true;closing=(async()=>{const job=active;if(job){job.fail(Error('Pixel oracle closed.'));await job.work.catch(()=>{});}if(pendingStop)await stop(pendingStop);await folder.cleanup();})().catch(error=>{closing=null;throw error;});return closing;}
 return{verify,close,authority:{sha256:AUTHORITY_SHA,rows:authority.length},directory:folder.directory};
}
module.exports={createWordPixelOracle,stopOwnedRenderer,createOracleFolder};
