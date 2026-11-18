const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),esbuild=require('esbuild'),vm=require('node:vm');
const built=esbuild.buildSync({stdin:{contents:"export {MacPenButtons} from './src/tablet/main/pen/displayButtonsReader.ts'; export {MacPenBackend} from './src/tablet/main/pen/macPenBackend.ts'; export {createButtonsFeed} from './src/tablet/main/pen/buttonsFeed.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}),loaded={exports:{}};
vm.runInNewContext(built.outputFiles[0].text,{module:loaded,exports:loaded.exports,require,process,performance,Buffer,setTimeout,clearTimeout});
const {MacPenButtons,MacPenBackend,createButtonsFeed}=loaded.exports;
const child=()=>Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),kill(){this.killed=true}}),trace={event(){},raw(){}},ctx={settings:{mapSheet:true},trace};
test('asynchronous display-helper spawn failure releases its slot and schedules a retry',()=>{
 const first=child(),second=child(),feed=createButtonsFeed(),timers=[];let next=first;
 const reader=new MacPenButtons('helper',feed,trace,()=>0,()=>next,(fn,ms)=>{timers.push({fn,ms});return 0});reader.start();first.emit('error',Object.assign(Error('spawn helper ENOENT'),{code:'ENOENT'}));
 assert.equal(reader.running(),false);assert.equal(timers.length,1);assert.equal(timers[0].ms,2000);next=second;timers[0].fn();second.stdout.write('{"k":"opened","mode":"buttons"}\n');assert.equal(reader.running(),true);assert.equal(feed.get().present,true);reader.stop();
});
test('tablet refusal fences remaining lines and samples from that retired helper',async()=>{
 const process=child(),backend=new MacPenBackend('helper',()=>0,()=>process),samples=[];backend.onSample(batch=>samples.push(...batch));const opening=backend.start(ctx);
 process.stdout.write('{"k":"device","name":"test","pid":1,"maxX":100,"maxY":100,"maxP":100}\n{"k":"refused","why":"no Wacom"}\n{"k":"opened"}\n{"k":"p","f":225,"x":50,"y":50,"p":50}\n');
 assert.equal((await opening).ok,false);assert.equal(backend.status().state,'failed');backend.stop();assert.equal(samples.length,0);
});
test('display-helper error then exit cannot schedule twice or revive retired reports',()=>{
 const process=child(),feed=createButtonsFeed(),timers=[],reader=new MacPenButtons('helper',feed,trace,()=>0,()=>process,(fn,ms)=>{timers.push({fn,ms});return 0});reader.start();process.emit('error',Error('spawn failed'));process.emit('exit',1,null);process.stdout.write('{"k":"opened","mode":"buttons"}\n{"k":"buttons","range":true,"tip":true,"lower":true}\n');assert.equal(timers.length,1);assert.equal(reader.running(),false);assert.equal(feed.get().present,false);reader.stop();
});
test('actual missing display helper retries after error without depending on exit',async()=>{
 const timers=[],feed=createButtonsFeed(),reader=new MacPenButtons(require('node:path').join(require('node:os').tmpdir(),'notemind-missing-helper-'+require('node:crypto').randomUUID()),feed,trace,()=>0,undefined,(fn,ms)=>{timers.push({fn,ms});return 0});
 try{reader.start();for(let n=0;n<4;n++)await new Promise(setImmediate);assert.equal(reader.running(),false);assert.equal(timers.length,1);assert.equal(timers[0].ms,2000);assert.equal(feed.get().present,false);}finally{reader.stop();}
});
test('tablet helper failure after opening kills capture and ignores its batched tail',async()=>{
 const process=child(),backend=new MacPenBackend('helper',()=>0,()=>process),samples=[];backend.onSample(batch=>samples.push(...batch));const opening=backend.start(ctx);process.stdout.write('{"k":"device","name":"test","pid":1,"maxX":100,"maxY":100,"maxP":100}\n{"k":"opened"}\n');assert.equal((await opening).ok,true);process.stdout.write('{"k":"refused","why":"unplugged"}\n{"k":"opened"}\n{"k":"p","f":225,"x":50,"y":50,"p":50}\n');assert.equal(backend.status().state,'failed');assert.equal(process.killed,true);backend.stop();assert.equal(samples.length,0);
});
test('exited tablet helper cannot publish late armed or point reports',async()=>{
 const process=child(),backend=new MacPenBackend('helper',()=>0,()=>process),samples=[];backend.onSample(batch=>samples.push(...batch));const opening=backend.start(ctx);process.stdout.write('{"k":"device","name":"test","pid":1,"maxX":100,"maxY":100,"maxP":100}\n{"k":"opened"}\n');await opening;process.emit('exit',1);process.stdout.write('{"k":"opened"}\n{"k":"p","f":225,"x":50,"y":50,"p":50}\n');assert.equal(backend.status().state,'failed');backend.stop();assert.equal(samples.length,0);
});
