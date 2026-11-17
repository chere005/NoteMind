// A move/resize works on exact Float64 records without materializing another point graph in the worker.
const graphics=require('./graphics-pane.js'),{hashWriter}=require('./stroke-signature.js');
const finite=n=>typeof n==='number'&&Number.isFinite(n),coordinate=n=>finite(n)&&Number.isFinite(n*10000);
function rect(value){return value&&[value.x,value.y,value.width,value.height,value.x+value.width,value.y+value.height].every(coordinate)&&value.width>0&&value.height>0;}
async function transformInkBinary(input,from,to,{signal,yieldControl=graphics.yieldTask}={}){
 if(!rect(from)||!rect(to))throw Error('Invalid drawing transformation.');const sx=to.width/from.width,sy=to.height/from.height;if(!finite(sx)||!finite(sy)||sx<=0||sy<=0)throw Error('The drawing transformation exceeds the supported numeric range.');
 const pause=async()=>{if(signal?.aborted)throw Error('Drawing transformation cancelled.');await yieldControl();if(signal?.aborted)throw Error('Drawing transformation cancelled.');};await pause();
 if(!ArrayBuffer.isView(input)||!graphics.isBinary(input)||input.byteLength<24||input.byteLength>graphics.MAX_BINARY_BYTES)throw Error('Invalid drawing transformation source.');
 const source=new Uint8Array(input.buffer,input.byteOffset,input.byteLength),view=new DataView(source.buffer,source.byteOffset,source.byteLength),metadata=view.getUint32(8,true),count=view.getUint32(12,true),points=view.getUint32(16,true);
 if(metadata>65536||metadata>source.length-24||count>2000000||points>2000000||view.getUint32(20,true)!==source.length)throw Error('Invalid drawing transformation size.');
 const prefix=source.slice(0,24+metadata),check=new DataView(prefix.buffer);check.setUint32(12,0,true);check.setUint32(16,0,true);check.setUint32(20,prefix.length,true);graphics.validateBinary(prefix);
 const selected=[];let at=prefix.length,seen=0,work=0,length=prefix.length,selectedPoints=0;
 for(let index=0;index<count;index++){
  if(at+16>source.length)throw Error('Truncated drawing transformation source.');const start=at,flags=view.getUint8(at+3),pressure=!!(flags&1),width=view.getFloat64(at+4,true),size=view.getUint32(at+12,true),stride=pressure?24:16;if(flags>127||!coordinate(width)||width<=0||size>points-seen||at+16+size*stride>source.length)throw Error('Invalid drawing transformation stroke.');seen+=size;at+=16;const data=at;let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(let i=0;i<size;i++,at+=stride){const px=view.getFloat64(at,true),py=view.getFloat64(at+8,true);if(!coordinate(px)||!coordinate(py)||(pressure&&!finite(view.getFloat64(at+16,true))))throw Error('Invalid drawing transformation point.');x=Math.min(x,px);y=Math.min(y,py);right=Math.max(right,px);bottom=Math.max(bottom,py);if(++work>=8192){work=0;await pause();}}
  if(size&&x>=from.x&&y>=from.y&&right<=from.x+from.width&&bottom<=from.y+from.height){const bytes=16+size*stride;selected.push({index,start,data,size,stride,pressure,width,flags,bytes});length+=bytes;selectedPoints+=size;}
  if(++work>=8192){work=0;await pause();}
 }
 if(seen!==points||at!==source.length||length>graphics.MAX_BINARY_BYTES)throw Error('Invalid drawing transformation length.');
 const bytes=new Uint8Array(length),output=new DataView(bytes.buffer),indexes=new Uint32Array(selected.length),hashBytes=new Uint8Array(selected.length*8),hashes=new DataView(hashBytes.buffer);bytes.set(prefix);output.setUint32(12,selected.length,true);output.setUint32(16,selectedPoints,true);output.setUint32(20,length,true);at=prefix.length;
 for(let index=0;index<selected.length;index++){
  const record=selected[index],width=record.width*sx;if(!coordinate(width)||width<=0)throw Error('The transformed pen width exceeds the supported numeric range.');bytes.set(source.subarray(record.start,record.start+16),at);output.setFloat64(at+4,width,true);at+=16;const begin=at,hex=[source[record.start],source[record.start+1],source[record.start+2]].map(v=>v.toString(16).padStart(2,'0')).join(''),colour='#'+[...hex].map((c,n)=>record.flags&(1<<(n+1))?c.toUpperCase():c).join('');const writer=hashWriter().write('{"colorHex":'+JSON.stringify(colour)+',"width":'+String(width)+',"points":[');
  for(let i=0;i<record.size;i++){
   const sourceAt=record.data+i*record.stride,x=to.x+(view.getFloat64(sourceAt,true)-from.x)*sx,y=to.y+(view.getFloat64(sourceAt+8,true)-from.y)*sy;if(!coordinate(x)||!coordinate(y))throw Error('The transformed ink exceeds the supported numeric range.');output.setFloat64(at,x,true);output.setFloat64(at+8,y,true);at+=16;if(record.pressure){output.setFloat64(at,view.getFloat64(sourceAt+16,true),true);at+=8;}writer.write((i?',':'')+'{"x":'+String(x)+',"y":'+String(y)+'}');if(++work>=8192){work=0;await pause();}
  }
  writer.write(']');if(record.pressure){writer.write(',"pressures":[');for(let i=0;i<record.size;i++){writer.write((i?',':'')+String(output.getFloat64(begin+i*24+16,true)));if(++work>=8192){work=0;await pause();}}writer.write(']');}const hash=writer.write('}').digest();indexes[index]=record.index;hashes.setUint32(index*8,parseInt(hash.slice(0,8),16),true);hashes.setUint32(index*8+4,parseInt(hash.slice(8),16),true);if(++work>=8192){work=0;await pause();}
 }
 await pause();return {bytes,indexes,hashBytes};
}
module.exports={transformInkBinary};
