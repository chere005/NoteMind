const{randomUUID}=require('node:crypto'),{abortRead}=require('./sheet-read-work.cjs');
const validRequest=id=>typeof id==='string'&&/^[a-z0-9_.:-]{1,128}$/i.test(id);
class SheetReadRequests{
 constructor({loads,maxPerOwner=8,maxRequests=32}={}){this.loads=loads;this.maxPerOwner=maxPerOwner;this.maxRequests=maxRequests;this.owners=new WeakMap();this.active=new Set();this.total=0;this.closed=false;}
 state(sender){let state=this.owners.get(sender);if(!state){state={jobs:new Map()};this.owners.set(sender,state);sender.once('destroyed',()=>{for(const job of state.jobs.values())job.controller.abort(Error('Drawing recovery window closed.'));this.loads.closeOwner(sender.id);});}return state;}
 run(sender,requestId,scope,run){
  if(this.closed||sender.isDestroyed())return Promise.reject(Error('Drawing recovery window closed.'));const id=requestId??randomUUID();if(!validRequest(id))return Promise.reject(Error('Invalid drawing read request.'));const state=this.state(sender),key=scope+':'+id;if(state.jobs.has(key)||this.loads.hasRequest(sender.id,id,scope))return Promise.reject(Error('Drawing read request is already active.'));if(state.jobs.size>=this.maxPerOwner||this.total>=this.maxRequests)return Promise.reject(Error('Drawing recovery is busy. Current drawings remain open.'));
  const controller=new AbortController(),job={controller,id,scope};state.jobs.set(key,job);this.active.add(state);this.total++;const check=()=>{if(controller.signal.aborted)throw controller.signal.reason||abortRead();if(sender.isDestroyed())throw Error('Drawing recovery window closed.');};let rejectCancelled;const cancelled=new Promise((_,reject)=>rejectCancelled=reject),onAbort=()=>rejectCancelled(controller.signal.reason||abortRead());controller.signal.addEventListener('abort',onAbort,{once:true});
  const task=Promise.resolve().then(async()=>{check();const value=await run({signal:controller.signal,id,check});check();return value;});
  const complete=()=>{if(state.jobs.get(key)===job){state.jobs.delete(key);this.total--;if(!state.jobs.size)this.active.delete(state);}};void task.then(complete,complete);return Promise.race([task,cancelled]).finally(()=>controller.signal.removeEventListener('abort',onAbort));
 }
 cancel(sender,id,scope){if(!validRequest(id))throw Error('Invalid drawing read request.');const job=this.owners.get(sender)?.jobs.get(scope+':'+id);if(job)job.controller.abort(abortRead());return!!(this.loads.cancelRequest(sender.id,id,scope)||job);}
 dispose(){if(this.closed)return;this.closed=true;for(const state of this.active)for(const job of state.jobs.values())job.controller.abort(Error('Drawing recovery window closed.'));}
}
module.exports={SheetReadRequests,validRequest};
