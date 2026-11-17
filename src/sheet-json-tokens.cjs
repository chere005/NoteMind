const fs=require('node:fs'),{createHash}=require('node:crypto');
const MAX_LEGACY_BYTES=512*1024*1024,MAX_METADATA_BYTES=8*1024*1024;
// Streaming syntax/UTF8 validation is delegated to stream-json; no drawing graph is assembled.
async function* legacyTokenBatches(file,{onBytes=()=>{},maxBytes=MAX_LEGACY_BYTES}={}){
 const {jsonParser}=require('stream-json/parser.js'),{none,isMany,getManyValues}=require('stream-chain/core'),parse=jsonParser({streamValues:false,packStrings:false,maxDepth:64,maxPackedLength:8192}),decode=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),source=fs.createReadStream(file,{highWaterMark:65536});let bytes=0;
 const tokens=value=>value===none?[]:isMany(value)?getManyValues(value):[value];
 try{for await(const chunk of source){bytes+=chunk.length;if(bytes>maxBytes)throw Error('Saved drawing sheets are too large to migrate.');onBytes(chunk);yield tokens(parse(decode.decode(chunk,{stream:true})));}const tail=decode.decode();if(tail)yield tokens(parse(tail));yield tokens(parse(none));}finally{source.destroy();}
}
async function* legacyTokens(file,options){for await(const batch of legacyTokenBatches(file,options))yield*batch;}
class CanonicalJSON{
 constructor(write){this.write=write;this.stack=[];this.string=false;this.surrogate='';}
 before(){const parent=this.stack.at(-1);if(parent?.kind==='array'){if(parent.count++)this.write(',');}}
 token(token){
  const name=token.name;if(name==='keyValue'){const current=this.stack.at(-1);if(!current||current.kind!=='object'||current.keys.has(token.value))throw Error('Duplicate or invalid drawing JSON property.');current.keys.add(token.value);if(current.count++)this.write(',');this.write(JSON.stringify(token.value)+':');}
  else if(name==='startObject'||name==='startArray'){this.before();this.write(name==='startObject'?'{':'[');this.stack.push({kind:name==='startObject'?'object':'array',count:0,keys:new Set()});}
  else if(name==='endObject'||name==='endArray'){this.write(name==='endObject'?'}':']');this.stack.pop();}
  else if(name==='startString'){this.before();this.string=true;this.write('"');}
  else if(name==='stringChunk'){if(!this.string)throw Error('Invalid drawing JSON string.');let value=this.surrogate+token.value;this.surrogate='';if(value.charCodeAt(value.length-1)>=0xd800&&value.charCodeAt(value.length-1)<=0xdbff){this.surrogate=value.at(-1);value=value.slice(0,-1);}this.write(JSON.stringify(value).slice(1,-1));}
  else if(name==='endString'){if(this.surrogate){this.write(JSON.stringify(this.surrogate).slice(1,-1));this.surrogate='';}this.string=false;this.write('"');}
  else if(name==='numberValue'){this.before();this.write(JSON.stringify(Number(token.value)));}
  else if(name==='nullValue'||name==='trueValue'||name==='falseValue'){this.before();this.write(JSON.stringify(token.value));}
 }
}
class JSONValue{
 constructor({maxBytes=MAX_METADATA_BYTES}={}){this.maxBytes=maxBytes;this.bytes=0;this.stack=[];this.root=undefined;this.string=null;this.complete=false;}
 charge(bytes){this.bytes+=bytes;if(this.bytes>this.maxBytes)throw Error('Drawing metadata is too large.');}
 value(value){const parent=this.stack.at(-1);if(!parent)this.root=value;else if(Array.isArray(parent.value))parent.value.push(value);else{if(parent.key===null)throw Error('Invalid drawing metadata.');Object.defineProperty(parent.value,parent.key,{value,writable:true,enumerable:true,configurable:true});parent.key=null;}if(!this.stack.length)this.complete=true;}
 token(token){
  const name=token.name;if(name==='keyValue'){this.charge(token.value.length*2+32);const parent=this.stack.at(-1);if(!parent||Array.isArray(parent.value)||parent.seen.has(token.value))throw Error('Duplicate drawing metadata property.');parent.key=token.value;parent.seen.add(token.value);}
  else if(name==='startObject'||name==='startArray'){this.charge(64);const value=name==='startObject'?Object.create(null):[];this.value(value);this.complete=false;this.stack.push({value,key:null,seen:new Set()});}
  else if(name==='endObject'||name==='endArray'){this.stack.pop();if(!this.stack.length)this.complete=true;}
  else if(name==='startString')this.string='';
  else if(name==='stringChunk'){this.charge(token.value.length*2);this.string+=token.value;}
  else if(name==='endString'){const value=this.string;this.string=null;this.value(value);}
  else if(name==='numberValue'){this.charge(16);this.value(Number(token.value));}
  else if(name==='nullValue'||name==='trueValue'||name==='falseValue'){this.charge(8);this.value(token.value);}
  return this.complete;
 }
}
const sha=()=>createHash('sha256');
function textSHA(){const hash=sha();let parts=[],length=0,surrogate='';const flush=()=>{if(length)hash.update(parts.join(''));parts=[];length=0;};return {update(piece){piece=surrogate+piece;surrogate='';if(piece.charCodeAt(piece.length-1)>=0xd800&&piece.charCodeAt(piece.length-1)<=0xdbff){surrogate=piece.at(-1);piece=piece.slice(0,-1);}parts.push(piece);length+=piece.length;if(length>=8192)flush();return this;},digest(){if(surrogate){parts.push(surrogate);length++;surrogate='';}flush();return hash.digest('hex');}};}
module.exports={legacyTokens,legacyTokenBatches,CanonicalJSON,JSONValue,MAX_LEGACY_BYTES,MAX_METADATA_BYTES,sha,textSHA};
