const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const relative=createRequire(require.resolve('../src/pdf-reference-service.cjs')),source=fs.readFileSync(require.resolve('../src/pdf-reference-service.cjs'),'utf8'),{PDFReferenceJobs}=require('../src/pdf-reference-jobs.cjs'),tick=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
function fixture(jobs){
 const app=new EventEmitter(),quits=[],logged=[];app.quit=()=>{const event={prevented:false,preventDefault(){this.prevented=true;}};app.emit('will-quit',event);quits.push({prevented:event.prevented});};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,__dirname:require('node:path').dirname(require.resolve('../src/pdf-reference-service.cjs')),setTimeout,clearTimeout,Promise,Buffer,console:{error(...values){logged.push(values);}},require:name=>name==='electron'?{app,ipcMain:{on(){}},dialog:{},BrowserWindow:{}}:relative(name)});
 const service=new module.exports.PDFReferenceService({root:'/unused/NoteMind',jobs});return{app,service,quits,logged};
}
test('repeated PDF disposal and independently repeated quits join actual worker exit and cleanup',async()=>{
 const workers=[],jobs=new PDFReferenceJobs('/unused/NoteMind',{workerFactory:()=>{const worker=Object.assign(new EventEmitter(),{postMessage(){},ref(){},unref(){},async terminate(){this.terminations++;return 0;},terminations:0});workers.push(worker);return worker;}}),f=fixture(jobs),operation=jobs.call('state');workers[0].emit('message',{id:1,value:'ready'});await operation;
 const cleanup=deferred();let cleanupStarted=false;jobs.cleanupWorkerLeases=async()=>{cleanupStarted=true;await cleanup.promise;};
 let firstDone=false,secondDone=false;const first=f.service.dispose().then(()=>firstDone=true),second=f.service.dispose().then(()=>secondDone=true);f.app.quit();f.app.quit();await tick();
 assert.equal(firstDone,false);assert.equal(secondDone,false);assert.equal(workers[0].terminations,1);assert.equal(cleanupStarted,false);assert.deepEqual(f.quits,[{prevented:true},{prevented:true}]);
 workers[0].emit('exit',0);await tick();assert.equal(cleanupStarted,true);assert.equal(firstDone,false);assert.equal(secondDone,false);assert.equal(f.quits.length,2);
 cleanup.resolve();await Promise.all([first,second]);await tick();assert.deepEqual(f.quits,[{prevented:true},{prevented:true},{prevented:false}]);assert.equal(f.logged.length,0);
});
test('PDF cleanup failure stays observed and a later quit retries the cleanup before authorizing exit',async()=>{
 const retry=deferred();let attempts=0;const f=fixture({dispose(){attempts++;return attempts===1?Promise.reject(Error('owned lease cleanup failed')):retry.promise;}});
 f.app.quit();await tick();assert.equal(attempts,1);assert.equal(f.logged.length,1);assert.match(String(f.logged[0][1]),/owned lease cleanup failed/);assert.deepEqual(f.quits,[{prevented:true}]);
 f.app.quit();await tick();assert.equal(attempts,2);assert.deepEqual(f.quits,[{prevented:true},{prevented:true}]);retry.resolve();await tick();assert.deepEqual(f.quits,[{prevented:true},{prevented:true},{prevented:false}]);
});
test('direct PDF disposal failure remains retryable without reopening sources or skipping another client',async()=>{
 let attempts=0,jobsDisposed=0,secondClosed=0;const f=fixture({async dispose(){jobsDisposed++;}}),owner={};f.service.owners.set(owner,new Map([['first',{saves:new Set(),client:{dispose(){if(++attempts===1)throw Error('renderer close failed');}}}],['second',{saves:new Set(),client:{dispose(){secondClosed++;}}}]]));
 await assert.rejects(f.service.dispose(),/renderer close failed/);assert.equal(f.service.closed,true);assert.equal(f.service.retiredOwners.size,1);assert.equal(jobsDisposed,0);await f.service.dispose();assert.equal(attempts,2);assert.equal(secondClosed,1);assert.equal(f.service.owners.size,0);assert.equal(f.service.retiredOwners.size,0);assert.equal(jobsDisposed,1);
});
