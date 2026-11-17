const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SheetPersistence,atomicSheetWrite}=require('../src/sheet-persistence.cjs'),{SheetSaveQueue}=require('../src/sheet-save-queue.js');
const stroke=x=>({colorHex:'#AbCdEf',width:2.125,points:[{x,y:.23456789012345678},{x:x+.001,y:-0}],pressures:[.12345678901234567,-0]}),sheet=(strokes,name='Drawing')=>({name,aspect:.6494444444444445,strokes,extent:{x:0,y:0,width:1,height:1},backdrop:null,paper:{kind:'dots',spacing:'medium',colour:'white'},file:null,saved:null});
const tick=()=>new Promise(setImmediate);
async function fixture(t,data=[sheet([stroke(.1)])],options={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-sheet-worker-')),file=path.join(root,'sheets.json');if(data!==null)await fs.writeFile(file,JSON.stringify(data));const {commit,...rest}=options,service=new SheetPersistence(file,rest);if(data!==null)await service.loadState();if(commit)service.commit=commit;t.after(async()=>{await service.dispose();await fs.rm(root,{recursive:true,force:true});});return {root,file,service};}
function queue(service){const calls=[],writer=new SheetSaveQueue({saveSheetsDelta:delta=>{calls.push(delta);return service.saveDelta(delta);}});return {writer,calls};}

test('worker checkpoints retain legacy files and append only new exact geometry across the renderer bridge',async t=>{
 const {file,service}=await fixture(t),state=await service.loadState(),{writer,calls}=queue(service);writer.seed(state);const initial=state.sheets[0],added=stroke(.8),next={...initial,strokes:[...initial.strokes,added]};
 const answer=await writer.save([next]);assert.equal(answer.addedStrokes,1);assert.equal(answer.addedPoints,2);assert.equal(calls[0].addStrokes[0].stroke,added);assert.equal(calls[0].sheets[0].appendStrokeIds.length,1);assert.equal(calls[0].addBackdrops.length,0);
 const restored=await service.load();assert.deepEqual(restored[0].strokes[1],added);assert.equal(Object.is(restored[0].strokes[1].points[1].y,-0),true);assert.equal(Object.is(restored[0].strokes[1].pressures[1],-0),true);
 const before=await fs.stat(file),unchanged=await writer.save([next]);assert.equal(unchanged.unchanged,true);assert.equal(unchanged.version,answer.version);assert.equal(calls[1].unchanged,true);assert.equal(Object.hasOwn(calls[1],'sheets'),false);assert.equal((await fs.stat(file)).mtimeMs,before.mtimeMs);writer.dispose();
});

test('deleting geometry prunes cached IDs and undo resends removed immutable strokes',async t=>{
 const {service}=await fixture(t,[sheet([stroke(.1),stroke(.8)])]),state=await service.loadState(),{writer,calls}=queue(service);writer.seed(state);const original=state.sheets[0];await writer.save([{...original,strokes:original.strokes.slice(0,1)}]);await writer.save([original]);assert.equal(calls[0].addStrokes.length,0);assert.equal(calls[1].addStrokes.length,1);assert.deepEqual((await service.load())[0].strokes,original.strokes);writer.dispose();
});

test('latest-state coalescing retains every appended stroke without accumulating full checkpoints',async t=>{
 let enter,release,blocked=true,writes=0;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 const {service}=await fixture(t,undefined,{commit:async(...args)=>{writes++;if(blocked){blocked=false;enter();await gate;}return atomicSheetWrite(...args);}}),state=await service.loadState(),{writer,calls}=queue(service);writer.seed(state);const original=state.sheets[0],a=stroke(.2),b=stroke(.3),c=stroke(.4),first=writer.save([{...original,strokes:[...original.strokes,a]}]);await entered;
 const middle=writer.save([{...original,name:'Middle',strokes:[...original.strokes,a,b]}]),last=writer.save([{...original,name:'Newest',strokes:[...original.strokes,a,b,c]}]);release();await Promise.all([first,middle,last]);const saved=await service.load();assert.equal(writes,2);assert.equal(saved[0].name,'Newest');assert.equal(saved[0].strokes.length,4);assert.equal(calls.length,2);assert.equal(calls[1].addStrokes.length,2);writer.dispose();
});

test('failed commits keep the previous disk/cache state and retries retain unsaved drawings',async t=>{
 let fail=true;const {file,service}=await fixture(t,undefined,{commit:async(...args)=>{if(fail){fail=false;throw Error('simulated commit failure');}return atomicSheetWrite(...args);}}),state=await service.loadState(),before=await fs.readFile(file,'utf8'),{writer}=queue(service);writer.seed(state);const data=[{...state.sheets[0],strokes:[...state.sheets[0].strokes,stroke(.7)]}];await assert.rejects(writer.save(data),/simulated/);assert.equal(await fs.readFile(file,'utf8'),before);assert.equal((await service.loadState()).version,0);await writer.save(data);assert.equal((await service.load())[0].strokes.length,2);writer.dispose();
});

test('worker restart resynchronizes cached identities without replacing unsaved renderer state',async t=>{
 const {service}=await fixture(t),state=await service.loadState(),{writer,calls}=queue(service);writer.seed(state);const next=[{...state.sheets[0],strokes:[...state.sheets[0].strokes,stroke(.9)]}];await service.worker.terminate();await tick();await writer.save(next);assert.equal(calls.at(-1).addStrokes.length,1);assert.equal((await service.load())[0].strokes.length,2);writer.dispose();
});

test('idempotent retries do not write twice; unknown references and external edits are preserved',async t=>{
 const {file,service}=await fixture(t),state=await service.loadState(),{writer,calls}=queue(service);writer.seed(state);const next=[{...state.sheets[0],name:'Once',strokes:[...state.sheets[0].strokes,stroke(.2)]}];const answer=await writer.save(next),before=await fs.readFile(file,'utf8'),again=await service.saveDelta(calls[0]);assert.equal(again.version,answer.version);assert.equal(await fs.readFile(file,'utf8'),before);
 await assert.rejects(service.saveDelta({requestId:'invalid-ref',session:answer.session,baseVersion:answer.version,full:false,sheets:[{metadata:{name:'Bad',aspect:1},strokeIds:[99999],backdropId:0}],addStrokes:[],addBackdrops:[]}),/Unknown/);assert.equal(await fs.readFile(file,'utf8'),before);
 const external=JSON.stringify([sheet([stroke(.6)],'External')]);await fs.writeFile(file,external);await assert.rejects(writer.save([{...next[0],name:'Local change'}]),/outside/);assert.equal(await fs.readFile(file,'utf8'),external);const fresh=await service.loadState();assert.equal(fresh.sheets.at(-1).name,'External');assert.equal(fresh.session,state.session);assert.ok(fresh.version>state.version);writer.dispose();
});

test('corrupt legacy recovery fails closed and the original bytes remain untouched',async t=>{
 const {file,service}=await fixture(t,null);await fs.writeFile(file,'invalid recovery');await assert.rejects(service.loadState());await assert.rejects(service.save([sheet([])]));assert.equal(await fs.readFile(file,'utf8'),'invalid recovery');
});

test('lost save acknowledgements retry idempotently without duplicate checkpoints',async t=>{
 let writes=0,lost=true;const {service}=await fixture(t,undefined,{commit:async(...args)=>{writes++;return atomicSheetWrite(...args);}}),state=await service.loadState(),writer=new SheetSaveQueue({saveSheetsDelta:async delta=>{const answer=await service.saveDelta(delta);if(lost&&!answer.resync){lost=false;throw Error('Drawing persistence worker stopped after acknowledgement');}return answer;}});writer.seed(state);const latest=[{...state.sheets[0],strokes:[...state.sheets[0].strokes,stroke(.9)]}];await writer.save(latest);assert.equal(writes,1);assert.equal((await service.load())[0].strokes.length,2);writer.dispose();
});

test('worker death after durable file commit cannot lose the pending snapshot',async t=>{
 let stopped=false,instance;const {service}=await fixture(t,undefined,{commit:async(...args)=>{const result=await atomicSheetWrite(...args);if(!stopped){stopped=true;await instance.worker.terminate();}return result;}});instance=service;const state=await service.loadState(),{writer}=queue(service);writer.seed(state);await writer.save([{...state.sheets[0],strokes:[...state.sheets[0].strokes,stroke(.8)]}]);assert.equal((await service.load())[0].strokes.length,2);writer.dispose();
});
