const graphics=require('./graphics-pane.js'),{ownOverviewBytes}=require('./overview-packet.cjs');
function create({sync,yieldControl=graphics.yieldTask}={}){
 return async(packet,{signal}={})=>{
  const source=packet.backdropBytes;if(!ArrayBuffer.isView(source))return packet;const bytes=new Uint8Array(source.buffer,source.byteOffset,source.byteLength),decoder=new TextDecoder(),prefix=decoder.decode(bytes.subarray(0,128)),match=/^data:image\/svg\+xml;base64,/i.exec(prefix);if(!match)return packet;
  if(!sync?.overviewThumbnail)throw Error('SVG page previews are unavailable.');const check=()=>signal?.throwIfAborted();check();let data='',carry='',padded=false;const chunks=[];
  for(let at=match[0].length;at<bytes.length;at+=262144){check();const raw=decoder.decode(bytes.subarray(at,Math.min(bytes.length,at+262144)));if(!/^[a-z0-9+/=\r\n]*$/i.test(raw))throw Error('Invalid SVG page background.');const text=raw.replace(/[\r\n]/g,'');if(padded&&text)throw Error('Invalid SVG page background.');carry+=text;const length=Math.floor(carry.length/4)*4;if(length){const part=carry.slice(0,length);carry=carry.slice(length);if(!/^[a-z0-9+/]*={0,2}$/i.test(part))throw Error('Invalid SVG page background.');padded=part.includes('=');data+=part;chunks.push(part);}await yieldControl();}
  if(carry||!data)throw Error('Invalid SVG page background.');
  const assets={'assets/overview.svg':data};sync.hint(assets,'assets/overview.svg',data,chunks);
  // Only this private thumbnail packet is consumed; live page/user buffers stay intact.
  if(packet.owned&&source.buffer!==packet.bytes?.buffer&&source.byteOffset===0&&source.byteLength===source.buffer.byteLength&&typeof source.buffer.transfer==='function')source.buffer.transfer(0);
  const result=await sync.overviewThumbnail({text:'',assets},{signal});check();const png=result.assets?.['assets/overview.png'];if(typeof png!=='string'||png.length>4*Math.ceil(1024*1024/3))throw Error('Invalid SVG page preview.');
  return{...packet,backdropBytes:ownOverviewBytes(new TextEncoder().encode('data:image/png;base64,'+png),packet)};
 };
}
module.exports={create};
