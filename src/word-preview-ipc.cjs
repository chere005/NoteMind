const {WordPreviewSessions}=require('./word-preview-sessions.cjs');
const abortError=()=>Object.assign(Error('Word preview cancelled.'),{name:'AbortError'});
function registerWordPreviewIPC({ipcMain,tempRoot,withForeground,allowedOwner=()=>true,createSessions=options=>new WordPreviewSessions(options)}){
 let sessions,closed=false,stopping;const owners=new Map();
 const service=()=>sessions ||=createSessions({tempRoot,withForeground,onInvalidated:(owner,token,error)=>{if(!owner.isDestroyed?.())owner.send?.('word-preview-invalidated',{token,message:error?.message||'This Word preview has closed.'});}});
 const state=owner=>{if(closed||owner.isDestroyed?.()||!allowedOwner(owner))throw Error('This document display has closed.');let value=owners.get(owner);if(!value){value={requests:new Map()};value.destroyed=()=>{for(const request of value.requests.values())request.abort();void sessions?.releaseOwner(owner).catch(()=>{});owners.delete(owner);};owners.set(owner,value);owner.once?.('destroyed',value.destroyed);}return value;};
 const request=async(owner,options,run)=>{const value=state(owner),id=options?.requestId;if(typeof id!=='string'||!id||id.length>128)throw Error('Invalid Word preview request.');if(value.requests.has(id))throw Error('This Word preview request is already running.');const controller=new AbortController();value.requests.set(id,controller);try{const result=await run(service(),{signal:controller.signal,requestId:id});if(controller.signal.aborted||closed||owner.isDestroyed?.()){if(result?.kind==='docx'&&result.token)await sessions?.release(owner,result.token);throw abortError();}return result;}finally{value.requests.delete(id);}};
 ipcMain.handle('word-preview-open',(event,file,options)=>request(event.sender,options,(jobs,scope)=>jobs.open(event.sender,file,scope)));
 for(const operation of ['segment','asset','link'])ipcMain.handle('word-preview-'+operation,(event,token,id,options)=>request(event.sender,options,(jobs,scope)=>jobs[operation](event.sender,token,id,scope)));
 ipcMain.handle('word-preview-attribute',(event,token,id,options)=>request(event.sender,options,(jobs,scope)=>jobs.attribute(event.sender,token,id,{...scope,offset:options?.offset,maxBytes:options?.maxBytes})));
 ipcMain.handle('word-preview-cancel',(event,id)=>{const value=owners.get(event.sender),controller=value?.requests.get(id);controller?.abort();return !!controller;});
 ipcMain.handle('word-preview-release',(event,token)=>{state(event.sender);return sessions?.release(event.sender,token)||false;});
 return {started:()=>!!sessions,dispose(){if(stopping)return stopping;closed=true;for(const [owner,value]of owners){owner.removeListener?.('destroyed',value.destroyed);for(const controller of value.requests.values())controller.abort();}owners.clear();return stopping=Promise.resolve().then(()=>sessions?.dispose());}};
}
module.exports={registerWordPreviewIPC};
