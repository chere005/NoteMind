const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/document-io.cjs'),'utf8'),tick=()=>new Promise(resolve=>setImmediate(resolve)),deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function fixture({writeGate,writeStarted,prepareGate,guard,renderGate,renderStarted,pathKey}={}){
 const handlers=new Map(),calls=[],app={on(){},getPath:()=>'/virtual-owned'},output={};let publicCreates=0,publicReads=0;
 class Window{constructor(){calls.push('window');this.webContents={executeJavaScript:async()=>{},printToPDF:async()=>{renderStarted?.resolve();await renderGate?.promise;return Buffer.from('pdf')}};}async loadFile(){}isDestroyed(){return!!this.destroyed;}destroy(){this.destroyed=true;}}
 const fileSystem={writeFile:async file=>{calls.push('write:'+file);if(file.endsWith('.tmp')){writeStarted?.resolve();await writeGate?.promise;}},rename:async()=>{calls.push('committed');},unlink:async()=>{calls.push('unlink');}};
 const requireMock=name=>{
  if(name==='electron')return{app,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showSaveDialog:async()=>{calls.push('save-dialog');return{canceled:true};},showOpenDialog:async()=>{calls.push('open-dialog');return{canceled:true};}},shell:{openPath:async()=>{calls.push('open-path');}}};
  if(name==='node:fs/promises')return fileSystem;
  if(name==='./path-key.cjs')return pathKey||{physicalPath:file=>file};
  if(name==='./guarded-write.cjs')return guard||{fingerprintFile:async()=>null,replaceIfUnchanged:async(file,bytes,_expected,{beforeCommit}={})=>{beforeCommit?.();const temporary=file+'.fixture.tmp';await fileSystem.writeFile(temporary,bytes);await fileSystem.rename(temporary,file);await fileSystem.unlink(temporary);}};
  if(name==='./ocr.cjs')return{TextReader:class{dispose(){return Promise.resolve();}},available:()=>true};
  if(name==='./documents.cjs')return{importWord(){},printHtml:()=>'<meta charset="utf-8">'};
  if(name==='./document-renderer.cjs')return{mime:()=>null,render(){},imageDimensions(){}};
  if(name==='./document-worker-bytes.cjs')return{executeBytes(){throw Error('Unexpected converter work');},withInput(){throw Error('Unexpected input work');},base64(){}};
  if(name==='./document-asset-sessions.cjs')return{isRawAsset:()=>false};
  if(name==='./archive-codec.cjs')return{};
  if(name==='./print-file-leases.cjs')return{PrintFileLeases:class{open(){calls.push('print-stage');return Promise.resolve({token:'token',url:()=>''});}release(){return Promise.resolve();}dispose(){return Promise.resolve();}}};
  if(name==='./print-images.cjs')return{preparePrint:async doc=>{calls.push('prepare-print');await prepareGate?.promise;return doc;}};
  if(name==='./print-asset-files.cjs')return{withPrintFiles:async(_doc,run)=>{calls.push('file-stage');return run({file:'/virtual-owned/document.html',url:()=>''});}};
  if(name==='./pdf-options.cjs')return{printOptions:()=>({})};
  if(name==='./ocr-public.cjs')return{PublicOCR:class{constructor(){publicCreates++;}begin(){return'created';}ready(){return'created';}read(_owner,request){publicReads++;request.data=null;return this.closed?Promise.reject(Object.assign(Error('Reading cancelled.'),{name:'AbortError'})):'created';}dispose(){this.closed=true;return Promise.resolve();}}};
  if(name==='./word-preview-ipc.cjs')return{registerWordPreviewIPC:()=>({dispose:()=>Promise.resolve()})};
  if(name==='./word-export-jobs.cjs')return{installWordShutdown(){}};
  if(name.startsWith('node:'))return require(name);
  throw Error('Unexpected dependency admission: '+name);
 };
 const context=vm.createContext({require:requireMock,module:output,exports:{},__dirname:path.resolve(__dirname,'../src'),Buffer,structuredClone,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,console,Promise,performance});vm.runInContext(source,context);return{api:output.exports,handlers,calls,get publicCreates(){return publicCreates;},get publicReads(){return publicReads;}};
}
test('disposed document services reject export, print, import, preview and public OCR before external work',async()=>{
 const value=fixture();value.api.register(()=>null);await value.api.dispose();const doc={text:'',assets:{},meta:{}},owner={once(){},removeListener(){},isDestroyed:()=>false};
 await assert.rejects(value.api.exportDocument(doc,'pdf',{},owner),/closing/);await assert.rejects(value.api.printDocument(doc,{},owner),/closing/);await assert.rejects(value.api.exportFile(doc,'/virtual-owned/late.pdf'),/closing/);await assert.rejects(value.api.importFile('/virtual-owned/late.pdf'),/closing/);await assert.rejects(value.api.previewFile('/virtual-owned/late.pdf'),/closing/);await assert.rejects(value.handlers.get('document-import')({sender:owner},{}),/closing/);
 await assert.rejects(value.api.convertImage(Buffer.from('private'),'image/png'),/closing/);await assert.rejects(value.api.convertImageFile('/virtual-owned/late.png','image/png'),/closing/);await assert.rejects(value.api.convertIndexImageFile('/virtual-owned/late.png','image/png'),/closing/);assert.throws(()=>value.api.previewImages(doc,{}),/closing/);
 for(const name of ['ocr-begin','ocr-ready','ocr-read'])assert.throws(()=>value.handlers.get(name)({sender:owner},{}),/closing/);assert.equal(value.publicCreates,0);assert.deepEqual(value.calls,[]);
});
test('PDF preprocessing cannot start file-backed print staging after cancellation or final disposal',async()=>{
 const prepareGate=deferred(),value=fixture({prepareGate}),controller=new AbortController(),pending=value.api.exportFile({text:'',assets:{}},'/virtual-owned/cancelled.pdf',{signal:controller.signal}),rejected=assert.rejects(pending,/cancel|closing/);await tick();assert.deepEqual(value.calls,['prepare-print']);controller.abort();const closing=value.api.dispose();prepareGate.resolve();await Promise.all([rejected,closing]);assert.equal(value.calls.includes('file-stage'),false);assert.equal(value.calls.some(call=>call.startsWith('write:')),false);
});
test('final disposal joins an already-writing export through its final output and cleanup receipt',async()=>{
 const writeGate=deferred(),writeStarted=deferred(),value=fixture({writeGate,writeStarted}),pending=value.api.exportFile({text:'',assets:{}},'/virtual-owned/output.pdf');await writeStarted.promise;let closed=false;const closing=value.api.dispose().then(()=>{closed=true;});
 try{await tick();assert.equal(closed,false,'the output write is still pending');writeGate.resolve();assert.equal(await pending,'/virtual-owned/output.pdf');await closing;assert.equal(closed,true);assert.equal(value.calls.filter(call=>call==='committed').length,1);assert.equal(value.calls.at(-1),'unlink');}finally{writeGate.resolve();await Promise.allSettled([pending,closing]);}
});
test('a late OCR packet still reaches its existing cleanup owner after disposal without reopening admission',async()=>{
 const value=fixture(),owner={};value.api.register(()=>null);assert.equal(value.handlers.get('ocr-begin')({sender:owner},{}),'created');await value.api.dispose();const arrived={data:'already serialized PNG source'};
 await assert.rejects(value.handlers.get('ocr-read')({sender:owner},arrived),{name:'AbortError'});assert.equal(arrived.data,null);assert.equal(value.publicReads,1);assert.equal(value.publicCreates,1);
 const unused=fixture();unused.api.register(()=>null);await unused.api.dispose();const unclaimed={data:'late unclaimed source'};assert.throws(()=>unused.handlers.get('ocr-read')({sender:owner},unclaimed),/closing/);assert.equal(unclaimed.data,null);assert.equal(unused.publicCreates,0);
});
test('PDF export preserves a target edited while asynchronous preparation is pending',async t=>{
 const io=require('node:fs/promises'),folder=await io.mkdtemp(path.join(require('node:os').tmpdir(),'notemind-pdf-export-conflict-'));t.after(()=>io.rm(folder,{recursive:true,force:true}));const file=path.join(folder,'output.pdf');await io.writeFile(file,'original');const prepareGate=deferred(),value=fixture({prepareGate,guard:require('../src/guarded-write.cjs')}),pending=value.api.exportFile({text:'',assets:{}},file),rejected=assert.rejects(pending,/changed while/);
 for(let n=0;n<30&&!value.calls.includes('prepare-print');n++)await tick();assert.ok(value.calls.includes('prepare-print'));await io.writeFile(file,'external edit');prepareGate.resolve();await rejected;assert.equal(await io.readFile(file,'utf8'),'external edit');assert.deepEqual(await io.readdir(folder),['output.pdf']);await value.api.dispose();
});
test('PDF export follows the selected physical alias and preserves the link itself',async t=>{
 const io=require('node:fs/promises'),folder=await io.mkdtemp(path.join(require('node:os').tmpdir(),'notemind-pdf-export-alias-'));t.after(()=>io.rm(folder,{recursive:true,force:true}));const file=path.join(folder,'output.pdf'),alias=path.join(folder,'alias.pdf');await io.writeFile(file,'original');await io.symlink(file,alias);const value=fixture({guard:require('../src/guarded-write.cjs'),pathKey:require('../src/path-key.cjs')});assert.equal(await value.api.exportFile({text:'',assets:{}},alias),alias);assert.equal(await io.readFile(file,'utf8'),'pdf');assert.equal((await io.lstat(alias)).isSymbolicLink(),true);await value.api.dispose();
});
test('cancelling while PDF rendering finishes cannot publish over the original target',async t=>{
 const io=require('node:fs/promises'),folder=await io.mkdtemp(path.join(require('node:os').tmpdir(),'notemind-pdf-export-cancel-'));t.after(()=>io.rm(folder,{recursive:true,force:true}));const file=path.join(folder,'output.pdf');await io.writeFile(file,'original');const renderGate=deferred(),renderStarted=deferred(),controller=new AbortController(),value=fixture({renderGate,renderStarted,guard:require('../src/guarded-write.cjs')}),pending=value.api.exportFile({text:'',assets:{}},file,{signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});await renderStarted.promise;controller.abort();renderGate.resolve();await rejected;assert.equal(await io.readFile(file,'utf8'),'original');assert.deepEqual(await io.readdir(folder),['output.pdf']);await value.api.dispose();
});
