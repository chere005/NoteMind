// User intent is immediate; only the matching owner epoch may publish after a flush.
class OverviewIntent{
 constructor({publish,onError=()=>{},restoreFocus=()=>{}}){Object.assign(this,{publish,onError,restoreFocus});this.owner=null;this.epoch=0;this.serial=0;this.wanted=false;}
 bind(owner){if(this.owner!==owner){this.owner=owner;this.epoch++;this.serial++;this.wanted=false;}return this.epoch;}
 valid(owner,serial){return this.owner===owner&&this.serial===serial&&this.wanted;}
 close(owner,doc){if(this.owner!==owner)return false;this.serial++;this.wanted=false;this.publish(this.epoch,false);this.restoreFocus(doc);return true;}
 async toggle(owner,flush,doc){
  if(this.owner!==owner)return false;if(this.wanted)return this.close(owner,doc);const serial=++this.serial,epoch=this.epoch;this.wanted=true;
  try{await flush(()=>this.valid(owner,serial));if(!this.valid(owner,serial))return false;this.publish(epoch,true);return true;}
  catch(error){if(this.owner===owner&&this.serial===serial){this.wanted=false;this.publish(epoch,false);this.onError(error);}return false;}
 }
 cancel(){this.serial++;this.wanted=false;}
}
module.exports={OverviewIntent};
