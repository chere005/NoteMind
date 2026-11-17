const MAX_EDGE=4096,MAX_PIXELS=16*1024*1024;

// Each request owns only its own tracks. A late permission or play result can
// never stop a newer camera session or leave a failed stream running.
class CameraMedia {
 constructor(){this.current=null;}
 stopSession(session){
  if(!session||session.stopped)return;
  session.stopped=true;
  if(session.video.srcObject===session.stream)session.video.srcObject=null;
  session.stream?.getTracks().forEach(track=>track.stop());
  if(this.current===session)this.current=null;
 }
 stop(){this.stopSession(this.current);}
 async start({mediaDevices,video,device='',aspect='free',onReady=()=>{},onDevices=()=>{}}){
  this.stop();
  if(!mediaDevices?.getUserMedia)throw Error('Camera access is unavailable.');
  const session={video,stream:null,stopped:false};this.current=session;
  try{
   const stream=await mediaDevices.getUserMedia({video:{width:{ideal:1920,max:MAX_EDGE},height:{ideal:1080,max:MAX_EDGE},frameRate:{ideal:30,max:30},...(device?{deviceId:{exact:device}}:{}),...(aspect!=='free'?{aspectRatio:{ideal:Number(aspect)}}:{})},audio:false});
   session.stream=stream;
   if(session.stopped||this.current!==session){stream.getTracks().forEach(track=>track.stop());return;}
   video.srcObject=stream;await video.play();
   if(session.stopped||this.current!==session)return;
   const width=video.videoWidth,height=video.videoHeight;
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)throw Error('The camera returned an unsupported picture size.');
   onReady({width,height});
   // Device labels are optional; enumeration failure must not tear down a
   // successfully playing camera.
   try{const devices=await mediaDevices.enumerateDevices?.();if(!session.stopped&&this.current===session&&devices)onDevices(devices.filter(item=>item.kind==='videoinput'));}catch{}
  }catch(error){
   const report=!session.stopped&&this.current===session;
   this.stopSession(session);
   if(report)throw error;
  }
 }
}
module.exports={CameraMedia,MAX_EDGE,MAX_PIXELS};
