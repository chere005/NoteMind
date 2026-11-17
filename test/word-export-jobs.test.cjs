const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {WordExportJobs,installWordShutdown}=require('../src/word-export-jobs.cjs'),{WordExportOperations}=require('../src/word-export-operations.cjs');
const tick=()=>new Promise(setImmediate),gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
function fixture(){const workers=[],options=[],pool=new WordExportJobs({workerFactory:(_file,settings)=>{options.push(settings);const worker=Object.assign(new EventEmitter(),{packets:[],postMessage(packet){this.packets.push(packet)},async terminate(){return 0}});workers.push(worker);return worker;}});return{pool,workers,options};}
const target={file:'/owned/output.docx',spoolRoot:'/owned'},doc={text:'Text',title:'Owned',assets:{},meta:{}};
function finish(worker){const packet=worker.packets[0];worker.emit('message',{id:packet.id,value:{file:target.file,committed:true}});worker.emit('exit',0);}
test('Word worker packets contain only bounded accepted metadata and retain the runtime heap default',async()=>{
 const f=fixture(),pending=f.pool.run({...doc,unused:()=>{throw Error('must not cross worker')}},{},{},target);await tick();assert.equal(f.workers.length,1);assert.equal(Object.hasOwn(f.options[0],'resourceLimits'),false);assert.equal(Object.hasOwn(f.workers[0].packets[0].doc,'unused'),false);finish(f.workers[0]);assert.equal((await pending).committed,true);await f.pool.dispose();assert.equal(f.pool.bytes,0);
});
test('queued Word work retains each initiating async reservation context and waits for actual exit',async()=>{
 const {AsyncLocalStorage}=require('node:async_hooks'),scope=new AsyncLocalStorage(),f=fixture(),observed=[];
 const start=name=>scope.run(name,()=>f.pool.run(doc,{},{},target,{beforeStart:()=>observed.push(scope.getStore())}));
 const first=start('first'),second=start('second');await tick();assert.deepEqual(observed,['first']);assert.equal(f.workers.length,1);const packet=f.workers[0].packets[0];f.workers[0].emit('message',{id:packet.id,value:{committed:true,file:target.file}});await tick();assert.equal(f.workers.length,1);f.workers[0].emit('exit',0);await first;await tick();assert.deepEqual(observed,['first','second']);assert.equal(f.workers.length,2);finish(f.workers[1]);await second;await f.pool.dispose();
});
test('complete Word operations preserve synchronous capture and join cleanup after cancellation',async()=>{
 const operations=new WordExportOperations(),body=gate(),cleanup=gate();let captured,signal,disposed=false;const input={value:'original'},pending=operations.run(async current=>{captured=input.value;signal=current;try{await body.promise;}finally{await cleanup.promise;}});input.value='new';assert.equal(captured,'original');const disposal=operations.dispose().then(()=>disposed=true);assert.equal(signal.aborted,true);body.resolve();await tick();assert.equal(disposed,false);assert.equal(operations.active.size,1);cleanup.resolve();await pending;await disposal;assert.equal(operations.active.size,0);await assert.rejects(operations.run(()=>{}),/closing/);
});
test('actual quit waits for worker exit and complete media cleanup while canceled quit preserves tools',async()=>{
 const app=new EventEmitter(),workers=gate(),cleanup=gate();let stopped=0,cleaned=0,quits=0,prevented=0;
 const pool={jobs:new Set([{}]),dispose(){stopped++;return workers.promise;}},operations={active:new Set([{}]),dispose(){cleaned++;return cleanup.promise;}};app.quit=()=>{quits++;app.emit('will-quit',{preventDefault(){throw Error('settled quit must not be prevented')}})};
 installWordShutdown(app,{pool,operations});installWordShutdown(app,{pool,operations});app.emit('before-quit',{preventDefault(){}});assert.equal(stopped,0);assert.equal(cleaned,0);
 app.emit('will-quit',{preventDefault(){prevented++}});app.emit('will-quit',{preventDefault(){prevented++}});assert.equal(prevented,2);assert.equal(stopped,1);assert.equal(cleaned,1);pool.jobs.clear();workers.resolve();await tick();assert.equal(quits,0);operations.active.clear();cleanup.resolve();await tick();assert.equal(quits,1);
});
