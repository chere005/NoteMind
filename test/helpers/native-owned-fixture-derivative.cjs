// Checked test-only changes for the current source and frozen safe process probe.
const {createHash}=require('node:crypto');
const sha=value=>createHash('sha256').update(value).digest('hex');
function once(source,needle,replacement){if(source.split(needle).length!==2)throw Error('Native owned-fixture boundary changed: '+needle.slice(0,80));return source.replace(needle,replacement);}
function nativeEngine(source){
 let code=once(source,'try { retire(bytes) } finally {','try { /* native model backing remains owned through actual helper exit */ } finally {');
 return once(code,'} finally { retire(bytes) }','} finally { /* native model backing remains owned through actual helper exit */ }');
}
function prepareHelper(source,helperFile){
 const old="let engine=contents['ocr/engine.ts'].toString();const retirements=engine.match(/finally \\{ retire\\(bytes\\) \\}/g)||[];if(retirements.length!==2)throw Error('Model retirement seams changed.');engine=engine.replaceAll('finally { retire(bytes) }','finally { /* test native source remains owned through actual worker exit */ }');";
 let code=once(source,old,"let engine=require("+JSON.stringify(helperFile)+").nativeEngine(contents['ocr/engine.ts'].toString());");
 code=once(code,'export const env=native.env,Tensor=native.Tensor;','export const env={...native.env,wasm:{...native.env.wasm,wasmBinary:new ArrayBuffer(0)}},Tensor=native.Tensor;');
 return{code,originalSHA:sha(source),derivedSHA:sha(code)};
}
function markBackend(source){const call='__classPrivateFieldGet(this, _OnnxruntimeSessionHandler_inferenceSession, "f").run(feeds, fetches, options)';return once(source,call,'(()=>{const marker=globalThis[Symbol.for("notemind.native.process.marker")],key=Symbol.for("notemind.native.process.call.sequence"),call=(globalThis[key]||0)+1;globalThis[key]=call;marker?.({phase:"enter",call});const result='+call+';marker?.({phase:"after",call});return result;})()');}
module.exports={once,nativeEngine,prepareHelper,markBackend,sha};
