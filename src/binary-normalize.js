// A binary open needs canonical leaf fingerprints, not a second editable point graph.
const graphics=require('./graphics-pane.js'),{inspectBinaryDrawing}=require('./binary-drawing.js'),{hashWriter,fingerprint}=require('./stroke-signature.js');
async function fingerprintBinaryDrawing(source,{signal,yieldControl=graphics.yieldTask}={}){
 const pause=async()=>{if(signal?.aborted)throw Error('Drawing load cancelled.');await yieldControl();if(signal?.aborted)throw Error('Drawing load cancelled.');};
 const hashBytes=new Uint8Array(source.count*8),hashes=new DataView(hashBytes.buffer),view=source.view;let work=0;
 for(let index=0;index<source.count;index++){
  const at=source.offsets[index],flags=view.getUint8(at+3),pressure=!!(flags&1),count=view.getUint32(at+12,true),stride=pressure?24:16,begin=at+16,hex=[source.bytes[at],source.bytes[at+1],source.bytes[at+2]].map(v=>v.toString(16).padStart(2,'0')).join(''),colour='#'+[...hex].map((c,n)=>flags&(1<<(n+1))?c.toUpperCase():c).join(''),writer=hashWriter().write('{"colorHex":'+JSON.stringify(colour)+',"width":'+String(view.getFloat64(at+4,true))+',"points":[');
  for(let i=0;i<count;i++){const point=begin+i*stride;writer.write((i?',':'')+'{"x":'+String(view.getFloat64(point,true))+',"y":'+String(view.getFloat64(point+8,true))+'}');if(++work%8192===0)await pause();}writer.write(']');if(pressure){writer.write(',"pressures":[');for(let i=0;i<count;i++){writer.write((i?',':'')+String(view.getFloat64(begin+i*stride+16,true)));if(++work%8192===0)await pause();}writer.write(']');}const hash=writer.write('}').digest();hashes.setUint32(index*8,parseInt(hash.slice(0,8),16),true);hashes.setUint32(index*8+4,parseInt(hash.slice(8),16),true);if(++work%8192===0)await pause();
 }
 await pause();return hashBytes;
}
async function normalizeBinaryDrawing(input,{signal,yieldControl=graphics.yieldTask}={}){
 const pause=async()=>{if(signal?.aborted)throw Error('Drawing load cancelled.');await yieldControl();if(signal?.aborted)throw Error('Drawing load cancelled.');},source=await inspectBinaryDrawing(input,{signal,yieldControl:pause}),{backdrop,...metadata}=source.metadata;metadata.backdrop=null;
 const prefix=await graphics.encodeBytesAsync({...metadata,strokes:[]},{signal,yieldControl:pause}),start=source.offsets[0],length=prefix.length+source.bytes.length-start;if(length>graphics.MAX_BINARY_BYTES)throw Error('This graphics pane is too large.');const bytes=new Uint8Array(length),header=new DataView(bytes.buffer);bytes.set(prefix);header.setUint32(12,source.count,true);header.setUint32(16,source.points,true);header.setUint32(20,length,true);
 for(let at=start;at<source.bytes.length;at+=65536){bytes.set(source.bytes.subarray(at,at+65536),prefix.length+at-start);await pause();}
 const hashBytes=await fingerprintBinaryDrawing(source,{signal,yieldControl:pause});
 let backdropBytes=null;if(backdrop){backdropBytes=new Uint8Array(backdrop.length);const encode=new TextEncoder();for(let at=0;at<backdrop.length;at+=65536){backdropBytes.set(encode.encode(backdrop.slice(at,at+65536)),at);await pause();}}
 await pause();return {bytes,metadata,hashBytes,backdropBytes,backdropHash:backdrop?fingerprint(backdrop):null};
}
module.exports={normalizeBinaryDrawing,fingerprintBinaryDrawing};
