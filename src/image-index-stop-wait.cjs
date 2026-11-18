// One observer per cleanup promise; timed-out foreground waiters remove
// themselves instead of accumulating reactions on a possibly lost ACK.
function createStopWaiter({setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const records=new WeakMap(),pending=new Set();
 function record(promise){if(!promise)return null;let value=records.get(promise);if(value)return value;value={done:false,error:null,waiters:new Set()};records.set(promise,value);pending.add(value);const end=error=>{value.done=true;value.error=error;pending.delete(value);for(const wake of [...value.waiters])wake();value.waiters.clear();};Promise.resolve(promise).then(()=>end(null),end);return value;}
 async function wait(items,graceMs){const list=items.filter(item=>item.promise).map(item=>({value:record(item.promise),propagate:!!item.propagate}));if(list.some(item=>!item.value.done))await new Promise(resolve=>{let timer,finished=false;const end=()=>{if(finished)return;finished=true;clearTimer(timer);for(const item of list)item.value.waiters.delete(wake);resolve();},wake=()=>{if(list.every(item=>item.value.done))end();};for(const item of list)if(!item.value.done)item.value.waiters.add(wake);timer=setTimer(end,graceMs);wake();});for(const item of list)if(item.propagate&&item.value.done&&item.value.error)throw item.value.error;return list.every(item=>item.value.done);}
 return{wait,stats:()=>({pendingStops:pending.size,foregroundStopWaiters:[...pending].reduce((sum,value)=>sum+value.waiters.size,0)})};
}
module.exports={createStopWaiter};
