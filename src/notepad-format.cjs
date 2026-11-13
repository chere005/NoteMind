const {pack,unpack}=require('./zip.cjs');
const {createHash,randomUUID}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assetName=name=>/^assets\/[\w./ -]+$/.test(name)&&!name.split('/').some(p=>p==='..'||p==='.'||!p);
function encode(doc,{kind='notepad',extra={}}={}){
 if(!['notepad','drawing','workspace'].includes(kind)||typeof doc.text!=='string')throw Error('Invalid Notepad document.');
 const files={'document.md':Buffer.from(doc.text,'utf8')};
 for(const [name,value] of Object.entries(doc.assets||{})){if(!assetName(name))throw Error('Invalid image path: '+name);files[name]=Buffer.from(value,'base64');}
 for(const [name,value] of Object.entries(extra)){if(!['drawing.json','workspace.json'].includes(name))throw Error('Invalid attachment');files[name]=Buffer.from(JSON.stringify(value));}
 const sizes=Object.values(files).map(b=>b.length);if(sizes.length>9999||sizes.some(n=>n>50*1024*1024)||sizes.reduce((a,b)=>a+b,0)>199*1024*1024)throw Error('This Notepad is too large. Use fewer or smaller images.');
 const manifest={format:'notemind',version:1,kind,id:doc.id||randomUUID(),title:doc.title||'',created:doc.created||new Date().toISOString(),meta:doc.meta||{},modified:new Date().toISOString(),content:'document.md',files:Object.fromEntries(Object.entries(files).map(([name,data])=>[name,{bytes:data.length,sha256:hash(data)}]))};
 return pack({'manifest.json':Buffer.from(JSON.stringify(manifest,null,2)),...files});
}
function decode(bytes){
 const files=unpack(bytes);let manifest=null;
 if(files['manifest.json']){try{manifest=JSON.parse(files['manifest.json'])}catch{throw Error('The Notepad manifest is invalid.');}
  if(manifest.format!=='notemind'||manifest.version!==1||!['notepad','drawing','workspace'].includes(manifest.kind)||manifest.content!=='document.md')throw Error('This Notepad format is not supported.');
  if(!manifest.files||typeof manifest.files!=='object')throw Error('The Notepad file index is missing.');
  for(const [name,info] of Object.entries(manifest.files)){const value=files[name];if(!value||value.length!==info.bytes||hash(value)!==info.sha256)throw Error('The Notepad attachment is damaged: '+name);}
  for(const name of Object.keys(files))if(name!=='manifest.json'&&!manifest.files[name])throw Error('The Notepad contains an unlisted attachment: '+name);
 }
 if(!files['document.md'])throw Error('The Notepad text is missing.');
 const assets={};for(const [name,value]of Object.entries(files)){if(name.startsWith('assets/')){if(!assetName(name))throw Error('Invalid image path.');assets[name]=value.toString('base64');}}
 return {text:files['document.md'].toString('utf8'),assets,id:manifest?.id,title:manifest?.title,meta:manifest?.meta||{},created:manifest?.created,kind:manifest?.kind||(files['workspace.json']?'workspace':files['drawing.json']?'drawing':'notepad'),files};
}
module.exports={encode,decode};
