// Immutable assets shared by successive jobs in one archive worker epoch.
const {randomUUID}=require('node:crypto');
const canonical=token=>typeof token==='string'&&/^[a-f0-9-]{36}$/i.test(token);
const upload=token=>typeof token==='string'&&token.startsWith('upload:')&&canonical(token.slice(7));
class AssetCache{
 constructor({maxBytes=256*1024*1024,maxEntries=20000,uuid=randomUUID}={}){Object.assign(this,{maxBytes,maxEntries,uuid});this.entries=new Map();this.byData=new Map();this.byHash=new Map();this.bytes=0;}
 remove(token){const old=this.entries.get(token);if(!old)return;this.entries.delete(token);if(this.byData.get(old.data)===token)this.byData.delete(old.data);if(old.hash&&this.byHash.get(old.hash)===token)this.byHash.delete(old.hash);this.bytes-=old.data.length;}
 trim(){for(const token of this.entries.keys()){if(this.bytes<=this.maxBytes&&this.entries.size<=this.maxEntries)break;this.remove(token);}}
 remember(token,data,epoch){
  if(!canonical(token)||typeof data!=='string')throw Error('Invalid archive asset reference.');
  const existing=this.entries.get(token);if(existing){if(existing.data!==data)throw Error('An archive asset reference cannot be changed.');this.entries.delete(token);existing.epoch=epoch??existing.epoch;this.entries.set(token,existing);return existing;}
  const alias=this.entries.get(this.byData.get(data));if(alias)data=alias.data;
  const entry={data,epoch};this.entries.set(token,entry);this.byData.set(data,token);this.bytes+=data.length;return entry;
 }
 stats(){return {bytes:this.bytes,entries:this.entries.size};}
 clear(){this.entries.clear();this.byData.clear();this.byHash.clear();this.bytes=0;}
}
class ArchiveAssetClient extends AssetCache{
 constructor(options){super(options);this.uploads=0;}
 remember(token,data,epoch){const previous=this.byData.get(data),entry=super.remember(token,data,epoch);if(previous&&previous!==token)this.remove(previous);return entry;}
 packet(doc,epoch){
  const {assets={},...document}=doc,refs=Object.create(null),added={},source=new Map(),local=new Map();
  for(const [name,data]of Object.entries(assets)){
   if(typeof data!=='string')throw Error('Invalid archive asset.');
   let token=local.get(data),entry;if(!token){token=this.byData.get(data);entry=this.entries.get(token);if(!entry||entry.epoch!==epoch){token='upload:'+this.uuid();added[token]=data;this.uploads++;}else{this.entries.delete(token);this.entries.set(token,entry);}local.set(data,token);}
   refs[name]=token;source.set(token,data);
  }
  return {wire:{document,refs,added},source};
 }
 retry(packet,missing){
  const refs={...packet.wire.refs},added={...packet.wire.added};
  for(const token of missing){const data=packet.source.get(token);if(data===undefined)throw Error('An archive asset reference expired.');const fresh='upload:'+this.uuid();for(const name of Object.keys(refs))if(refs[name]===token)refs[name]=fresh;delete added[token];added[fresh]=data;packet.source.set(fresh,data);this.remove(token);this.uploads++;}
  packet.wire={...packet.wire,refs,added};return packet;
 }
 accepted(values,packet,epoch){for(const [input,token]of Object.entries(values||{})){const data=packet?.source.get(input);if(data===undefined)throw Error('Invalid archive asset acknowledgement.');this.remember(token,data,epoch);packet.source.set(token,data);}}
 hydrate(document,wire,source,epoch){
  if(!wire)return document;const assets=Object.create(null);
  for(const [name,token]of Object.entries(wire.refs||{})){
   const data=Object.hasOwn(wire.added||{},token)?wire.added[token]:source?.get(token)??this.entries.get(token)?.data;if(typeof data!=='string')throw Error('A returned archive asset is missing.');
   assets[name]=this.remember(token,data,epoch).data;
  }
  return {...document,assets:Object.fromEntries(Object.entries(assets))};
 }
}
class ArchiveAssetWorker extends AssetCache{
 constructor(options){super(options);this.uploads=0;this.decodeReuses=0;}
 receive(packet){
  if(!packet)return {doc:null,refs:{},accepted:{}};
  if(!packet.document||Object.hasOwn(packet.document,'assets')||!packet.refs||!packet.added)throw Error('Invalid archive asset packet.');
  const refs=Object.entries(packet.refs),added=Object.entries(packet.added),missing=[],assets=Object.create(null),accepted={},canonicalRefs={};
  if(refs.length>9998||added.length>9998)throw Error('Too many archive assets.');
  const used=new Set(refs.map(([,token])=>token));for(const [token,data]of added)if(!upload(token)||!used.has(token)||typeof data!=='string')throw Error('Canonical archive references cannot be uploaded or rebound.');
  for(const [,token]of refs){if(!(canonical(token)||upload(token)))throw Error('Invalid archive asset reference.');if(!Object.hasOwn(packet.added,token)&&!this.entries.has(token)&&!missing.includes(token))missing.push(token);}
  if(missing.length)return {missing};
  for(const [name,input]of refs){
   const data=Object.hasOwn(packet.added,input)?packet.added[input]:this.entries.get(input).data;let token=input;
   if(upload(input)){token=this.byData.get(data);if(!this.entries.has(token))token=this.uuid();this.uploads++;}
   const entry=this.remember(token,data);assets[name]=entry.data;canonicalRefs[name]=token;accepted[input]=token;
  }
  return {doc:{...packet.document,assets:Object.fromEntries(Object.entries(assets))},refs:canonicalRefs,accepted};
 }
 observe(token,bytes,info){
  const entry=this.entries.get(token);if(!entry)return;
  if(entry.hash&&entry.hash!==info.sha256)throw Error('An archive asset digest cannot be changed.');
  if(entry.hash===info.sha256&&entry.binaryBytes===bytes.length&&typeof entry.canonical==='boolean')return;
  entry.hash=info.sha256;entry.binaryBytes=bytes.length;
  // Noncanonical legacy base64 must still decode to the same normalized string as before.
  entry.canonical ??= entry.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data)&&entry.data.length===4*Math.ceil(bytes.length/3)&&Buffer.from(entry.data.slice(-4),'base64').toString('base64')===entry.data.slice(-4);
  if(entry.canonical)this.byHash.set(entry.hash,token);
 }
 resolve(bytes,info){
  const token=this.byHash.get(info.sha256),entry=this.entries.get(token);
  if(entry&&entry.binaryBytes===bytes.length&&entry.canonical){this.entries.delete(token);this.entries.set(token,entry);this.decodeReuses++;return entry.data;}
  const data=bytes.toString('base64');let fresh=this.byData.get(data);if(!this.entries.has(fresh))fresh=this.uuid();const created=this.remember(fresh,data);created.hash=info.sha256;created.binaryBytes=bytes.length;created.canonical=true;this.byHash.set(info.sha256,fresh);return created.data;
 }
 pack(doc,known){
  if(!doc||typeof doc.text!=='string'||!doc.assets)return {document:doc,wire:null};const {assets,...document}=doc,refs=Object.create(null),added={};
  for(const [name,data]of Object.entries(assets)){let token=this.byData.get(data);if(!this.entries.has(token))token=this.uuid();const entry=this.remember(token,data);refs[name]=token;if(!known.has(token))added[token]=entry.data;}
  return {document,wire:{refs,added}};
 }
 stats(){return {...super.stats(),uploads:this.uploads,decodeReuses:this.decodeReuses};}
}
module.exports={ArchiveAssetClient,ArchiveAssetWorker};
