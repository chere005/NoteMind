const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
const built=buildSync({stdin:{contents:"export {createPadCaptureLease} from './src/tablet/main/pen/padCapture.ts';export {MacWacomOneCaptureController} from './src/tablet/main/pen/displayCapture.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}),loaded={exports:{}};
vm.runInNewContext(built.outputFiles[0].text,{module:loaded,exports:loaded.exports,require,process});
const {createPadCaptureLease,MacWacomOneCaptureController}=loaded.exports;

test('permission refusal stays paused through heartbeats until an explicit retry',()=>{
 let now=0;const calls=[],driver={start:id=>calls.push(['start',id]),heartbeat:id=>{calls.push(['beat',id]);return true},stop:reason=>calls.push(['stop',reason])};
 const lease=createPadCaptureLease({driver,target:()=>7,now:()=>now});lease.heartbeat(7);lease.status(7,{state:'needs-input-monitoring',reason:'permission'});
 const count=calls.length;for(now=250;now<=60000;now+=250){lease.heartbeat(7);lease.audit()}
 assert.equal(calls.length,count);assert.equal(calls.some(([name])=>name==='stop'),false);
 lease.retry();assert.deepEqual(calls.at(-1),['stop','pen input retry requested']);lease.heartbeat(7);assert.deepEqual(calls.at(-2),['start',7]);
});

test('transient capture failures retain their bounded retry delay',()=>{
 let now=0;const starts=[],driver={start:id=>starts.push(id),heartbeat:()=>true,stop(){}};
 const lease=createPadCaptureLease({driver,target:()=>7,now:()=>now});lease.heartbeat(7);lease.status(7,{state:'unavailable',reason:'removed'});
 now=4999;lease.heartbeat(7);assert.equal(starts.length,1);now=5000;lease.heartbeat(7);assert.equal(starts.length,2);
});

test('permission status survives controller cleanup and explicit retry establishes a fresh lease',()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');let now=0;const children=[],statuses=[];
 const capture=new MacWacomOneCaptureController('helper',()=>now,()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>{};children.push(child);return child});
 const lease=createPadCaptureLease({driver:capture,target:()=>7,now:()=>now});capture.onStatus((id,status)=>{statuses.push(status.state);lease.status(id,status)});
 lease.heartbeat(7);children[0].stdout.write('{"k":"access","v":"denied"}\n');assert.equal(capture.status().state,'needs-input-monitoring');assert.deepEqual(statuses,['checking','needs-input-monitoring']);
 for(now=250;now<=10000;now+=250){lease.heartbeat(7);lease.audit()}
 assert.equal(children.length,1);assert.equal(capture.status().state,'needs-input-monitoring');lease.retry();lease.heartbeat(7);
 assert.equal(children.length,2);assert.equal(capture.status().state,'checking');assert.equal(children[1].stdin.read()?.toString(),'ping\n');children[1].stdout.write('{"k":"opened","mode":"one"}\n');lease.heartbeat(7);assert.equal(capture.status().state,'active');assert.equal(children[1].stdin.read()?.toString(),'ping\n');lease.stop();
});
