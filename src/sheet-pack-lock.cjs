// Active append packs hold an inode lease. A dead process cannot leave a stale lease.
let binding;
function posix(){if(binding!==undefined)return binding;try{const koffi=require('koffi'),library=koffi.load(process.platform==='darwin'?'/usr/lib/libSystem.B.dylib':'libc.so.6');binding={flock:library.func('int flock(int fd, int operation)'),errno:()=>koffi.errno()};}catch{binding=null;}return binding;}
async function leasePack(file,handle){
 if(process.platform==='darwin'||process.platform==='linux'){const api=posix();if(!api)return null;if(api.flock(handle.fd,6)!==0){const code=api.errno();if([4,11,35].includes(code))return null;throw Error('Drawing pack lock failed ('+code+').');}let closed=false;return async()=>{if(!closed){closed=true;api.flock(handle.fd,8);}};}
 if(process.platform==='win32'){const {runWithNativeLock,nativeLockCapability}=require('./native-file-lock.cjs');if(!nativeLockCapability().available)return null;let enter,finish;const entered=new Promise(resolve=>enter=resolve),done=new Promise(resolve=>finish=resolve);const run=runWithNativeLock(file,async()=>{enter(true);await done;},{requireNative:true,maxWaitMs:1}).catch(error=>{if(error.code==='NOTEMIND_LOCK_BUSY')enter(false);else{enter(false);throw error;}});void run.catch(()=>{});if(!await entered)return null;return async()=>{finish();await run;};}
 return null;
}
module.exports={leasePack};
