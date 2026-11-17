const {isMarkedAsUntransferable}=require('node:worker_threads');
const reads=new Set(['decode','decodeOwned','inspectOwned','inspectDrawingOwned','duplicateArchiveOwned','parseJson']);
// These operations receive a private transferred snapshot. All returned files
// and raw assets have independent backing before the operation completes.
function discardPrivateArchiveBytes(input){
 const backing=input?.buffer,length=input?.byteLength;
 if(!(backing instanceof ArrayBuffer)||!length||input.byteOffset!==0||length!==backing.byteLength||isMarkedAsUntransferable?.(backing)||typeof backing.transfer!=='function')return 0;
 try{backing.transfer(0);return backing.byteLength?0:length;}catch{return 0;}
}
function releaseArchiveInput(op,args){return reads.has(op)?discardPrivateArchiveBytes(args?.[0]):0;}
module.exports={releaseArchiveInput,discardPrivateArchiveBytes};
