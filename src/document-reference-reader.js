// Async-only materialization. A yielded chunk belongs to this read until the
// next next()/return(); callers can copy or transfer its exclusive backing.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={create:factory};else root.NoteMindReferenceReader={create:factory};})(typeof globalThis==='object'?globalThis:this,function({references,transfer,hold=()=>()=>{},yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 const CHARS=262144,check=signal=>{if(signal?.aborted)throw Object.assign(Error('Document asset read cancelled.'),{name:'AbortError'})};
 const discard=bytes=>{if(bytes?.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&typeof bytes.buffer.transfer==='function')try{bytes.buffer.transfer(0)}catch{}};
 function info(value){if(references.is(value))return references.describe(value);if(typeof value!=='string'||value.length%4)throw Error('Invalid document asset.');return{bytes:value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0),chars:value.length};}
 async function* legacy(value,{signal}={}){for(let at=0;at<value.length;at+=CHARS){check(signal);let bytes;try{const text=value.slice(at,at+CHARS);bytes=typeof Uint8Array.fromBase64==='function'?Uint8Array.fromBase64(text):Uint8Array.from(atob(text),char=>char.charCodeAt(0));yield bytes;}finally{discard(bytes)}await yieldTask();}}
 function chunks(assets,name,options={}){
  const value=assets?.[name],metadata=info(value),release=hold(assets,name,value);let iterator=null,ended=false,tail=Promise.resolve();
  const finish=async()=>{if(ended)return;ended=true;try{await iterator?.return?.()}finally{release()}};
  const serial=run=>{const result=tail.then(run);tail=result.then(()=>{},()=>{});return result;};
  const output={next:()=>serial(async()=>{if(ended)return{done:true,value:undefined};try{check(options.signal);iterator ||=references.is(value)?transfer.referenceChunks(metadata.id,metadata,options):legacy(value,options);const result=await iterator.next();if(result.done)await finish();return result;}catch(error){await finish();throw error;}}),return:()=>serial(async()=>{await finish();return{done:true,value:undefined}}),[Symbol.asyncIterator](){return this;}};return output;
 }
 async function bytes(assets,name,options){if(references.is(assets?.[name]))throw Error('Use a scoped document asset read.');const expected=info(assets?.[name]).bytes,result=new Uint8Array(expected);let at=0,published=false;try{for await(const chunk of chunks(assets,name,options)){if(!ArrayBuffer.isView(chunk)||Object.prototype.toString.call(chunk)!=='[object Uint8Array]'||!chunk.byteLength||at+chunk.byteLength>expected)throw Error('Document asset read changed.');result.set(chunk,at);at+=chunk.byteLength;}if(at!==expected)throw Error('Document asset read was incomplete.');published=true;return result;}finally{if(!published)discard(result)}}
 async function withBytes(assets,name,options,run){if(typeof run!=='function')throw Error('A document asset consumer is required.');const value=assets?.[name];check(options?.signal);if(references.is(value)){const release=hold(assets,name,value);try{return await transfer.withReferenceBytes(references.describe(value).id,references.describe(value),options,run);}finally{release()}}const data=await bytes(assets,name,options);try{return await run(data)}finally{discard(data)}}
 async function base64(assets,name,options){const value=assets?.[name];if(typeof value==='string')return value;throw Error('Use a scoped document asset read.');}
 return{info,chunks,bytes,base64,withBytes};
});
