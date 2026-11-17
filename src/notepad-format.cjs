const {pack,unpack}=require('./zip.cjs');
const {createHash,randomUUID}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {ENTRY_BYTES,TOTAL_BYTES,validateEntry}=require('./archive-limits.cjs');
const assetName=name=>/^assets\/[\w./ -]+$/.test(name)&&!name.split('/').some(p=>p==='..'||p==='.'||!p);
function encode(doc,{kind='notepad',extra={}}={},hooks={}){
 if(!['notepad','drawing','workspace'].includes(kind)||typeof doc.text!=='string')throw Error('Invalid Notepad document.');
 const files={'document.md':Buffer.from(doc.text,'utf8')};
 for(const [name,value] of Object.entries(doc.assets||{})){if(!assetName(name))throw Error('Invalid image path: '+name);files[name]=Buffer.from(value,'base64');}
 for(const [name,value] of Object.entries(extra)){if(!['drawing.json','workspace.json','recovery.json'].includes(name))throw Error('Invalid attachment');files[name]=Buffer.from(JSON.stringify(value));}
 return encodeFiles(doc,files,kind,hooks);
}
function encodeFiles(doc,files,kind,hooks={}){
 const sizes=Object.values(files).map(b=>b.length);try{for(const [name,bytes]of Object.entries(files))validateEntry(name,bytes);}catch{throw Error('This Notepad is too large. Use fewer or smaller images.');}if(sizes.length>9999||sizes.reduce((a,b)=>a+b,0)>TOTAL_BYTES)throw Error('This Notepad is too large. Use fewer or smaller images.');
 const manifest={format:'notemind',version:1,kind,id:doc.id||randomUUID(),title:doc.title||'',created:doc.created||new Date().toISOString(),meta:doc.meta||{},modified:new Date().toISOString(),content:'document.md',files:Object.fromEntries(Object.entries(files).map(([name,data])=>{const info={bytes:data.length,sha256:hash(data)};if(name.startsWith('assets/'))hooks.asset?.(name,data,info);return [name,info];}))};
 const index=Buffer.from(JSON.stringify(manifest,null,2));if(index.length>ENTRY_BYTES||sizes.reduce((a,b)=>a+b,index.length)>TOTAL_BYTES)throw Error('This Notepad is too large. Use fewer or smaller images.');
 return pack({'manifest.json':index,...files});
}
function encodeDrawingOwned(packet){
 if(!packet||typeof packet!=='object'||Object.keys(packet).length!==2||!['graphics','image'].every(key=>Object.hasOwn(packet,key)&&ArrayBuffer.isView(packet[key])&&packet[key].buffer instanceof ArrayBuffer))throw Error('Invalid drawing assets.');
 const graphics=Buffer.from(packet.graphics.buffer,packet.graphics.byteOffset,packet.graphics.byteLength),image=Buffer.from(packet.image.buffer,packet.image.byteOffset,packet.image.byteLength);const geometry=require('./graphics-pane.js');if(!geometry.isBinary(graphics))throw Error('Invalid binary drawing assets.');geometry.validateBinary(graphics);
 const doc={text:'![Drawing](assets/drawing.svg)\n',meta:{graphicsPanes:{'assets/drawing.svg':{version:1}}}},files={'document.md':Buffer.from(doc.text),'assets/drawing.svg':image,'assets/drawing.svg.json':graphics,'drawing.json':Buffer.from(JSON.stringify({sheet:'assets/drawing.svg.json',image:'assets/drawing.svg'}))};return encodeFiles(doc,files,'drawing');
}

function decode(bytes,hooks={}){
 const files=unpack(bytes);let manifest=null;
 if(files['manifest.json']){try{manifest=JSON.parse(files['manifest.json'])}catch{throw Error('The Notepad manifest is invalid.');}
  if(manifest.format!=='notemind'||manifest.version!==1||!['notepad','drawing','workspace'].includes(manifest.kind)||manifest.content!=='document.md')throw Error('This Notepad format is not supported.');
  if(!manifest.files||typeof manifest.files!=='object')throw Error('The Notepad file index is missing.');
  for(const [name,info] of Object.entries(manifest.files)){const value=files[name];if(!value||value.length!==info.bytes||hash(value)!==info.sha256)throw Error('The Notepad attachment is damaged: '+name);}
  for(const name of Object.keys(files))if(name!=='manifest.json'&&!manifest.files[name])throw Error('The Notepad contains an unlisted attachment: '+name);
 }
 if(!files['document.md'])throw Error('The Notepad text is missing.');
 const assets={};for(const [name,value]of Object.entries(files)){if(name.startsWith('assets/')){if(!assetName(name))throw Error('Invalid image path.');assets[name]=hooks.asset?.(name,value,manifest?.files[name]||{bytes:value.length,sha256:hash(value)})??value.toString('base64');}}
 return {text:files['document.md'].toString('utf8'),assets,id:manifest?.id,title:manifest?.title,meta:manifest?.meta||{},created:manifest?.created,kind:manifest?.kind||(files['workspace.json']?'workspace':files['drawing.json']?'drawing':'notepad'),files};
}
module.exports={encode,decode,encodeDrawingOwned};
