// Test-only native-call boundary markers. Never imported by product code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prepareMixedNative}=require('./ocr-native-mixed.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fileHash(file){const fd=fs.openSync(file,'r'),scratch=Buffer.allocUnsafeSlow(196608),digest=crypto.createHash('sha256');try{for(;;){const count=fs.readSync(fd,scratch,0,scratch.length,null);if(!count)break;digest.update(scratch.subarray(0,count));}return digest.digest('hex');}finally{fs.closeSync(fd);scratch.buffer.transfer?.(0);}}
function once(code,needle,replacement){if(code.indexOf(needle)<0||code.indexOf(needle)!==code.lastIndexOf(needle))throw Error('Native lifecycle boundary seam changed: '+needle);return code.replace(needle,replacement);}
function instrumentBackend(code){
 const marker=`
const __nativeLifecycle=require('node:worker_threads').workerData?.nativeLifecycle;
let __nativeLifecycleSequence=0,__nativeLifecycleRuns=0;
function __nativeLifecycleCall(kind,callback){
 const target=kind==='run'&&++__nativeLifecycleRuns===1;
 const seq=++__nativeLifecycleSequence,gate=__nativeLifecycle&&new Int32Array(__nativeLifecycle.gate);
 const mark=phase=>__nativeLifecycle?.port.postMessage({kind,phase,seq,target,ns:process.hrtime.bigint().toString()});
 const pause=phase=>{if(target&&__nativeLifecycle?.mode===phase){Atomics.store(gate,0,phase==='before-run'?1:3);mark('paused-'+phase);while(Atomics.load(gate,1)===0)Atomics.wait(gate,1,0);}};
 mark('before');pause('before-run');
 if(target&&gate)Atomics.store(gate,0,2);
 mark('enter');const value=callback();
 if(target&&gate)Atomics.store(gate,0,3);
 mark('after');pause('after-run');return value;
}
`;
 code=once(code,'const binding_1 = require("./binding");',marker+'\nconst binding_1 = require("./binding");');
 const session='__classPrivateFieldGet(this, _OnnxruntimeSessionHandler_inferenceSession, "f")';
 for(const call of [session+'.loadModel(pathOrBuffer, options)',session+'.loadModel(pathOrBuffer.buffer, pathOrBuffer.byteOffset, pathOrBuffer.byteLength, options)'])code=once(code,call,'__nativeLifecycleCall("load",()=>'+call+')');
 code=once(code,session+'.run(feeds, fetches, options)','__nativeLifecycleCall("run",()=>'+session+'.run(feeds, fetches, options))');
 return code;
}
async function prepareLifecycle({root,dependencyDirectory,output,esbuild}){
 if(fs.existsSync(output))throw Error('Lifecycle output must be new; never overwrite a prior authority.');
 const ordinary=await prepareMixedNative({root,dependencyDirectory,output,esbuild}),receipt=ordinary.receipt,nativeClone=path.join(output,'marked-native'),originalNative=receipt.nativeRoot;
 fs.mkdirSync(path.join(nativeClone,'dist'),{recursive:true});
 for(const entry of fs.readdirSync(path.join(originalNative,'dist'),{withFileTypes:true})){if(!entry.isFile())throw Error('Unexpected native dist subdirectory.');fs.copyFileSync(path.join(originalNative,'dist',entry.name),path.join(nativeClone,'dist',entry.name));}
 fs.copyFileSync(path.join(originalNative,'package.json'),path.join(nativeClone,'package.json'));
 fs.symlinkSync(path.join(originalNative,'bin'),path.join(nativeClone,'bin'),'dir');
 fs.mkdirSync(path.join(nativeClone,'node_modules'));fs.symlinkSync(receipt.commonRoot,path.join(nativeClone,'node_modules/onnxruntime-common'),'dir');
 const backend=path.join(nativeClone,'dist/backend.js'),originalBackendSHA=fileHash(backend);fs.writeFileSync(backend,instrumentBackend(fs.readFileSync(backend,'utf8')));
 const originalImport=JSON.stringify(path.join(originalNative,'dist/index.js')),newImport=JSON.stringify(path.join(nativeClone,'dist/index.js'));
 const originalWorkerSHA=receipt.workerSHA,workerCode=once(fs.readFileSync(receipt.worker,'utf8'),originalImport,newImport);fs.writeFileSync(receipt.worker,workerCode);
 const mainFiles={};for(const file of ['ocr.cjs','ocr-pixels.cjs','ocr-reading-order.cjs','ocr-cache-bytes.cjs'])mainFiles[file]=fileHash(path.join(root,'src',file));
 const markedFiles={};for(const entry of fs.readdirSync(path.join(nativeClone,'dist'),{withFileTypes:true}))if(entry.isFile())markedFiles[entry.name]=fileHash(path.join(nativeClone,'dist',entry.name));
 Object.assign(receipt,{scope:'Test-only native Worker lifecycle boundaries; not App memory, bit-exact model, release, or cancellation qualification',originalWorkerSHA,workerSHA:hash(workerCode),nativeClone,markedFiles,originalBackendSHA,markedBackendSHA:markedFiles['backend.js'],mainFiles,instrumentation:'Original native dist copied; only backend.js receives scalar call markers and selected first-detector pre/post atomic pauses. Exact original native binaries/models/options. No tensor tracing or pixel clones.',helperSHA:fileHash(__filename),boundaryLimit:'enter is immediately before binding.run invocation; without a C++ internal probe it is a call-boundary receipt, not an internal instruction pointer. An absent after marker alone cannot prove native entry.'});
 const file=path.join(output,'native-lifecycle-receipt.json');fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');return{file,receipt};
}
function verifyLifecycle(receipt){
 if(process.platform!=='darwin'||process.arch!=='arm64'||Number(require('node:os').release().split('.')[0])<23)throw Error('This native test artifact requires macOS14+/arm64.');
 if(fileHash(receipt.worker)!==receipt.workerSHA)throw Error('Lifecycle worker identity changed.');
 for(const[name,expected]of Object.entries(receipt.nativeFiles))if(fileHash(path.join(receipt.nativeRoot,name))!==expected)throw Error('Original native file changed: '+name);
 for(const[name,expected]of Object.entries(receipt.markedFiles))if(fileHash(path.join(receipt.nativeClone,'dist',name))!==expected)throw Error('Marked native JS changed: '+name);
 for(const[name,expected]of Object.entries(receipt.commonFiles))if(fileHash(path.join(receipt.commonRoot,name))!==expected)throw Error('Pinned Common changed: '+name);
 for(const[name,expected]of Object.entries(receipt.mainFiles))if(fileHash(path.join(receipt.root,'src',name))!==expected)throw Error('Current TextReader source changed: '+name);
 if(fileHash(__filename)!==receipt.helperSHA)throw Error('Lifecycle helper changed since preparation.');
 for(const model of receipt.modelManifest.models)if(fileHash(path.join(receipt.root,'src/helpers/text-ocr/models',model.file))!==model.sha256)throw Error('Original model changed: '+model.file);
}
module.exports={instrumentBackend,prepareLifecycle,verifyLifecycle,fileHash};
