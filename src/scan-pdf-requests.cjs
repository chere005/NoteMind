const {randomUUID}=require('node:crypto');
const valid=id=>typeof id==='string'&&/^[a-z0-9_.:-]{1,128}$/i.test(id),aborted=()=>Object.assign(Error('Scan preparation cancelled.'),{name:'AbortError'});
class ScanPdfRequests{
 constructor({maxPerOwner=2,maxRequests=8}={}){Object.assign(this,{maxPerOwner,maxRequests});this.owners=new WeakMap();this.active=new Set();this.total=0;this.closed=false;}
 run(owner,requestId,run){
  if(!owner||this.closed||owner.isDestroyed())return Promise.reject(Error('The scan window is closed.'));const id=requestId??randomUUID();if(!valid(id))return Promise.reject(Error('Invalid scan request.'));
  let state=this.owners.get(owner);if(!state){state={jobs:new Map()};this.owners.set(owner,state);owner.once('destroyed',()=>{for(const job of state.jobs.values())job.controller.abort();});}
  if(state.jobs.has(id))return Promise.reject(Error('This scan request is already active.'));if(state.jobs.size>=this.maxPerOwner||this.total>=this.maxRequests)return Promise.reject(Error('Scan preparation is busy. Try again shortly.'));
  const controller=new AbortController(),job={controller};state.jobs.set(id,job);this.active.add(state);this.total++;let rejectAbort;const stopped=new Promise((_,reject)=>rejectAbort=reject),abort=()=>rejectAbort(aborted());controller.signal.addEventListener('abort',abort,{once:true});
  const task=job.task=Promise.resolve().then(()=>{if(controller.signal.aborted)throw aborted();return run({id,signal:controller.signal});});const complete=()=>{if(state.jobs.get(id)===job){state.jobs.delete(id);this.total--;if(!state.jobs.size)this.active.delete(state);}};void task.then(complete,complete);
  // Cancellation is prompt, but queued/in-flight work owns capacity until its
  // actual cleanup completes; repeated cancel cannot bypass the queue bounds.
  return Promise.race([task,stopped]).finally(()=>controller.signal.removeEventListener('abort',abort));
 }
 cancel(owner,id){if(!valid(id))throw Error('Invalid scan request.');const job=this.owners.get(owner)?.jobs.get(id);job?.controller.abort();return!!job;}
 dispose(){this.closed=true;const tasks=[];for(const state of this.active)for(const job of state.jobs.values()){job.controller.abort();tasks.push(job.task);}return Promise.allSettled(tasks);}
}
module.exports={ScanPdfRequests};
