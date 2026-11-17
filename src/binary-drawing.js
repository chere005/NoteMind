// Export directly from immutable Float64 records: no duplicate point graphs in the worker.
const graphics=require('./graphics-pane.js');
const finite=n=>typeof n==='number'&&Number.isFinite(n),coordinate=n=>finite(n)&&Number.isFinite(n*10000),MAX_POINTS=2000000;
function pauseOf({signal,yieldControl=graphics.yieldTask}={}){return async()=>{if(signal?.aborted)throw Error('Drawing export cancelled.');await yieldControl();if(signal?.aborted)throw Error('Drawing export cancelled.');};}
async function inspectBinaryDrawing(input,options={}){
 const pause=pauseOf(options);await pause();if(!ArrayBuffer.isView(input)||!graphics.isBinary(input)||input.byteLength<24||input.byteLength>graphics.MAX_BINARY_BYTES)throw Error('Invalid binary drawing.');const bytes=new Uint8Array(input.buffer,input.byteOffset,input.byteLength),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(8,true),count=view.getUint32(12,true),points=view.getUint32(16,true);
 if(view.getUint32(20,true)!==bytes.length||length>70*1024*1024||length>bytes.length-24||count>MAX_POINTS||points>MAX_POINTS)throw Error('Invalid binary drawing size.');const metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(24,24+length)));if(!metadata||typeof metadata.name!=='string')throw Error('Invalid binary drawing metadata.');graphics.validate({...metadata,strokes:[]});
 const offsets=new Uint32Array(count+1);let at=24+length,seen=0,work=0;
 for(let i=0;i<count;i++){offsets[i]=at;if(at+16>bytes.length)throw Error('Truncated binary drawing.');const flags=view.getUint8(at+3),width=view.getFloat64(at+4,true),size=view.getUint32(at+12,true),pressure=!!(flags&1),stride=pressure?24:16;if(flags>127||!coordinate(width)||width<=0||size>points-seen||at+16+size*stride>bytes.length)throw Error('Invalid binary drawing stroke.');seen+=size;at+=16;for(let point=0;point<size;point++,at+=stride){if(!coordinate(view.getFloat64(at,true))||!coordinate(view.getFloat64(at+8,true))||(pressure&&!finite(view.getFloat64(at+16,true))))throw Error('Invalid binary drawing point.');if(++work%8192===0)await pause();}if(++work%8192===0)await pause();}
 offsets[count]=at;if(seen!==points||at!==bytes.length)throw Error('Invalid binary drawing length.');await pause();return {bytes,view,offsets,metadata,count,points};
}
async function cropBinaryDrawing(source,box,options={}){
 if(!box||![box.x,box.y,box.width,box.height,box.x+box.width,box.y+box.height].every(coordinate)||box.width<=0||box.height<=0)throw Error('Select an area of the sheet.');
 const pause=pauseOf(options),metadata={...source.metadata,aspect:source.metadata.aspect*box.width/box.height,extent:undefined};if(metadata.backdrop&&(box.x!==0||box.y!==0||box.width!==1||box.height!==1)){const w=1000,h=1000/source.metadata.aspect;metadata.backdrop='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x*w} ${box.y*h} ${box.width*w} ${box.height*h}"><image href="${metadata.backdrop}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`);}
 const prefix=await graphics.encodeBytesAsync({...metadata,strokes:[]},{...options,yieldControl:pause}),view=source.view;let work=0;
 const walk=async sink=>{
  for(let index=0;index<source.count;index++){
   const header=source.offsets[index],count=view.getUint32(header+12,true),pressure=!!(view.getUint8(header+3)&1),stride=pressure?24:16,width=view.getFloat64(header+4,true)/box.width,start=header+16;if(!coordinate(width)||width<=0)throw Error('Invalid cropped pen width.');let selected=count>0;
   for(let i=0;i<count;i++){const at=start+i*stride,x=view.getFloat64(at,true),y=view.getFloat64(at+8,true);if(x<box.x||x>box.x+box.width||y<box.y||y>box.y+box.height)selected=false;if(++work%8192===0)await pause();}
   const point=(x,y,p)=>{if(!coordinate(x)||!coordinate(y)||(pressure&&!finite(p)))throw Error('Invalid cropped drawing point.');sink.point(x,y,p,pressure);};
   if(selected){sink.begin(header,width);for(let i=0;i<count;i++){const at=start+i*stride;point((view.getFloat64(at,true)-box.x)/box.width,(view.getFloat64(at+8,true)-box.y)/box.height,pressure?view.getFloat64(at+16,true):0);if(++work%8192===0)await pause();}sink.end();}
   else{let running=false,lastX=0,lastY=0;const end=()=>{if(running){sink.end();running=false}};
    for(let i=1;i<count;i++){
     const a=start+(i-1)*stride,b=a+stride,ax=view.getFloat64(a,true),ay=view.getFloat64(a+8,true),bx=view.getFloat64(b,true),by=view.getFloat64(b+8,true),dx=bx-ax,dy=by-ay;let lo=0,hi=1,clipped=false;
     for(const [p,q]of [[-dx,ax-box.x],[dx,box.x+box.width-ax],[-dy,ay-box.y],[dy,box.y+box.height-ay]]){if(p===0){if(q<0)clipped=true;continue;}const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);}
     if(clipped||lo>hi)end();else{const x0=(ax+dx*lo-box.x)/box.width,y0=(ay+dy*lo-box.y)/box.height,x1=(ax+dx*hi-box.x)/box.width,y1=(ay+dy*hi-box.y)/box.height,pa=pressure?view.getFloat64(a+16,true):0,pb=pressure?view.getFloat64(b+16,true):0;if(running&&(Math.abs(lastX-x0)>1e-9||Math.abs(lastY-y0)>1e-9))end();if(!running){sink.begin(header,width);running=true;point(x0,y0,pa+(pb-pa)*lo);}point(x1,y1,pa+(pb-pa)*hi);lastX=x1;lastY=y1;if(hi<1)end();}
     if(++work%8192===0)await pause();
    }end();
   }if(++work%8192===0)await pause();
  }
 };
 let length=prefix.length,strokes=0,points=0;await walk({begin(){if(++strokes>MAX_POINTS)throw Error('This graphics pane has too many strokes.');length+=16;},point(_x,_y,_p,pressure){if(++points>MAX_POINTS)throw Error('This graphics pane has too many points.');length+=pressure?24:16;if(length>graphics.MAX_BINARY_BYTES)throw Error('This graphics pane is too large.');},end(){}});
 const bytes=new Uint8Array(length),output=new DataView(bytes.buffer);bytes.set(prefix);output.setUint32(12,strokes,true);output.setUint32(16,points,true);output.setUint32(20,length,true);let at=prefix.length,header=0,count=0;await walk({begin(original,width){header=at;count=0;bytes.set(source.bytes.subarray(original,original+16),at);output.setFloat64(at+4,width,true);at+=16;},point(x,y,p,pressure){output.setFloat64(at,x,true);output.setFloat64(at+8,y,true);at+=16;if(pressure){output.setFloat64(at,p,true);at+=8;}count++;},end(){output.setUint32(header+12,count,true);}});if(at!==length)throw Error('Invalid cropped drawing length.');await pause();return bytes;
}
async function paintBinaryDrawing(ctx,source,toPixel,scale,tint,pressureScale,options={}){
 const pause=pauseOf(options),view=source.view;await pause();let work=0;ctx.lineCap='round';ctx.lineJoin='round';
 for(let index=0;index<source.count;index++){
  const header=source.offsets[index],count=view.getUint32(header+12,true),flags=view.getUint8(header+3),pressure=!!(flags&1),stride=pressure?24:16,width=view.getFloat64(header+4,true),hex=[source.bytes[header],source.bytes[header+1],source.bytes[header+2]].map(v=>v.toString(16).padStart(2,'0')).join(''),colour='#'+[...hex].map((c,n)=>flags&(1<<(n+1))?c.toUpperCase():c).join('');if(!count){if(++work%2048===0)await pause();continue;}ctx.strokeStyle=tint?tint(colour):colour;let at=header+16;
  if(count){let previous=toPixel(view.getFloat64(at,true),view.getFloat64(at+8,true)),p=pressure?view.getFloat64(at+16,true):.5;if(count===1){ctx.lineWidth=Math.max(.5,width*scale);ctx.beginPath();ctx.moveTo(previous.x,previous.y);ctx.lineTo(previous.x+.01,previous.y);ctx.stroke();}
   else{if(!pressure){ctx.lineWidth=Math.max(.5,width*scale);ctx.beginPath();ctx.moveTo(previous.x,previous.y);}for(let point=1;point<count;point++){at+=stride;const next=toPixel(view.getFloat64(at,true),view.getFloat64(at+8,true)),q=pressure?view.getFloat64(at+16,true):.5;if(pressure){ctx.lineWidth=Math.max(.25,width*scale*pressureScale((p+q)/2));ctx.beginPath();ctx.moveTo(previous.x,previous.y);}ctx.lineTo(next.x,next.y);if(pressure)ctx.stroke();previous=next;p=q;if(++work%2048===0)await pause();}if(!pressure)ctx.stroke();}
  }if(++work%2048===0)await pause();
 }await pause();
}
module.exports={inspectBinaryDrawing,cropBinaryDrawing,paintBinaryDrawing};
