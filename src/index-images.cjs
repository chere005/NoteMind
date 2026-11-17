const {randomUUID}=require('node:crypto');
const {digest}=require('./notes-store.cjs');
const {mime}=require('./document-renderer.cjs');
function inputs(doc){return [...Object.entries(doc.assets||{}).filter(([name])=>mime(name)&&!name.endsWith('.preview.png')), ...Object.entries(doc.meta?.attachments||{}).filter(([,info])=>info?.text).map(([name,info])=>[name,info.text])];}
function sameInputs(a,b){return a.length===b.length&&a.every(([name,data],i)=>name===b[i][0]&&data===b[i][1]);}
function sameValues(a,b){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(name=>a[name]?.hash===b[name]?.hash&&a[name]?.text===b[name]?.text);}
// One image-reading run per note. A newer image snapshot supersedes old work;
// ordinary typing joins the current run rather than restarting its OCR.
function createIndexer({store,documentIO,send}){
 const pending=new Map();
 return function indexDocument(event,doc,options={}){
  const request={event,doc,inputs:inputs(doc),background:!event||options.background===true},existing=pending.get(doc.id);
  if(existing){
   const last=existing.next||existing.current;
   if(!sameInputs(last.inputs,request.inputs)||(last.background&&!request.background)){
    existing.next=request;existing.controller?.abort();
   }
   return existing.promise;
  }
  const state={next:request,current:request,controller:null,promise:null};pending.set(doc.id,state);
  state.promise=(async()=>{
   let stored=await store.ocrCache(doc.id);const cached={...stored};
   while(state.next){
    const {event,doc,background}=state.current=state.next;state.next=null;
    const controller=state.controller=new AbortController(),values={},errors=[];
    for(const [name,data]of Object.entries(doc.assets||{})){
     if(controller.signal.aborted)break;
     if(!mime(name)||name.endsWith('.preview.png'))continue;
     const hash=digest(Buffer.from(data,'base64'));
     if(cached[name]?.hash===hash){values[name]=cached[name];continue;}
     try{
      if(event?.sender&&!event.sender.isDestroyed())event.sender.send('notes:index-progress',{id:doc.id,name});
      const converted=await documentIO.call('image',data,mime(name));
      if(controller.signal.aborted)break;
      const value=await documentIO.reader.read(Buffer.from(converted.data,'base64'),{id:'index-'+randomUUID(),language:'auto',priority:background?'background':'foreground',signal:controller.signal});
      values[name]=cached[name]={hash,text:value.text};
     }catch(error){if(controller.signal.aborted)break;errors.push(name+': '+error.message);}
    }
    if(state.next)continue;
    for(const [name,info]of Object.entries(doc.meta?.attachments||{}))if(info?.text)values[name]={hash:digest(info.text),text:info.text};
    const changed=!sameValues(stored,values);
    if(changed){await store.indexText(doc.id,values);stored=values;}
    if(state.next)continue;
    if(changed)send();return {count:Object.keys(values).length,errors};
   }
  })().finally(()=>{if(pending.get(doc.id)===state)pending.delete(doc.id);});
  return state.promise;
 };
}
module.exports={createIndexer};
