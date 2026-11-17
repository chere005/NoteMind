const {isMarkedAsUntransferable}=require('node:worker_threads');
const reads=new Set(['decode','decodeOwned','inspectOwned','inspectDrawingOwned','duplicateArchiveOwned','parseJson']);
// These operations receive a private transferred snapshot. All returned files
// and raw assets have independent backing before the operation completes.
function releaseArchiveInput(op,args){
 if(!reads.has(op))return 0;
 const input=args?.[0],backing=input?.buffer,length=input?.byteLength;
 if(!(backing instanceof ArrayBuffer)||!length||input.byteOffset!==0||length!==backing.byteLength||isMarkedAsUntransferable?.(backing)||typeof backing.transfer!=='function')return 0;
 try{backing.transfer(0);return backing.byteLength?0:length;}catch{return 0;}
}
module.exports={releaseArchiveInput};
