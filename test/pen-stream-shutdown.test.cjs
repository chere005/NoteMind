const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),esbuild=require('esbuild'),vm=require('node:vm');
const result=esbuild.buildSync({stdin:{contents:"export {MacPenButtons} from './src/tablet/main/pen/displayButtonsReader.ts';export {MacPenBackend} from './src/tablet/main/pen/macPenBackend.ts';export {createButtonsFeed} from './src/tablet/main/pen/buttonsFeed.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}),loaded={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module:loaded,exports:loaded.exports,require,process,performance,Buffer,setTimeout,clearTimeout});
const {MacPenButtons,MacPenBackend,createButtonsFeed}=loaded.exports;
const child=()=>{const value=new EventEmitter();value.stdin=new PassThrough();value.stdout=new PassThrough();value.kill=()=>{value.killed=true};return value;};
const pipeError=()=>Object.assign(Error('write EPIPE'),{code:'EPIPE'});
for(const stream of ['stdin','stdout']){
 test('display buttons handle '+stream+' failure and ignore late old-helper errors',()=>{
  const first=child(),second=child(),feed=createButtonsFeed(),timers=[];let next=first;
  const reader=new MacPenButtons('helper',feed,{event(){},raw(){}},()=>0,()=>next,(fn,ms)=>{timers.push({fn,ms});return 0});
  reader.start();first.stdout.write('{"k":"opened","mode":"buttons"}\n');assert.equal(feed.get().present,true);
  assert.doesNotThrow(()=>first[stream].emit('error',pipeError()));assert.equal(reader.running(),false);assert.equal(feed.get().present,false);assert.equal(first.killed,true);assert.equal(timers.length,1);
  next=second;timers[0].fn();second.stdout.write('{"k":"opened","mode":"buttons"}\n');assert.equal(feed.get().present,true);
  assert.doesNotThrow(()=>first.stdin.emit('error',pipeError()));assert.doesNotThrow(()=>first.stdout.emit('error',pipeError()));assert.equal(reader.running(),true);assert.equal(feed.get().present,true);assert.equal(timers.length,1);
  reader.stop();assert.doesNotThrow(()=>second.stdin.emit('error',pipeError()));assert.doesNotThrow(()=>second.stdout.emit('error',pipeError()));assert.equal(feed.get().present,false);assert.equal(timers.length,1);
 });
 test('tablet backend handles '+stream+' failure before and after startup without harming its replacement',async()=>{
  const first=child(),second=child(),third=child();let next=first;const backend=new MacPenBackend('helper',()=>0,()=>next),ctx={settings:{mapSheet:true},trace:{event(){},raw(){}}};
  const starting=backend.start(ctx);assert.doesNotThrow(()=>first[stream].emit('error',pipeError()));assert.equal((await starting).ok,false);assert.equal(first.killed,true);assert.equal(backend.status().state,'failed');first.stdout.write('{"k":"opened"}\n');assert.equal(backend.status().state,'failed');
  next=second;const opened=backend.start(ctx);second.stdout.write('{"k":"opened"}\n');assert.equal((await opened).ok,true);
  assert.doesNotThrow(()=>first.stdin.emit('error',pipeError()));assert.doesNotThrow(()=>first.stdout.emit('error',pipeError()));assert.equal(backend.status().state,'armed');
  second[stream].emit('error',pipeError());assert.equal(second.killed,true);assert.equal(backend.status().state,'failed');
  next=third;const replacement=backend.start(ctx);third.stdout.write('{"k":"opened"}\n');assert.equal((await replacement).ok,true);second.stdin.emit('error',pipeError());second.stdout.emit('error',pipeError());assert.equal(backend.status().state,'armed');
  backend.stop();assert.doesNotThrow(()=>third.stdin.emit('error',pipeError()));assert.doesNotThrow(()=>third.stdout.emit('error',pipeError()));assert.equal(backend.status().state,'idle');
 });
}
