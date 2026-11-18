// Native and mirrored mouse/pen input use the same pointer gesture; HTML drag
// events are not synthesized across the Wacom pixel mirror.
class OverviewPointer{
 constructor({hit,move,hint=()=>{},scroll=()=>false,frame=fn=>setTimeout(fn,16),cancelFrame=clearTimeout}){Object.assign(this,{hit,move,hint,scroll,frame,cancelFrame});this.contact=null;this.suppressed=null;this.frameId=null;}
 begin(id,event){if(this.contact||event.button!==0||!Number.isSafeInteger(event.pointerId))return false;this.contact={id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,last:event,dragged:false,before:undefined};return true;}
 update(event){const held=this.contact;if(!held||held.pointerId!==event.pointerId)return false;held.last=event;if(!held.dragged&&Math.hypot(event.clientX-held.x,event.clientY-held.y)<6)return false;held.dragged=true;held.before=this.hit(event.clientX,event.clientY);this.hint(held.before===held.id?undefined:held.before);if(this.frameId===null)this.frameId=this.frame(()=>this.advance());event.preventDefault?.();return true;}
 advance(){this.frameId=null;const held=this.contact;if(!held?.dragged)return;if(this.scroll(held.last.clientX,held.last.clientY)){held.before=this.hit(held.last.clientX,held.last.clientY);this.hint(held.before===held.id?undefined:held.before);this.frameId=this.frame(()=>this.advance());}}
 end(event){const held=this.contact;if(!held||held.pointerId!==event.pointerId)return false;this.update(event);const changed=held.dragged;this.contact=null;if(this.frameId!==null){this.cancelFrame(this.frameId);this.frameId=null;}this.hint(undefined);if(changed){event.preventDefault?.();this.suppressed={id:held.id,until:event.timeStamp+50};if(held.before!==undefined&&held.before!==held.id)this.move(held.id,held.before);}return changed;}
 consumeClick(id,event){const held=this.suppressed;this.suppressed=null;return !!held&&held.id===id&&event.detail!==0&&event.timeStamp<=held.until;}
 cancel(event){if(event&&this.contact?.pointerId!==event.pointerId)return false;this.contact=null;this.hint(undefined);if(this.frameId!==null){this.cancelFrame(this.frameId);this.frameId=null;}return true;}
}
module.exports={OverviewPointer};
