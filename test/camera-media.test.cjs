const test=require('node:test'),assert=require('node:assert/strict');
const {CameraMedia}=require('../src/camera-media.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function stream(){const track={stops:0,stop(){this.stops++}};return {track,getTracks:()=>[track]};}
const video=()=>({srcObject:null,videoWidth:1920,videoHeight:1080,play:async()=>{}});

test('camera play failure stops its tracks and clears its video',async()=>{
 const owner=new CameraMedia(),source=stream(),element=video();element.play=async()=>{throw Error('play rejected')};
 await assert.rejects(owner.start({mediaDevices:{getUserMedia:async()=>source},video:element}),/play rejected/);
 assert.equal(source.track.stops,1);assert.equal(element.srcObject,null);assert.equal(owner.current,null);
});
test('late old camera request cannot replace or stop the newer stream',async()=>{
 const owner=new CameraMedia(),old=deferred(),first=stream(),second=stream(),element=video();let calls=0,ready=0;
 const mediaDevices={getUserMedia:()=>++calls===1?old.promise:Promise.resolve(second)};
 const opening=owner.start({mediaDevices,video:element,onReady:()=>{ready++}});
 await owner.start({mediaDevices,video:element,onReady:()=>{ready++}});old.resolve(first);await opening;
 assert.equal(first.track.stops,1);assert.equal(second.track.stops,0);assert.equal(element.srcObject,second);assert.equal(ready,1);
 owner.stop();assert.equal(second.track.stops,1);assert.equal(element.srcObject,null);
});
test('camera enumeration failure preserves ready stream and bounded request',async()=>{
 const owner=new CameraMedia(),source=stream(),element=video();let request,ready;
 await owner.start({mediaDevices:{getUserMedia:async value=>{request=value;return source},enumerateDevices:async()=>{throw Error('denied')}},video:element,device:'picked',aspect:'1.3333333333333333',onReady:value=>{ready=value}});
 assert.deepEqual(ready,{width:1920,height:1080});assert.equal(source.track.stops,0);
 assert.equal(request.video.width.max,4096);assert.equal(request.video.height.max,4096);assert.equal(request.video.frameRate.max,30);assert.deepEqual(request.video.deviceId,{exact:'picked'});assert.equal(request.audio,false);owner.stop();
});
test('hidden camera stops pending play once and rejects oversized frames',async()=>{
 const owner=new CameraMedia(),source=stream(),element=video(),playing=deferred();let ready=0;
 element.play=()=>playing.promise;const opening=owner.start({mediaDevices:{getUserMedia:async()=>source},video:element,onReady:()=>ready++});
 await Promise.resolve();owner.stop();playing.resolve();await opening;assert.equal(source.track.stops,1);assert.equal(ready,0);
 const large=stream();element.videoWidth=8192;
 await assert.rejects(owner.start({mediaDevices:{getUserMedia:async()=>large},video:element}),/unsupported picture size/);assert.equal(large.track.stops,1);assert.equal(element.srcObject,null);
});
