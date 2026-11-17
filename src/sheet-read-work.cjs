const abortRead=()=>Object.assign(Error('Drawing recovery cancelled.'),{name:'AbortError'});
const now=()=>globalThis.performance?.now()??Date.now();
class SheetReadWork{
 constructor({flag,signal,yieldControl=()=>new Promise(resolve=>setImmediate(resolve))}={}){if(flag!==undefined&&(!(flag instanceof SharedArrayBuffer)||flag.byteLength!==4))throw Error('Invalid drawing read cancellation.');this.flag=flag?new Int32Array(flag):null;this.signal=signal;this.yieldControl=yieldControl;this.units=0;this.time=now();this.check()}
 check(){if(this.signal?.aborted||this.flag&&Atomics.load(this.flag,0))throw abortRead()}
 poll(units=1){this.check();this.units+=units;return this.units>=4096||this.units%256===0&&now()-this.time>=3}
 async pause(){this.check();await this.yieldControl();this.check();this.units=0;this.time=now()}
}
module.exports={SheetReadWork,abortRead};
