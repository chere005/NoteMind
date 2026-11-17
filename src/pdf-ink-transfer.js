(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={create:factory};else root.NoteMindPDFInkTransfer=factory({sync:root.NoteMindDocumentSync,graphics:root.NoteMindGraphics,api:root.notemind.reference});})(typeof window==='undefined'?this:window,function({sync,graphics,api,yieldTask=graphics.yieldTask}){
 const INK='assets/pdf-page.json',BASELINE='assets/pdf-baseline.json',prepared=new WeakSet();
 async function prepare(bytes,{consume=false}={}){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>graphics.MAX_BINARY_BYTES)throw Error('Invalid PDF ink bytes.');
  if(!sync?.call)return{...(api.serialize?await api.serialize(bytes):{}),payload:bytes};
  const chunks=[];let data='';for(let at=0;at<bytes.length;at+=196608){const chunk=graphics.bytesBase64(bytes.subarray(at,Math.min(bytes.length,at+196608)));chunks.push(chunk);data+=chunk;await yieldTask();}
  if(consume&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0);
  const assets={[INK]:data};sync.hint(assets,INK,data,chunks);const document=Object.freeze({text:'',assets:Object.freeze(assets)}),result=await sync.call('pdfInk',document,{mode:'serialize'}),payload=Object.freeze({document});prepared.add(payload);return{data,chunks:Object.freeze(chunks),revision:result.revision,payload};
 }
 async function save(id,value,input){
  if(!prepared.has(input))return api.save(id,{...value,bytes:input});
  const assets=sync.copyAssets(input.document.assets),baseline=value.baseline;
  if(baseline){if(typeof baseline.data!=='string')throw Error('Invalid portable PDF ink baseline.');assets[BASELINE]=baseline.data;sync.hint(assets,BASELINE,baseline.data,baseline.chunks);}
  return sync.call('pdfInk',{text:'',assets},{mode:'save',id,page:value.page,expectedRevision:value.expectedRevision??null,noteRevision:value.noteRevision??null,baselineRevision:baseline?.revision??null});
 }
 async function load(id,page){if(!sync?.call)return api.ink(id,page);const result=await sync.call('pdfInk',{text:'',assets:{}},{mode:'page',id,page}),data=result.assets?.[INK];return typeof data==='string'?{data,chunks:sync.assetChunks(result.assets,INK),revision:result.meta.revision}:null;}
 return{prepare,save,load};
});
