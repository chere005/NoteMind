const aborted=()=>Object.assign(Error('Word export cancelled.'),{name:'AbortError'});
// Track the complete export, including media preparation and cleanup after worker exit.
class WordExportOperations{
 constructor(){this.active=new Set();this.closed=false;}
 run(work,signal){
  if(this.closed)return Promise.reject(Error('Word tools are closing.'));
  if(signal?.aborted)return Promise.reject(aborted());
  const controller=new AbortController();let done;const ticket={controller,done:new Promise(resolve=>done=resolve)};
  this.active.add(ticket);const stop=()=>controller.abort();signal?.addEventListener('abort',stop,{once:true});
  let pending;try{pending=Promise.resolve(work(controller.signal));}catch(error){pending=Promise.reject(error);}
  return pending.finally(()=>{signal?.removeEventListener('abort',stop);this.active.delete(ticket);done();});
 }
 async dispose(){this.closed=true;const active=[...this.active];for(const ticket of active)ticket.controller.abort();await Promise.all(active.map(ticket=>ticket.done));}
}
module.exports={WordExportOperations,operations:new WordExportOperations()};
