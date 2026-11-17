const {yieldTask}=require('./graphics-pane.js');
const cancelled=()=>Object.assign(Error('Ink selection cancelled.'),{name:'AbortError'});
const coordinate=value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(value*10000);
function work({signal,valid=()=>true,yieldControl=yieldTask,maxWork=2048,maxMs=3}={}){
 let count=0,last=globalThis.performance?.now?.()||Date.now();
 const check=()=>{if(signal?.aborted||!valid())throw cancelled();};
 return{check,tick(amount=1){count+=amount;return count>=maxWork||(count%128===0&&(globalThis.performance?.now?.()||Date.now())-last>=maxMs);},async pause(){check();await yieldControl();check();count=0;last=globalThis.performance?.now?.()||Date.now();}};
}
module.exports={work,cancelled,coordinate};
