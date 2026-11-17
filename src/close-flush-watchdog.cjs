const {randomUUID}=require('node:crypto');
// A responsive renderer can await durable worker I/O longer than the idle limit.
// The independent hard limit always belongs to the original close attempt.
class CloseFlushWatchdog {
 constructor({idleMs=10000,hardMs=180000,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,id=randomUUID,onTimeout=()=>{},onCancel=()=>{}}={}) {
  if(!Number.isFinite(idleMs)||idleMs<=0||!Number.isFinite(hardMs)||hardMs<idleMs)throw Error('Invalid close flush deadline.');
  Object.assign(this,{idleMs,hardMs,now,setTimer,clearTimer,id,onTimeout,onCancel});this.active=null;
 }
 get pending(){return this.active!==null;}
 start(owner){
  this.cancel();const requestId=this.id(),at=this.now();
  const record={owner,requestId,hard:at+this.hardMs,idle:at+this.idleMs,sequence:0,timer:null};
  record.destroyed=()=>this.cancel(owner,requestId);this.active=record;owner.once?.('destroyed',record.destroyed);this.arm(record);return{requestId};
 }
 matches(owner,requestId){const record=this.active;return record&&record.owner===owner&&typeof requestId==='string'&&record.requestId===requestId?record:null;}
 arm(record){this.clearTimer(record.timer);record.timer=this.setTimer(()=>{if(this.active!==record)return;const at=this.now();if(at>=record.hard||at>=record.idle){this.stop(record);this.onCancel(record);this.onTimeout(record,at>=record.hard?'hard':'idle');}else this.arm(record);},Math.max(0,Math.min(record.idle,record.hard)-this.now()));record.timer?.unref?.();}
 progress(owner,requestId,sequence){const record=this.matches(owner,requestId);if(!record||!Number.isSafeInteger(sequence)||sequence<=record.sequence)return false;if(this.now()>=Math.min(record.idle,record.hard)){this.expire(record,this.now()>=record.hard?'hard':'idle');return false;}record.sequence=sequence;record.idle=this.now()+this.idleMs;this.arm(record);return true;}
 complete(owner,requestId){const record=this.matches(owner,requestId);if(!record)return false;if(this.now()>=Math.min(record.idle,record.hard)){this.expire(record,this.now()>=record.hard?'hard':'idle');return false;}this.stop(record);return true;}
 stop(record){if(this.active!==record)return;this.active=null;this.clearTimer(record.timer);record.owner.removeListener?.('destroyed',record.destroyed);}
 expire(record,kind){this.stop(record);this.onCancel(record);this.onTimeout(record,kind);}
 cancel(owner,requestId){const record=this.active;if(!record||owner!==undefined&&!this.matches(owner,requestId))return false;this.stop(record);this.onCancel(record);return true;}
 dispose(){this.cancel();}
}
module.exports={CloseFlushWatchdog};
