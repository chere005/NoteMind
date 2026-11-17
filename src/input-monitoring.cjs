const SETTINGS='x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';

function createInputMonitoring({shell,helper,execFile=require('node:child_process').execFile,platform=process.platform,onError=()=>{}}){
 let attempted=false,inflight=null;
 const report=error=>{try{onError(error);}catch{}};
 function check(){
  return new Promise((resolve,reject)=>{
   if(!helper){reject(Error('The Input Monitoring helper is unavailable.'));return;}
   execFile(helper,['--request-access'],{timeout:10000,encoding:'utf8',maxBuffer:65536,windowsHide:true},(error,stdout)=>{
    if(error){reject(error);return;}
    let access=null;
    for(const line of String(stdout||'').split(/\r?\n/)){
     try{const value=JSON.parse(line);if(value?.k==='access'&&['granted','denied','undecided'].includes(value.v))access=value.v;}catch{}
    }
    if(access)resolve(access);else reject(Error('The Input Monitoring helper did not report its access status.'));
   });
  });
 }
 function request(){
  if(platform!=='darwin')return Promise.resolve({access:'unknown',openedSettings:false});
  if(inflight)return inflight;
  attempted=true;
  inflight=Promise.resolve().then(async()=>{
   let access='unknown';try{access=await check();}catch(error){report(error);}
   if(access==='granted')return {access,openedSettings:false};
   try{await shell.openExternal(SETTINGS);return {access,openedSettings:true};}catch(error){report(error);return {access,openedSettings:false};}
  }).finally(()=>{inflight=null;});
  return inflight;
 }
 function onStatus(status){
  if(status?.state!=='needs-input-monitoring')return null;
  if(attempted)return inflight;
  return request();
 }
 return {onStatus,request};
}

module.exports={createInputMonitoring};
