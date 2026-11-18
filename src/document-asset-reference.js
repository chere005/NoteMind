// App-only immutable values. Public document serialization still resolves bytes
// through DocumentSync; references never decompress or coerce synchronously.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.NoteMindAssetReferences=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 const known=new WeakMap(),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/,LIMIT=150*1024*1024;
 const noCoercion=()=>{throw Error('Resolve document assets through the document transfer API.');};
 function create(info){
  if(!info||typeof info.id!=='string'||!UUID.test(info.id)||!Number.isSafeInteger(info.bytes)||info.bytes<0||info.bytes>LIMIT||info.chars!==4*Math.ceil(info.bytes/3)||typeof info.sha256!=='string'||!HASH.test(info.sha256)||typeof info.mime!=='string'||info.mime.length>128||typeof info.binaryGraphics!=='boolean')throw Error('Invalid immutable document asset reference.');
  const metadata=Object.freeze({kind:'notemind-asset-reference-v1',id:info.id,bytes:info.bytes,chars:info.chars,sha256:info.sha256,mime:info.mime,binaryGraphics:info.binaryGraphics}),value={...metadata};
  Object.defineProperties(value,{toJSON:{value:noCoercion},[Symbol.toPrimitive]:{value:noCoercion}});Object.freeze(value);known.set(value,{metadata,key:Object.freeze({})});return value;
 }
 const is=value=>!!value&&typeof value==='object'&&known.has(value);
 const describe=value=>known.get(value)?.metadata||null;
 const identity=value=>known.get(value)?.key||null;
 const same=(left,right)=>{if(left===right)return true;const a=describe(left),b=describe(right);return !!a&&!!b&&a.id===b.id&&a.bytes===b.bytes&&a.chars===b.chars&&a.sha256===b.sha256&&a.mime===b.mime&&a.binaryGraphics===b.binaryGraphics;};
 return{create,is,describe,identity,same};
});
