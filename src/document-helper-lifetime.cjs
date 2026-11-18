// A destroyed hidden window may still own a live renderer process briefly.
// Keep the conversion lifetime until its exact process has actually exited.
const task=()=>new Promise(resolve=>setTimeout(resolve,10));
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
async function stopConverter(window,{isAlive=alive,wait=task,now=Date.now,timeoutMs=5000,pid:capturedPID}={}){
 let pid=capturedPID;if(pid===undefined)try{pid=window.webContents.getOSProcessId()}catch{}
 if(!window.isDestroyed())window.destroy();
 if(!Number.isSafeInteger(pid)||pid<=0)return;
 const started=now();while(isAlive(pid)){if(now()-started>=timeoutMs)throw Error('The previous image converter has not stopped.');await wait();}
}
module.exports={stopConverter};
