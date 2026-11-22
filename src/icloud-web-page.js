// The Notepads on the Web page (src/icloud-web.html): Apple ID sign-in and the writes of src/icloud-web.cjs, through
// Apple's CloudKit JS. src/icloud-web-bridge.cjs loads it as a data: page given the seancheren.com origin that the CloudKit
// web token allows, in its own session, so the sign-in it keeps belongs to NoteMind alone. It writes the records it is
// handed and reads nothing back; the only things it shows are the sign-in and a one-line summary.
(function(root){
 'use strict';
 const doc=root.document,bridge=root.notemindWeb,$=id=>doc.getElementById(id);
 const config=JSON.parse($('notemind-web-config').textContent);
 let db=null,identity=null,error=null,summary=null,started=false;

 const describe=e=>{
  if(!e)return 'iCloud did not say why.';
  const code=e.ckErrorCode||e.serverErrorCode||'';
  return (code?code+': ':'')+(e.reason||e.message||String(e));
 };
 const send=()=>bridge.state({signedIn:!!identity,appleId:identity?String(identity.userRecordName||'signed-in'):null,error});

 function ago(time){
  const seconds=Math.max(0,Math.round((Date.now()-time)/1000));
  if(seconds<60)return 'just now';
  const minutes=Math.round(seconds/60);if(minutes<60)return minutes+(minutes===1?' minute ago':' minutes ago');
  const hours=Math.round(minutes/60);if(hours<48)return hours+(hours===1?' hour ago':' hours ago');
  return new Date(time).toLocaleDateString();
 }
 function render(){
  const status=$('notemind-web-status'),problem=$('notemind-web-error');
  if(!started)status.textContent='Starting…';
  else if(!db)status.textContent='iCloud is not reachable right now.';
  else if(!identity)status.textContent='Sign in with your Apple ID to put your Notepads on the web.';
  else if(summary&&summary.notepads)status.textContent='Signed in. '+summary.notepads+(summary.notepads===1?' Notepad is':' Notepads are')+' on the web'+(summary.published?', updated '+ago(summary.published):'')+'.';
  else status.textContent='Signed in. Your Notepads are being sent to iCloud.';
  problem.textContent=error||'';problem.hidden=!error;
  $('notemind-web-sign-in').hidden=!!identity;
  $('notemind-web-sign-out').hidden=!identity;
  $('notemind-web-reader').hidden=!identity;
 }

 /** CloudKit answers a whole batch at once; any error but "already gone" (when deleting) fails the request. */
 function check(response,{missingOk=false}={}){
  if(!response||!response.hasErrors)return;
  const real=(response.errors||[]).filter(e=>!(missingOk&&/NOT_FOUND|UNKNOWN_ITEM/.test(e.ckErrorCode||e.serverErrorCode||'')));
  if(real.length)throw real[0];
 }
 async function run(job){
  if(!db||!identity)throw Error('Not signed in to iCloud.');
  if(job.op==='save'){
   const record={recordType:job.record.recordType,recordName:job.record.recordName,fields:{}};
   for(const [key,value] of Object.entries(job.record.fields||{}))record.fields[key]={value};
   if(job.record.file)record.fields.file={value:new root.File([job.record.file.bytes],job.record.file.name,{type:'application/octet-stream'})};
   const batch=db.newRecordsBatch();
   batch.forceReplace(record);
   check(await batch.commit());
   return;
  }
  if(job.op==='remove'){
   for(let i=0;i<job.names.length;i+=200){
    const batch=db.newRecordsBatch();
    for(const recordName of job.names.slice(i,i+200))batch.forceDelete({recordName});
    check(await batch.commit(),{missingOk:true});
   }
   return;
  }
  throw Error('NoteMind asked for something this page does not do.');
 }
 bridge.onJob(job=>{run(job).then(()=>bridge.result({id:job.id,ok:true}),e=>bridge.result({id:job.id,ok:false,error:describe(e)}));});
 bridge.onSummary(next=>{summary=next;render();});
 $('notemind-web-reader').addEventListener('click',()=>bridge.openReader());

 async function start(){
  const CloudKit=root.CloudKit;
  try{
   if(!CloudKit)throw Error('CloudKit could not load. Check the internet connection.');
   const dark=!!(root.matchMedia&&root.matchMedia('(prefers-color-scheme: dark)').matches);
   CloudKit.configure({containers:[{
    containerIdentifier:config.container,
    apiTokenAuth:{apiToken:config.apiToken,persist:true,signInButton:{id:'notemind-web-sign-in',theme:dark?'white':'black'},signOutButton:{id:'notemind-web-sign-out',theme:dark?'black':'white-with-outline'}},
    environment:config.environment,
   }]});
   const container=CloudKit.getDefaultContainer();
   db=container.privateCloudDatabase;
   identity=(await container.setUpAuth())||null;
   const watchIn=()=>container.whenUserSignsIn().then(found=>{identity=found||{userRecordName:'signed-in'};error=null;render();send();watchOut();}).catch(()=>{});
   const watchOut=()=>container.whenUserSignsOut().then(()=>{identity=null;render();send();return container.setUpAuth().then(()=>watchIn());}).catch(()=>{});
   if(identity)watchOut();else watchIn();
  }catch(e){error=describe(e);}
  started=true;
  render();send();
 }
 render();
 void start();
})(typeof window!=='undefined'?window:globalThis);
