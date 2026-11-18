// Destruction requests are not process-exit acknowledgements. A failed stop keeps
// its quota owner pending and prevents replacement until that exact PID exits.
const task=()=>new Promise(resolve=>setTimeout(resolve,10)),stopping=new Map();
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
function stopConverter(window,{isAlive=alive,wait=task,now=Date.now,timeoutMs=5000,pid:capturedPID}={}){
 let pid=capturedPID;if(pid===undefined)try{pid=window.webContents.getOSProcessId()}catch{}
 if(!Number.isSafeInteger(pid)||pid<=0){if(!window.isDestroyed())window.destroy();return Promise.resolve();}
 const existing=stopping.get(pid);if(existing)return existing.promise;
 const record={failed:null,promise:null};stopping.set(pid,record);try{if(!window.isDestroyed())window.destroy()}catch(error){record.failed=error;}
 record.promise=(async()=>{const started=now();for(;;){let running=true;try{running=isAlive(pid)}catch(error){record.failed ||=error;}if(!running)break;if(now()-started>=timeoutMs)record.failed ||= Error('The previous image converter has not stopped.');try{await wait()}catch(error){record.failed ||=error;await task();}}stopping.delete(pid);if(record.failed)throw record.failed;})();return record.promise;
}
async function beforeConverter(){for(const record of stopping.values())if(record.failed)throw record.failed;await Promise.all([...stopping.values()].map(record=>record.promise));}
async function drainConverters(){await Promise.allSettled([...stopping.values()].map(record=>record.promise));}
module.exports={stopConverter,beforeConverter,drainConverters};
