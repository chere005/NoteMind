const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {physicalPath}=require('./path-key.cjs');
const backends=new Map(),queues=new Map();
const hash=value=>createHash('sha256').update(value).digest('hex');
const owner=()=>typeof process.getuid==='function'?String(process.getuid()):hash(os.userInfo().username).slice(0,16);
const defaultRegistry=()=>path.join(os.tmpdir(),'notemind-locks-v1-'+owner());
const busy=()=>Object.assign(Error('This file is being saved in another window. Your draft is safe.'),{code:'NOTEMIND_LOCK_BUSY'});
function backendFor(platform){
 if(backends.has(platform))return backends.get(platform);
 let binding;
 try{
  const koffi=require('koffi');
  if(platform==='darwin'||platform==='linux'){
   const library=koffi.load(platform==='darwin'?'/usr/lib/libSystem.B.dylib':'libc.so.6');
   binding={backend:'flock',library,flock:library.func('int flock(int fd, int operation)'),errno:()=>koffi.errno()};
  }else if(platform==='win32'){
   const library=koffi.load('kernel32.dll');
   binding={backend:'win32-mutex',library,
    create:library.func('void* __stdcall CreateMutexW(void* attributes, int initialOwner, const uint16_t* name)'),
    wait:library.func('uint32_t __stdcall WaitForSingleObject(void* handle, uint32_t milliseconds)'),
    release:library.func('int __stdcall ReleaseMutex(void* handle)'),
    close:library.func('int __stdcall CloseHandle(void* handle)'),
    lastError:library.func('uint32_t __stdcall GetLastError()')};
  }else binding={backend:'portable',reason:'Native file locking is unavailable on '+platform};
 }catch(error){binding={backend:'portable',reason:'Native file locking could not load: '+error.message};}
 backends.set(platform,binding);return binding;
}
function selected(options){return Object.hasOwn(options,'bindings')?options.bindings:backendFor(options.platform||process.platform);}
function nativeLockCapability(options={}){
 const binding=selected(options);
 return binding&&binding.backend!=='portable'?{available:true,backend:binding.backend}:{available:false,backend:'portable',reason:binding?.reason||'Native file locking was explicitly disabled.'};
}
function identity(file,options){const platform=options.platform||process.platform,physical=physicalPath(file),name=platform==='win32'?physical.toLowerCase():physical;return {key:hash(name),registry:options.registry||defaultRegistry(),platform};}
function waitFor(promise,deadline){
 const left=deadline-Date.now();if(left<=0)return Promise.reject(busy());
 let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(busy()),left);})]).finally(()=>clearTimeout(timer));
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function acquire(id,binding,deadline,pollMs){
 if(binding.backend==='flock'){
  await fs.mkdir(id.registry,{recursive:true,mode:0o700});
  // Every cooperating process opens this same inode. Never remove or rename registry entries.
  const handle=await fs.open(path.join(id.registry,id.key+'.lock'),'a+',0o600);let locked=false;
  try{
   while(!locked){
    if(binding.flock(handle.fd,6)===0){locked=true;break;}
    const error=binding.errno();if(![4,11,35].includes(error))throw Object.assign(Error('Native file lock failed ('+error+').'),{code:'NOTEMIND_NATIVE_LOCK_FAILED'});
    if(Date.now()>=deadline)throw busy();await pause(Math.min(pollMs,Math.max(1,deadline-Date.now())));
   }
  }catch(error){await handle.close();throw error;}
  return async()=>{try{binding.flock(handle.fd,8);}finally{await handle.close();}};
 }
 if(binding.backend==='win32-mutex'){
  const name=Buffer.from('Global\\NoteMindFileLock-v1-'+owner()+'-'+id.key+'\0','utf16le'),handle=binding.create(null,0,name);let locked=false;
  if(!handle)throw Object.assign(Error('Native file mutex could not open ('+(binding.lastError?.()??'unknown')+').'),{code:'NOTEMIND_NATIVE_LOCK_FAILED'});
  try{
   while(!locked){
    const result=binding.wait(handle,0);
    if(result===0||result===128){locked=true;break;}
    if(result!==258)throw Object.assign(Error('Native file mutex failed ('+(binding.lastError?.()??result)+').'),{code:'NOTEMIND_NATIVE_LOCK_FAILED'});
    if(Date.now()>=deadline)throw busy();await pause(Math.min(pollMs,Math.max(1,deadline-Date.now())));
   }
  }catch(error){binding.close(handle);throw error;}
  return async()=>{try{if(!binding.release(handle))throw Error('Native file mutex could not release.');}finally{binding.close(handle);}};
 }
 throw Error('Unknown native file lock backend.');
}
async function runWithNativeLock(file,run,options={}){
 const binding=selected(options),capability=nativeLockCapability(options);options.onCapability?.(capability);
 if(!capability.available){if(options.requireNative)throw Object.assign(Error(capability.reason),{code:'NOTEMIND_NATIVE_LOCK_UNAVAILABLE'});return run();}
 const id=identity(file,options),queueKey=binding.backend==='win32-mutex'?'win32:'+owner()+':'+id.key:id.platform+':'+id.registry+':'+id.key,deadline=Date.now()+(options.maxWaitMs??5000),pollMs=Math.max(1,options.pollMs??20);
 // Windows mutexes are recursive for one OS thread. Serialize asynchronous JS owners too.
 const previous=queues.get(queueKey)||Promise.resolve();let finish;
 const gate=new Promise(resolve=>finish=resolve),tail=previous.catch(()=>{}).then(()=>gate);queues.set(queueKey,tail);
 void tail.then(()=>{if(queues.get(queueKey)===tail)queues.delete(queueKey);});
 let release;
 try{await waitFor(previous,deadline);release=await acquire(id,binding,deadline,pollMs);return await run();}
 finally{try{await release?.();}finally{finish();}}
}
module.exports={runWithNativeLock,nativeLockCapability};
