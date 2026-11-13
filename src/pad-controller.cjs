const {findPenDisplay,moveOffDisplay}=require('./pad-display.cjs');
const FRAME='notemind-pen-display';
function createPadController({screen,owner,onChange=()=>{},onFrame=()=>{},onFocus=()=>{},dark=()=>false,enabled=true,owned=true}){
 let pad=null,ready=false,closed=false,mirrorTimer=null,mirrorGeneration=0,mirrorActive=false;const handlers=[];
 function physicalDisplay(){return findPenDisplay(screen.getAllDisplays(),screen.getPrimaryDisplay().id);}
 function display(){return enabled&&owned?physicalDisplay():null;}
 function state(){const d=physicalDisplay();return {enabled,owned,available:!!d,bounds:d?{...d.bounds}:null,label:d?.label||null,rotation:d?.rotation||0,open:!!pad&&!pad.isDestroyed()};}
 function publish(){onChange(state());}
 function stopMirror(){mirrorActive=false;mirrorGeneration++;if(mirrorTimer!==null)clearTimeout(mirrorTimer);mirrorTimer=null;}
 function startMirror(){
  if(mirrorActive||!pad?.webContents.capturePage)return;mirrorActive=true;const generation=++mirrorGeneration;
  const tick=async()=>{mirrorTimer=null;if(generation!==mirrorGeneration||!pad||pad.isDestroyed()||!ready)return;try{const image=await pad.webContents.capturePage();if(generation===mirrorGeneration&&!image.isEmpty()){const size=image.getSize(),small=size.width>1000?image.resize({width:1000}):image;onFrame(small.toJPEG(75).toString('base64'));}}catch{}if(generation===mirrorGeneration){mirrorTimer=setTimeout(tick,200);mirrorTimer.unref?.();}};
  mirrorTimer=setTimeout(tick,0);mirrorTimer.unref?.();
 }
 function hide(){stopMirror();if(pad&&!pad.isDestroyed()&&pad.isVisible())pad.hide();}
 function refresh(){
  if(closed)return;const d=display();
  if(!d){hide();publish();return;}
  if(pad&&!pad.isDestroyed()){
   pad.setBounds(d.bounds);const primary=screen.getPrimaryDisplay();const corrected=moveOffDisplay(owner.getBounds(),d.bounds,primary.workArea);if(corrected)owner.setBounds(corrected);
   if(ready&&!owner.isMinimized?.()&&owner.isVisible()){pad.showInactive();startMirror();}else hide();
  }
  publish();
 }
 function decision(details){
  const d=display();if(details.frameName!==FRAME||details.url!=='about:blank'||!d||closed||pad&&!pad.isDestroyed())return {action:'deny'};
  return {action:'allow',outlivesOpener:false,overrideBrowserWindowOptions:{...d.bounds,show:false,frame:false,skipTaskbar:true,backgroundColor:dark()?'#1e1e20':'#f4f3ef',webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}}};
 }
 function attach(window){
  if(closed||!display()||pad&&!pad.isDestroyed()){window.close();return false;}
  pad=window;ready=false;owner.webContents?.setBackgroundThrottling(false);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.on('closed',()=>{if(pad===window){stopMirror();owner.webContents?.setBackgroundThrottling(true);pad=null;ready=false;publish();}});window.on('focus',()=>{onFocus();scheduleRefresh()});window.on('blur',scheduleRefresh);publish();return true;
 }
 function markReady(){if(!pad||pad.isDestroyed())return;ready=true;refresh();}
 function input(event){
  if(!ready||!pad||pad.isDestroyed()||!display()||!event||!['mouseDown','mouseUp','mouseMove','mouseWheel'].includes(event.type))return false;
  const bounds=pad.getBounds();if(!Number.isFinite(event.x)||!Number.isFinite(event.y))return false;
  const x=Math.max(0,Math.min(bounds.width-1,Math.round(event.x))),y=Math.max(0,Math.min(bounds.height-1,Math.round(event.y)));
  const next={type:event.type,x,y};if(event.type==='mouseDown'||event.type==='mouseUp'){next.button=['left','middle','right'].includes(event.button)?event.button:'left';next.clickCount=1;}
  if(event.type==='mouseWheel'){next.deltaX=Number.isFinite(event.deltaX)?Math.max(-1000,Math.min(1000,event.deltaX)):0;next.deltaY=Number.isFinite(event.deltaY)?Math.max(-1000,Math.min(1000,event.deltaY)):0;}
  pad.webContents.sendInputEvent(next);return true;
 }
 function setOwned(value){owned=!!value;refresh();}
 function setEnabled(value){enabled=!!value;if(!enabled&&pad&&!pad.isDestroyed())pad.close();refresh();}
 function scheduleRefresh(){setTimeout(refresh,0);}
 for(const event of ['focus','blur','minimize','restore','show','hide']){owner.on?.(event,scheduleRefresh);handlers.push(()=>owner.removeListener?.(event,scheduleRefresh));}
 for(const event of ['display-added','display-removed','display-metrics-changed']){screen.on(event,refresh);handlers.push(()=>screen.removeListener(event,refresh));}
 function dispose(){if(closed)return;closed=true;stopMirror();handlers.forEach(fn=>fn());if(pad&&!pad.isDestroyed())pad.close();pad=null;}
 return {state,decision,attach,markReady,setEnabled,setOwned,refresh,input,captureEligible:()=>!!display()&&ready&&!!pad&&!pad.isDestroyed()&&pad.isVisible()&&!owner.isMinimized?.()&&owner.isVisible(),contents:()=>ready&&pad&&!pad.isDestroyed()?pad.webContents:null,dispose};
}
module.exports={FRAME,createPadController};
