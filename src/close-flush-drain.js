// Close acknowledges one quiet durable boundary; input stays live while a pass saves.
const same=(a,b)=>a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
class SheetActions{
 constructor(){this.owners=new Map();this.metadataPending=new Set();this.metadataVersion=0}
 get size(){return this.owners.size}
 has(owner){return this.owners.has(owner)}
 add(owner){this.owners.set(owner,(this.owners.get(owner)||0)+1);return this}
 delete(owner){const count=this.owners.get(owner)||0;if(count>1)this.owners.set(owner,count-1);else this.owners.delete(owner);return count>0}
 [Symbol.iterator](){return this.owners.keys()}
 metadata(owner,run){this.add(owner);this.metadataVersion++;let work;try{work=Promise.resolve(run())}catch(error){this.delete(owner);this.metadataVersion++;throw error}const pending=work.finally(()=>{this.metadataPending.delete(pending);this.delete(owner);this.metadataVersion++});this.metadataPending.add(pending);return pending}
}
function syncClosePaper(sheets,owner,mode,persistence,value){if(!persistence?.loaded||persistence.loadFailed||mode?.source!=='tablet'||mode.documentId)return;const row=sheets.find(row=>row.page===owner);if(row&&row.loaded!==false)row.paper=value;}
function closeFlushState({sheets=[],sheetSnapshot=value=>value,camera=null,cameraSnapshot=value=>value,pdfs=null,notes=null,sheetActions=null,pendingInk=()=>false}={}){
 const state=[];
 const rows=(values,snapshot)=>{state.push(values.length);for(const row of values){const value=snapshot(row),{strokes,backdrop,...metadata}=value;state.push(row.page,value.pageId,strokes,strokes?.length||0,backdrop||null,pendingInk(row.page),row.page?.metadataVersion||0,!!row.page?.hasPendingMetadata,JSON.stringify(metadata));}};
 state.push(sheetActions?.metadataVersion||0,...(sheetActions?.metadataPending||[]));rows(sheets,sheetSnapshot);rows(camera?.models?.current||[],cameraSnapshot);state.push(camera?.state?.revision||0);const work=camera?.workRef?.current;state.push(work?.size||0,...(work||[]));
 state.push(pdfs?.values?.size||0);for(const[key,view]of pdfs?.values||[]){state.push(key,view,view.snapshot?.version||0);const models=view.refs?.models?.current;state.push(models?.size||0);for(const[number,value]of models||[]){const model=value.model;state.push(number,model,model?.strokes,model?.strokes?.length||0,model?.backdrop||null,model?.aspect,JSON.stringify(model?.extent),pendingInk(model),model?.metadataVersion||0,!!model?.hasPendingMetadata);}const pending=view.refs?.pendingActions?.current;state.push(pending?.size||0,...(pending||[]));}
 state.push(...(notes?.flushRevision?.()||[]));return state;
}
function watchCloseChanges({sheets,camera,pdfs,subscribeInk}={}){
 let revision=0,closed=false;const releases=[],owners=new Map(),views=new Map(),changed=()=>{revision++};
 const refresh=()=>{if(closed)return;const currentViews=new Set(pdfs?.values?.values()||[]);for(const[view,release]of views)if(!currentViews.has(view)){release();views.delete(view)}const current=new Set([...(sheets?.current||[]),...(camera?.models?.current||[])].map(row=>row.page));for(const view of currentViews){for(const value of view.refs?.models?.current?.values()||[])current.add(value.model);if(!views.has(view)){let version=view.snapshot?.version;views.set(view,view.subscribe?.(()=>{if(view.snapshot?.version!==version){version=view.snapshot?.version;changed()}refresh()})||(()=>{}));}}for(const[owner,release]of owners)if(!current.has(owner)){release();owners.delete(owner)}for(const owner of current)if(owner&&!owners.has(owner))owners.set(owner,owner.onChange?.(changed)||(()=>{}));};
 for(const models of [sheets,camera?.models])if(models?.subscribe)releases.push(models.subscribe(()=>{changed();refresh()}));if(subscribeInk)releases.push(subscribeInk(changed));refresh();
 return{revision:()=>{refresh();return revision},dispose(){if(closed)return;closed=true;for(const release of [...releases,...owners.values(),...views.values()])release();owners.clear();views.clear()}};
}
function closeDurabilityWarning(value){if(Array.isArray(value)){for(const answer of value){const warning=closeDurabilityWarning(answer);if(warning)return warning;}return null}return value?.durabilityWarning||(value?.durabilityConfirmed===false?'The latest checkpoint disk durability could not be confirmed.':null);}
async function confirmCloseWrite(write,{current=()=>true}={}){let answer=await write(),warning=closeDurabilityWarning(answer);if(!warning||!current())return answer;answer=await write();warning=closeDurabilityWarning(answer);if(warning)throw Error(String(warning));return answer;}
async function flushToQuiescence({capture,flush,current=()=>true,onStable=()=>{}}){
 while(current()){const before=capture();await flush();if(!current())return false;const after=capture();if(same(before,after)){if(!current())return false;onStable();return true;}}
 return false;
}
module.exports={closeDurabilityWarning,confirmCloseWrite,SheetActions,syncClosePaper,closeFlushState,watchCloseChanges,flushToQuiescence};
