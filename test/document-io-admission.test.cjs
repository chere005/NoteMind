const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/document-io.cjs'),'utf8'),tick=()=>new Promise(resolve=>setImmediate(resolve)),deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function fixture({writeGate,writeStarted,prepareGate}={}){
 const handlers=new Map(),calls=[],app={on(){},getPath:()=>'/virtual-owned'},output={};let publicCreates=0;
 class Window{constructor(){calls.push('window');this.webContents={executeJavaScript:async()=>{},printToPDF:async()=>Buffer.from('pdf')};}async loadFile(){}isDestroyed(){return!!this.destroyed;}destroy(){this.destroyed=true;}}
 const fileSystem={writeFile:async file=>{calls.push('write:'+file);if(file.endsWith('.tmp')){writeStarted?.resolve();await writeGate?.promise;}},rename:async()=>{calls.push('committed');},unlink:async()=>{calls.push('unlink');}};
 const requireMock=name=>{
  if(name==='electron')return{app,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showSaveDialog:async()=>{calls.push('save-dialog');return{canceled:true};},showOpenDialog:async()=>{calls.push('open-dialog');return{canceled:true};}},shell:{openPath:async()=>{calls.push('open-path');}}};
  if(name==='node:fs/promises')return fileSystem;
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
  if(name==='./ocr-public.cjs')return{PublicOCR:class{constructor(){publicCreates++;}begin(){return'created';}ready(){return'created';}read(){return'created';}dispose(){return Promise.resolve();}}};
  if(name==='./word-preview-ipc.cjs')return{registerWordPreviewIPC:()=>({dispose:()=>Promise.resolve()})};
  if(name==='./word-export-jobs.cjs')return{installWordShutdown(){}};
  if(name.startsWith('node:'))return require(name);
  throw Error('Unexpected dependency admission: '+name);
 };
 const context=vm.createContext({require:requireMock,module:output,exports:{},__dirname:path.resolve(__dirname,'../src'),Buffer,structuredClone,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,console,Promise,performance});vm.runInContext(source,context);return{api:output.exports,handlers,calls,get publicCreates(){return publicCreates;}};
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
