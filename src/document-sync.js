(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={create:factory};else root.NoteMindDocumentSync=factory({invoke:packet=>root.notemind.documentCall(packet),uuid:()=>root.crypto.randomUUID(),retain:tokens=>root.notemind.documentRetain?.(tokens)});})(typeof window==='undefined'?this:window,function({invoke,uuid,retain,maxBytes=384*1024*1024,maxEntries=20000}){
 const entries=new Map(),byData=new Map();let bytes=0,retained=null,retainedSignature='';
 function pruneRetained(){if(retained)for(const [token,entry]of entries)if(!retained.has(entry.data))remove(token);}
 function notifyRetained(){if(!retain||!retained)return;const tokens=[...entries.keys()].filter(token=>!token.startsWith('upload:')).sort(),signature=JSON.stringify(tokens);if(signature===retainedSignature)return;retainedSignature=signature;Promise.resolve(retain(tokens)).catch(()=>{});}
 function remove(token){const entry=entries.get(token);if(!entry)return;entries.delete(token);if(byData.get(entry.data)===token)byData.delete(entry.data);bytes-=entry.data.length;}
 function trim(){for(const token of entries.keys()){if(bytes<=maxBytes&&entries.size<=maxEntries)break;remove(token);}}
 function remember(token,data,acknowledged=true){const old=entries.get(token);if(old&&old.data!==data)throw Error('An asset reference cannot be changed.');if(old){entries.delete(token);old.acknowledged ||= acknowledged;entries.set(token,old);}else{entries.set(token,{data,acknowledged});byData.set(data,token);bytes+=data.length;}return token;}
 function seed(doc){if(!doc?.__notemindAssetTokens)return doc;const {__notemindAssetTokens:manifest,...next}=doc;if(manifest.version!==1||!manifest.refs)throw Error('Invalid asset transfer metadata.');for(const [name,token]of Object.entries(manifest.refs)){const data=doc.assets?.[name];if(typeof data!=='string')throw Error('Missing transferred image.');remember(token,data);}trim();return next;}
 function capture(doc){const {assets={},...rest}=doc;return {...structuredClone(rest),assets:{...assets}};}
 function packet(operation,doc,args){
  doc=seed(doc);const {assets={},...rest}=doc,document=structuredClone(rest),refs=Object.create(null),added={},source=new Map();
  for(const [name,data]of Object.entries(assets)){if(typeof data!=='string')throw Error('Invalid document asset.');let token=byData.get(data),entry=entries.get(token);if(!entry){token='upload:'+uuid();remember(token,data,false);entry=entries.get(token);}else remember(token,data,entry.acknowledged);refs[name]=token;source.set(token,data);if(!entry.acknowledged)added[token]=data;}
  trim();return {wire:{version:1,operation,document,assets:refs,added,args:structuredClone(args)},source};
 }
 async function call(operation,doc,...args){
  const captured=packet(operation,doc,args);let response;
  for(let attempt=0;attempt<3;attempt++){
   response=await invoke(captured.wire);if(!response||response.version!==1)throw Error('Invalid document transfer response.');
   if(!response.missing)break;
   const added={...captured.wire.added},assets={...captured.wire.assets};for(const token of response.missing){const data=captured.source.get(token);if(data===undefined)throw Error('A document asset reference expired.');const upload='upload:'+uuid();for(const name of Object.keys(assets))if(assets[name]===token)assets[name]=upload;delete added[token];added[upload]=data;captured.source.set(upload,data);remove(token);}captured.wire={...captured.wire,assets,added};
  }
  if(response.missing)throw Error('Document assets are busy. The current document remains open; try saving again.');
  for(const [input,token]of Object.entries(response.accepted||{})){const data=captured.source.get(input);if(data!==undefined){if(input!==token)remove(input);remember(token,data);captured.source.set(token,data);}}
  const value=response.value;if(value?.kind==='value'){trim();pruneRetained();notifyRetained();return value.value;}if(value?.kind!=='document')throw Error('Invalid document transfer result.');
  const assets=Object.create(null);for(const [name,token]of Object.entries(value.assets||{})){const data=Object.hasOwn(value.added||{},token)?value.added[token]:captured.source.get(token);if(typeof data!=='string')throw Error('A returned document asset is missing.');assets[name]=data;remember(token,data);}
  trim();pruneRetained();notifyRetained();return {...value.document,assets:Object.fromEntries(Object.entries(assets))};
 }
 function api(legacy){return {...legacy,pdfReconcile:doc=>call('pdfReconcile',doc),pdfMatch:(doc,name,sourceHash)=>call('pdfMatch',doc,name,sourceHash),previewOwnedAttachment:(doc,name)=>call('previewAttachment',doc,name),draft:doc=>call('draft',doc),autosave:doc=>call('autosave',doc),snapshot:(doc,label)=>call('snapshot',doc,label),indexImages:(doc,options)=>call('indexImages',doc,options),openDraft:async id=>seed(await legacy.openDraft(id)),resolve:async id=>seed(await legacy.resolve(id)),version:async(id,v)=>seed(await legacy.version(id,v)),recover:async()=>{const value=await legacy.recover();return value?{...value,tabs:value.tabs?.map(seed)}:value;}};}
 function retainMany(assetSets){const used=new Set();for(const assets of assetSets||[])for(const data of Object.values(assets||{}))used.add(data);retained=used;pruneRetained();notifyRetained();}
 return {seed,capture,call,api,save:(doc,saveAs)=>call('save',doc,saveAs),retainMany,stats:()=>({bytes,entries:entries.size})};
});
