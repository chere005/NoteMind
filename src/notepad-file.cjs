// Public ZIP compatibility with one asset source at a time and no aggregate archive Buffer.
const {createHash,randomUUID}=require('node:crypto');
const {isMarkedAsUntransferable}=require('node:worker_threads');
const {ENTRY_BYTES,TOTAL_BYTES,maximumEntryBytes,validateEntry}=require('./archive-limits.cjs');
const {writeZipFile}=require('./zip-stream.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const utf8=value=>{const bytes=Buffer.allocUnsafeSlow(Buffer.byteLength(value,'utf8'));bytes.write(value,'utf8');return bytes;};
const assetName=name=>/^assets\/[\w./ -]+$/.test(name)&&!name.split('/').some(part=>part==='..'||part==='.'||!part);
const discard=bytes=>{if(bytes?.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&!isMarkedAsUntransferable?.(bytes.buffer)&&typeof bytes.buffer.transfer==='function')try{bytes.buffer.transfer(0)}catch{}};
const stored=name=>/\.(?:jpe?g|png|gif|webp|avif|zip|gz|zst)$/i.test(name);
async function writeNotepadFile(doc,{kind='notepad',extra={}}={},target,{hooks={},check=()=>{},writer=writeZipFile}={}){
 if(!['notepad','drawing','workspace'].includes(kind)||typeof doc?.text!=='string')throw Error('Invalid Notepad document.');
 const metadata=[],entries=[],index=Object.create(null);let total=0;
 const add=(name,bytes)=>{metadata.push(bytes);validateEntry(name,bytes);total+=bytes.length;if(total>TOTAL_BYTES)throw Error('This Notepad is too large. Use fewer or smaller images.');index[name]={bytes:bytes.length,sha256:hash(bytes)};entries.push({name,data:bytes});};
 try{
  check();add('document.md',utf8(doc.text));
  const assets=Object.entries(doc.assets||{}),extras=Object.entries(extra);if(assets.length+extras.length+1>9999)throw Error('Too many archive entries.');
  for(const[name,value]of assets){
   check();if(!assetName(name))throw Error('Invalid image path: '+name);
   let info=hooks.assetInfo?.(name),bytes,owned=false;
   try{
    if(!info||!hooks.validateAsset?.(name)){
     const resolved=hooks.assetBytes?.(name,value);if(resolved!==undefined){if(!(resolved instanceof Uint8Array))throw Error('Invalid raw archive asset.');bytes=resolved;}
     else{if(typeof value!=='string')throw Error('Invalid archive asset.');bytes=Buffer.from(value,'base64');owned=true;}
     validateEntry(name,bytes);const exact={bytes:bytes.length,sha256:hash(bytes)};if(info&&(info.bytes!==exact.bytes||info.sha256!==exact.sha256))throw Error('Invalid archive asset digest.');info=exact;
    }
    if(!info||!Number.isSafeInteger(info.bytes)||info.bytes<0||info.bytes>maximumEntryBytes(name)||typeof info.sha256!=='string'||!/^[a-f0-9]{64}$/.test(info.sha256))throw Error('Invalid archive asset digest.');
    if((total+=info.bytes)>TOTAL_BYTES)throw Error('This Notepad is too large. Use fewer or smaller images.');index[name]={bytes:info.bytes,sha256:info.sha256};
    entries.push({name,bytes:info.bytes,sha256:info.sha256,store:stored(name),source:async function*(){
     check();const stream=await hooks.assetSource?.(name,value);if(stream!==undefined){for await(const chunk of stream){check();yield chunk;}return;}
     const resolved=hooks.assetBytes?.(name,value);let data;if(resolved!==undefined){if(!(resolved instanceof Uint8Array))throw Error('Invalid raw archive asset.');data=resolved;}else data=Buffer.from(value,'base64');
     try{if(data.length!==info.bytes)throw Error('Archive asset length changed.');for(let at=0;at<data.length;at+=512*1024){check();yield data.subarray(at,Math.min(data.length,at+512*1024));}}
     finally{if(resolved===undefined)discard(data);data=null;}
    }});
   }finally{if(owned)discard(bytes);}
  }
  for(const[name,value]of extras){check();if(!['drawing.json','workspace.json','recovery.json'].includes(name))throw Error('Invalid attachment');add(name,utf8(JSON.stringify(value)));}
  const manifest={format:'notemind',version:1,kind,id:doc.id||randomUUID(),title:doc.title||'',created:doc.created||new Date().toISOString(),meta:doc.meta||{},modified:new Date().toISOString(),content:'document.md',files:index},bytes=utf8(JSON.stringify(manifest,null,2));metadata.push(bytes);
  if(bytes.length>ENTRY_BYTES||total+bytes.length>TOTAL_BYTES)throw Error('This Notepad is too large. Use fewer or smaller images.');
  check();const receipt=await writer([{name:'manifest.json',data:bytes},...entries],{...target,check},{maxBytes:200*1024*1024});if(receipt?.warnings)receipt.warnings=receipt.warnings.map(message=>String(message).replace(/\bWord\b/g,'Notepad'));return receipt;
 }catch(error){if(error instanceof Error&&/\bWord\b/.test(error.message))error.message=error.message.replace(/\bWord\b/g,'Notepad');throw error;}
 finally{for(const bytes of metadata)discard(bytes);}
}
module.exports={writeNotepadFile};
