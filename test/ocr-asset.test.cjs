const {test}=require('node:test'),assert=require('node:assert/strict');
const {readAsset}=require('../src/ocr-asset.cjs');
const tick=()=>new Promise(setImmediate),gate=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function fixture(){
 const events=[],exit=gate(),input={},doc={text:'',assets:{'assets/original.png':input}},sender={isDestroyed:()=>false,send:(...args)=>events.push(['progress',...args])},working=async()=>events.push('workspace-release');working.resize=async bytes=>events.push(['resize',bytes]);working.signal=new AbortController().signal;
 const lease={run:async fn=>fn(),release:async()=>events.push('lease-release')},storage={preflightRawAssets:async(_,options)=>{events.push('lease');return lease;},releaseRawAssets:async()=>events.push('raw-release')};
 const documentIO={convertIndexImageFile:async(file,type,options,owner)=>{events.push('convert');assert.equal(file,'owned-source');assert.equal(type,'image/png');assert.equal(owner,sender);assert.equal(options.maxDimension,2400);return{pixels:{width:3,height:2,data:new Uint8Array(24)}};},reader:{readPixels:async(pixels,options)=>{assert.equal(options.retireOnCompletion,true);assert.equal(options.takeOwnership,true);events.push('read');options.onProgress('Reading text');pixels.data.buffer.transfer(0);return{text:'exact',lines:[]};},awaitStopped:async()=>{events.push('await-exit');await exit.promise;events.push('actual-exit');}}};
 const services={storage,documentIO,directory:'visible/OCR Work',prepare:async(value,options)=>{assert.equal(value.assets['assets/ocr-source.png'],input);assert.equal(options.tempRoot,'visible/OCR Work');events.push('prepare');return{rows:[{type:'image/png',source:{file:'owned-source',workingPlan:{convertBytes:1000,maxOutputBytes:1000,ocrBytes:300,modelBytes:200}}}],cleanup:async()=>events.push('source-release')};},releaseInputs:async()=>events.push('input-release'),acquire:async()=>{events.push('workspace');return working;}};
 return{events,exit,input,doc,sender,services,working};
}
test('asset OCR releases encoded input after verified spooling and holds pixels/models through actual exit',async()=>{
 const f=fixture(),pending=readAsset({sender:f.sender},f.doc,{assetName:'assets/original.png',id:'ui',language:'en'},f.services);let settled=false;pending.finally(()=>settled=true);await tick();assert.equal(settled,false);assert.deepEqual(f.events.slice(0,6),['prepare','input-release','lease','workspace','convert',['resize',524]]);assert.equal(f.events.includes('workspace-release'),false);f.exit.resolve();assert.equal((await pending).text,'exact');assert.deepEqual(f.events.slice(-5),['actual-exit','workspace-release','lease-release','raw-release','source-release']);
});
test('asset OCR cancellation preserves cleanup ownership until the native reader exits',async()=>{
 const f=fixture(),controller=new AbortController();f.services.documentIO.reader.readPixels=async(_pixels,options)=>{controller.abort();options.signal.throwIfAborted();};const pending=readAsset({sender:f.sender},f.doc,{assetName:'assets/original.png',signal:controller.signal},f.services);const rejected=assert.rejects(pending,{name:'AbortError'});await tick();assert.equal(f.events.includes('workspace-release'),false);f.exit.resolve();await rejected;assert.equal(f.events.at(-1),'source-release');
});
test('asset OCR rejects ambiguous or unsupported captured documents before any source read',async()=>{
 for(const doc of [{assets:{}},{assets:{'assets/a.pdf':{}}},{assets:{'assets/original.png':{},'assets/extra.png':{}}}]){const f=fixture();await assert.rejects(readAsset({sender:f.sender},doc,{assetName:'assets/original.png'},f.services),/one supported picture/);assert.equal(f.events.length,0);}
});
