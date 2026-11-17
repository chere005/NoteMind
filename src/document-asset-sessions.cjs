// Immutable, renderer-owned asset references. A missing reference is reported before an operation starts.
const {randomUUID}=require('node:crypto');
const TOKEN=/^[a-f0-9-]{36}$/i;
// Markdown documents can legitimately use URL-encoded or Unicode relative names; this layer performs no path I/O.
function validName(name){return typeof name==='string'&&name.length>0&&name.length<=8192&&!name.includes('\0');}
function validToken(token){return typeof token==='string'&&TOKEN.test(token);}
const uploadToken=token=>typeof token==='string'&&token.startsWith('upload:')&&validToken(token.slice(7));
class DocumentAssetSessions{
 constructor({maxBytes=384*1024*1024,maxEntries=20000,uuid=randomUUID}={}){Object.assign(this,{maxBytes,maxEntries,uuid});this.sessions=new Map();this.closedOwners=new WeakSet();}
 session(owner){
  if(!owner||this.closedOwners.has(owner)||owner.isDestroyed?.())throw Error('The document window is closed.');let state=this.sessions.get(owner);
  if(!state){state={entries:new Map(),byData:new Map(),bytes:0};this.sessions.set(owner,state);owner.once?.('destroyed',()=>{this.closedOwners.add(owner);this.sessions.delete(owner);});}
  return state;
 }
 remove(state,token){const entry=state.entries.get(token);if(!entry)return;state.entries.delete(token);if(state.byData.get(entry.data)===token)state.byData.delete(entry.data);state.bytes-=entry.data.length;}
 trim(state,protectedTokens=new Set()){
  for(const token of state.entries.keys()){if(state.bytes<=this.maxBytes&&state.entries.size<=this.maxEntries)break;if(!protectedTokens.has(token))this.remove(state,token);}
 }
 remember(state,token,data){
  const existing=state.entries.get(token);if(existing){if(existing.data!==data)throw Error('An asset reference cannot be changed.');state.entries.delete(token);state.entries.set(token,existing);return;}
  const alias=state.entries.get(state.byData.get(data));if(alias)data=alias.data;
  state.entries.set(token,{data});state.byData.set(data,token);state.bytes+=data.length;
 }
 seed(owner,doc){
  if(!doc||!doc.assets||typeof doc.assets!=='object')return doc;const state=this.session(owner),refs=Object.create(null),protectedTokens=new Set();let bytes=0;
  for(const [name,data]of Object.entries(doc.assets)){if(!validName(name)||typeof data!=='string')throw Error('Invalid document asset.');bytes+=data.length;if(bytes>this.maxBytes)throw Error('The document assets exceed the transfer cache limit.');let token=state.byData.get(data);if(!state.entries.has(token))token=this.uuid();this.remember(state,token,data);refs[name]=token;protectedTokens.add(token);}
  if(protectedTokens.size>this.maxEntries)throw Error('Too many document assets.');this.trim(state,protectedTokens);
  return {...doc,__notemindAssetTokens:{version:1,refs}};
 }
 receive(owner,packet){
  if(!packet||packet.version!==1||!packet.document||typeof packet.document.text!=='string'||Object.hasOwn(packet.document,'assets')||!packet.assets||typeof packet.assets!=='object'||Array.isArray(packet.assets)||!packet.added||typeof packet.added!=='object'||Array.isArray(packet.added))throw Error('Invalid document transfer.');
  const state=this.session(owner),refs=Object.entries(packet.assets),newData=Object.entries(packet.added),protectedTokens=new Set(),missing=[],assets=Object.create(null),source=new Map(),accepted={};let bytes=0;
  if(refs.length>9998||newData.length>9998)throw Error('Too many document assets.');
  for(const [name,token]of refs){if(!validName(name)||!(validToken(token)||uploadToken(token)))throw Error('Invalid document asset reference.');protectedTokens.add(token);}
  for(const [token,data]of newData){if(!uploadToken(token)||!protectedTokens.has(token)||typeof data!=='string'||data.length>this.maxBytes||!(/^[A-Za-z0-9+/]*={0,2}$/).test(data)||data.length%4!==0)throw Error('Invalid transferred asset.');const old=state.entries.get(token);if(old&&old.data!==data)throw Error('An asset reference cannot be changed.');}
  for(const [name,token]of refs){const data=Object.hasOwn(packet.added,token)?packet.added[token]:state.entries.get(token)?.data;if(data===undefined){if(!missing.includes(token))missing.push(token);continue;}assets[name]=data;source.set(data,token);}
  if(missing.length)return {missing};
  for(const data of new Set(Object.values(assets))){bytes+=data.length;if(bytes>this.maxBytes)throw Error('The document assets exceed the transfer cache limit.');}
  if(protectedTokens.size>this.maxEntries)throw Error('Too many document assets.');
  protectedTokens.clear();
  for(const [name,input]of refs){const data=assets[name];let token=input;if(uploadToken(input)){token=state.byData.get(data);if(!state.entries.has(token))token=this.uuid();}this.remember(state,token,data);accepted[input]=token;source.set(data,token);protectedTokens.add(token);}this.trim(state,protectedTokens);
  return {doc:{...packet.document,assets:Object.fromEntries(Object.entries(assets))},source,accepted};
 }
 pack(owner,doc,source=new Map()){
  if(doc==null)return {kind:'value',value:doc};if(typeof doc.text!=='string'||!doc.assets||typeof doc.assets!=='object')return {kind:'value',value:doc};
  const state=this.session(owner),{assets,...document}=doc,refs=Object.create(null),added={},protectedTokens=new Set();let bytes=0;
  for(const [name,data]of Object.entries(assets)){
   if(!validName(name)||typeof data!=='string')throw Error('Invalid document asset.');bytes+=data.length;if(bytes>this.maxBytes)throw Error('The document assets exceed the transfer cache limit.');
   let token=source.get(data);if(!token){token=state.byData.get(data);if(!state.entries.has(token))token=this.uuid();added[token]=data;}
   this.remember(state,token,data);refs[name]=token;protectedTokens.add(token);
  }
  this.trim(state,protectedTokens);return {kind:'document',document,assets:refs,added};
 }
 async run(owner,packet,operation){
  const received=this.receive(owner,packet);if(received.missing)return {version:1,missing:received.missing};
  const value=await operation(received.doc);return {version:1,accepted:received.accepted,value:this.pack(owner,value,received.source)};
 }
 retain(owner,tokens){if(!Array.isArray(tokens)||tokens.length>this.maxEntries||tokens.some(token=>!validToken(token)))throw Error('Invalid retained asset references.');const state=this.session(owner),kept=new Set(tokens);for(const token of state.entries.keys())if(!kept.has(token))this.remove(state,token);}
 dispose(owner){if(owner){this.closedOwners.add(owner);this.sessions.delete(owner);}else this.sessions.clear();}
 stats(owner){const state=this.sessions.get(owner);return {bytes:state?.bytes||0,entries:state?.entries.size||0,sessions:this.sessions.size};}
}
module.exports={DocumentAssetSessions};
