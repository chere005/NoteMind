const {yieldTask}=require('./graphics-pane.js');
const abort=()=>Object.assign(Error('Camera ink change cancelled.'),{name:'AbortError'});
const check=signal=>{if(signal?.aborted)throw abort();};

// A capture consumes only its unchanged prefix. Later writing remains, and an
// intervening edit/Undo keeps the edited ink instead of deleting a new version.
async function afterCameraCapture(captured,current,{signal,yieldControl=yieldTask}={}){
 check(signal);if(current===captured)return [];
 if(current.length<captured.length)return null;
 for(let i=0;i<captured.length;i++){
  check(signal);if(current[i]!==captured[i])return null;
  if(i%4096===4095)await yieldControl();
 }
 const next=[];
 for(let i=captured.length;i<current.length;i++){check(signal);next.push(current[i]);if(i%4096===4095)await yieldControl();}
 return next;
}
async function outsideCameraSelection(strokes,box,{signal,yieldControl=yieldTask}={}){
 const next=[];let work=0,changed=false;
 for(const stroke of strokes){
  let inside=stroke.points.length>0;
  for(const point of stroke.points){
   check(signal);
   if(point.x<box.x||point.x>box.x+box.width||point.y<box.y||point.y>box.y+box.height){inside=false;break;}
   if(++work%8192===0)await yieldControl();
  }
  if(inside)changed=true;else next.push(stroke);
  if(++work%4096===0){check(signal);await yieldControl();}
 }
 return changed?next:strokes;
}
module.exports={afterCameraCapture,outsideCameraSelection};
