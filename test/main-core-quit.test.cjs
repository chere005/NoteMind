const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8'),start=source.includes('let coreQuitReady')?source.indexOf('let coreQuitReady'):source.indexOf("app.on('will-quit',"),end=source.indexOf('\n\nlet cameraWrite',start);assert.ok(start>=0&&end>start);const block=source.slice(start,end),tick=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}
function fixture(plan={}){
 const calls=[],quits=[],logged=[],app=new EventEmitter(),run=name=>{calls.push(name);return typeof plan[name]==='function'?plan[name]():plan[name];},service=name=>({dispose:()=>run(name)});
 app.quit=()=>{const event={prevented:false,preventDefault(){this.prevented=true;}};app.emit('will-quit',event);quits.push({prevented:event.prevented});};
 const scope={app,Promise,AggregateError,features:service('features'),fileOperationRequests:service('fileOperations'),console:{error(...values){logged.push(values);}},sheetReads:service('reads'),sheetLoads:service('loads'),sheetUploads:service('sheetUploads'),cameraUploads:service('cameraUploads'),imagePickerIPC:service('picker'),documentIO:service('documents'),pdfReferences:service('pdf'),notesIPC:{stop:()=>run('notes'),dispose:()=>run('noteAssets')},sheetPersistenceService:service('sheets'),cameraPersistenceService:service('camera'),require:name=>{assert.equal(name,'./archive-codec.cjs');return service('archive');}};
 for(const[name,key]of[['sheetWrite','sheetWrite'],['cameraWrite','cameraWrite']])Object.defineProperty(scope,name,{get:()=>run(key)});vm.runInNewContext(block,scope);return{app,calls,quits,logged};
}
test('actual Main final quit joins producers, write receipts and persistence before archive shutdown',async()=>{
 const gates=Object.fromEntries(['fileOperations','features','documents','pdf','picker','sheetUploads','cameraUploads','sheetWrite','cameraWrite','sheets','camera','archive'].map(name=>[name,deferred()])),f=fixture(Object.fromEntries(Object.entries(gates).map(([name,gate])=>[name,gate.promise])));f.app.quit();assert.deepEqual(f.quits,[{prevented:true}]);await tick();assert.ok(f.calls.includes('documents')&&f.calls.includes('pdf')&&f.calls.includes('picker'));assert.equal(f.calls.includes('sheets'),false);assert.equal(f.calls.includes('archive'),false);
 for(const name of['fileOperations','features','documents','pdf','picker','sheetUploads','cameraUploads'])gates[name].resolve();await tick();assert.ok(f.calls.includes('sheetWrite')&&f.calls.includes('cameraWrite'));assert.equal(f.calls.includes('sheets'),false);gates.sheetWrite.resolve();gates.cameraWrite.resolve();await tick();assert.ok(f.calls.includes('sheets')&&f.calls.includes('camera'));assert.equal(f.calls.includes('archive'),false);
 gates.sheets.resolve();await tick();assert.equal(f.calls.includes('archive'),false);gates.camera.resolve();await tick();assert.equal(f.calls.filter(name=>name==='archive').length,1);f.app.quit();await tick();assert.equal(f.calls.filter(name=>name==='archive').length,2);assert.ok(f.quits.every(quit=>quit.prevented));gates.archive.resolve();await tick();assert.equal(f.quits.at(-1).prevented,false);assert.equal(f.logged.length,0);
});
test('all producer failures are observed and another quit can retry without prematurely stopping archive',async()=>{
 for(const synchronous of[false,true]){
  const held=deferred();let fail=true;const f=fixture({picker(){if(fail){if(synchronous)throw Error('picker cleanup failed');return Promise.reject(Error('picker cleanup failed'));}},documents:held.promise});f.app.quit();await tick();assert.equal(f.calls.includes('archive'),false);assert.equal(f.logged.length,0,'another producer remains owned');held.resolve();await tick();assert.equal(f.logged.length,1);assert.equal(f.calls.includes('sheets'),false);assert.equal(f.calls.includes('archive'),false);assert.ok(f.quits.every(quit=>quit.prevented));fail=false;f.app.quit();await tick();assert.ok(f.calls.includes('archive'));assert.equal(f.quits.at(-1).prevented,false);
 }
});
test('a repeated quit retries only the pending persistence phase and still holds archive ownership',async()=>{
 const held=deferred(),f=fixture({sheets:held.promise});f.app.quit();await tick();assert.equal(f.calls.filter(name=>name==='sheets').length,1);assert.equal(f.calls.includes('archive'),false);f.app.quit();await tick();assert.equal(f.calls.filter(name=>name==='sheets').length,2);assert.equal(f.calls.filter(name=>name==='documents').length,1);assert.equal(f.calls.includes('archive'),false);held.resolve();await tick();assert.ok(f.calls.includes('archive'));assert.equal(f.quits.at(-1).prevented,false);
});
test('an explicit repeated quit can retry a pending producer stop without closing its archive dependency',async()=>{
 const held=deferred(),f=fixture({documents:held.promise});f.app.quit();await tick();assert.equal(f.calls.filter(name=>name==='documents').length,1);f.app.quit();await tick();assert.equal(f.calls.filter(name=>name==='documents').length,2);assert.equal(f.calls.includes('sheets'),false);assert.equal(f.calls.includes('archive'),false);held.resolve();await tick();assert.equal(f.quits.at(-1).prevented,false);
});
test('a second Quit during a transient cleanup failure still retries after the failure settles',async()=>{
 const first=deferred();let failed=false;
 const f=fixture({documents:()=>failed?undefined:first.promise});
 f.app.quit();await tick();
 f.app.quit();await tick();
 assert.equal(f.calls.filter(name=>name==='documents').length,2);
 assert.ok(f.quits.every(quit=>quit.prevented));
 assert.equal(f.calls.includes('archive'),false);
 failed=true;first.reject(Error('Transient document cleanup failure'));await tick();
 assert.equal(f.logged.length,1);
 assert.ok(f.calls.includes('archive'));
 assert.equal(f.quits.at(-1).prevented,false);
});
test('actual core, document and PDF quit barriers cannot bypass another pending service on a repeated quit',async()=>{
 const documentGate=deferred(),pdfGate=deferred();let pdf;const f=fixture({documents:documentGate.promise,pdf:()=>pdf.dispose()}),documentSource=fs.readFileSync(require.resolve('../src/document-io.cjs'),'utf8'),documentCallback=documentSource.match(/app\.on\('will-quit',(event=>\{[^\n]*\})\);/)[1];
 f.app.on('will-quit',vm.runInNewContext('('+documentCallback+')',{quitReady:false,quitWaiting:null,dispose:()=>documentGate.promise,app:f.app,console:{error(...values){f.logged.push(values);}}}));
 const pdfSource=fs.readFileSync(require.resolve('../src/pdf-reference-service.cjs'),'utf8'),relative=require('node:module').createRequire(require.resolve('../src/pdf-reference-service.cjs')),module={exports:{}};vm.runInNewContext(pdfSource,{module,exports:module.exports,__dirname:require('node:path').dirname(require.resolve('../src/pdf-reference-service.cjs')),Promise,Buffer,setTimeout,clearTimeout,console:{error(...values){f.logged.push(values);}},require:name=>name==='electron'?{app:f.app,ipcMain:{on(){}},dialog:{},BrowserWindow:{}}:relative(name)});pdf=new module.exports.PDFReferenceService({root:'/unused/NoteMind',jobs:{dispose:()=>pdfGate.promise}});
 f.app.quit();await tick();assert.ok(f.quits.every(quit=>quit.prevented));documentGate.resolve();await tick();assert.ok(f.quits.every(quit=>quit.prevented));assert.equal(f.calls.includes('archive'),false);pdfGate.resolve();await tick();assert.equal(f.quits.at(-1).prevented,false);assert.ok(f.calls.includes('archive'));assert.equal(f.logged.length,0);
});

test('Core joins all producers before retiring Notes sources and keeps archive alive through retry',async()=>{
 const producer=deferred(),assets=deferred();let fail=true;const f=fixture({documents:producer.promise,noteAssets:()=>{if(fail)throw Error('Notes source cleanup failed');return assets.promise}});f.app.quit();await tick();assert.ok(f.calls.includes('notes'));assert.equal(f.calls.includes('noteAssets'),false);producer.resolve();await tick();assert.equal(f.calls.includes('noteAssets'),true);assert.equal(f.calls.includes('archive'),false);assert.equal(f.logged.length,1);fail=false;f.app.quit();await tick();assert.equal(f.calls.filter(name=>name==='noteAssets').length,2);assert.equal(f.calls.includes('archive'),false);assets.resolve();await tick();assert.ok(f.calls.includes('archive'));assert.equal(f.quits.at(-1).prevented,false);
});
