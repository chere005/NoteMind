// A failed provisional claim frees a registry slot, not byte capacity. Buffer
// that hint until the attempt reports which resource actually blocked it.
function capacityChange(storage){let wake,blockedBy=null,ownerChanged=false;const changed=new Promise(resolve=>wake=resolve),off=storage.subscribeRawCapacity(event=>{if(event?.kind==='owners'){ownerChanged=true;if(blockedBy==='owners')wake();}else wake();});return{changed,off,blocked(error){blockedBy=error?.capacityKind==='owners'?'owners':'bytes';if(blockedBy==='owners'&&ownerChanged)wake();}};}
module.exports={capacityChange};
