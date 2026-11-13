const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-pen-display-'));
function bundle(name,file){const out=path.join(dir,name+'.cjs');esbuild.buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',outfile:out});return require(out);}
const shared=bundle('shared','src/tablet/shared/pen.ts'),feed=bundle('feed','src/tablet/main/pen/buttonsFeed.ts'),native=bundle('native','src/tablet/renderer/nativeButtons.ts');
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
test('button reports clear presses when the pen leaves range',()=>{
 assert.deepEqual(shared.readButtons({present:true,range:false,tip:true,lower:true,upper:true}),{present:true,range:false,tip:false,lower:false,upper:false});
 assert.deepEqual(shared.readButtons(null),shared.NO_BUTTONS);
});
test('the display button feed sends changes only and keeps its own state',()=>{
 const f=feed.createButtonsFeed(),events=[];f.onChange(s=>events.push(s));const next={present:true,range:true,tip:true,lower:true,upper:false};f.set(next);f.set(next);next.lower=false;assert.equal(events.length,1);assert.equal(f.get().lower,true);events[0].tip=false;assert.equal(f.get().tip,true);
});
test('display button mapping keeps first and second buttons distinct',()=>{
 native.resetNativeButtons();native.setNativeButtons({present:true,range:true,tip:true,lower:true,upper:false},1000);assert.equal(native.nativeLive(1000),true);assert.equal(native.nativeSideMask(),2);native.setNativeButtons({present:true,range:true,tip:true,lower:false,upper:true},1001);assert.equal(native.nativeSideMask(),4);native.setNativeButtons({present:false,range:false,tip:false,lower:false,upper:false},1002);assert.equal(native.nativeLive(1002),false);
});

test('the display reader processes physical button reports and clears state on disconnect',()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
 const {MacPenButtons}=bundle('reader','src/tablet/main/pen/displayButtonsReader.ts');
 const buttons=feed.createButtonsFeed(),child=new EventEmitter(),events=[];child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{events.push('kill')};
 const log={event(){},raw(){}};let args;const timers=[];
 const reader=new MacPenButtons('helper',buttons,log,()=>0,(_file,a)=>{args=a;return child},(fn,ms)=>{timers.push({fn,ms});return 0});
 assert.equal(reader.start(),true);assert.deepEqual(args,['--buttons']);
 child.stdout.write('{"k":"opened","mode":"buttons"}\n');assert.equal(buttons.get().present,true);
 child.stdout.write('not json\n{"k":"buttons","range":true,"tip":true,"lower":true,"upper":false}\n');assert.deepEqual(buttons.get(),{present:true,range:true,tip:true,lower:true,upper:false});
 child.stdout.write('{"k":"closed","why":"removed"}\n');assert.deepEqual(buttons.get(),shared.NO_BUTTONS);
 child.emit('exit',1,null);assert.equal(timers[0].ms,2000);reader.stop();assert.deepEqual(buttons.get(),shared.NO_BUTTONS);
});

test('the built Mac helper decodes display reports without opening hardware',{skip:process.platform!=='darwin'||!fs.existsSync('src/helpers/wm-pen-display')},()=>{
 const run=(...args)=>JSON.parse(require('node:child_process').execFileSync(path.resolve('src/helpers/wm-pen-display'),args,{encoding:'utf8'}));
 assert.deepEqual(run('--decode','1e 01 c3'),{k:'buttons',range:true,tip:true,lower:true,upper:false});
 assert.deepEqual(run('--decode','1e 01 80'),{k:'buttons',range:false,tip:false,lower:false,upper:false});
 assert.equal(run('--decode','00 01 c3').k,'not-a-button-report');
 assert.equal(run('--describe-one').length,34);
 assert.equal(run('--check-one-hover','c0','5').ready,true);assert.equal(run('--check-one-hover','c1','5').ready,false);assert.equal(run('--check-one-hover','c0','500').ready,false);
 assert.equal(run('--check-one-seize-timeout','1','false','800').expired,true);
});

test('display button IPC only serves the app window and stops when disposed',()=>{
 const {installPenIpc}=bundle('ipc','src/tablet/main/pen/ipc.ts'),buttons=feed.createButtonsFeed(),handlers=new Map(),listeners=new Map(),sent=[];
 const ipc={handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name),on:(name,fn)=>listeners.set(name,fn),removeListener:name=>listeners.delete(name)};
 const sender={send:(...args)=>sent.push(args),isDestroyed:()=>false},win={webContents:sender,isDestroyed:()=>false};
 const manager={onSamples:()=>()=>{},onStatus:()=>()=>{},onEvent:()=>()=>{}};
 const install=installPenIpc({ipc,window:()=>win,manager,buttons,trace:{event(){}},e2e:false});
 const get=handlers.get('pen:buttons-get');assert.equal(get({sender:{}}),undefined);assert.deepEqual(get({sender}),shared.NO_BUTTONS);
 buttons.set({present:true,range:true,tip:false,lower:true,upper:false});assert.equal(sent.at(-1)[0],'pen:buttons-push');assert.equal(sent.at(-1)[1].lower,true);
 install.dispose();assert.equal(handlers.has('pen:buttons-get'),false);const count=sent.length;buttons.set(shared.NO_BUTTONS);assert.equal(sent.length,count);
});

test('physical display buttons control pen contact without changing other pointers',()=>{
 const out=path.join(dir,'buttons.cjs');esbuild.buildSync({stdin:{contents:"export * from './src/tablet/renderer/penButtons.ts'; export {setNativeButtons,resetNativeButtons} from './src/tablet/renderer/nativeButtons.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:out,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}});
 const actions=require(out);actions.resetNativeButtons();const event={pointerType:'pen',pointerId:7,button:0,buttons:0,pressure:0};
 actions.setNativeButtons({present:true,range:true,tip:true,lower:true,upper:false});assert.equal(actions.inContact(event),true);assert.equal(actions.slotOf(event),'lower');assert.equal(actions.resolvePress(event,{eraser:false}).kind,'erase');
 actions.setNativeButtons({present:true,range:true,tip:false,lower:true,upper:false});assert.equal(actions.resolvePress(event,{eraser:false}).kind,'ignore');
 const synthetic={...event,pointerId:4242,button:2,buttons:2,pressure:.5};assert.equal(actions.slotOf(synthetic),'lower');assert.equal(actions.inContact(synthetic),true);
 actions.resetNativeButtons();assert.equal(actions.resolvePress({...event,pointerId:4242,button:0,buttons:3,pressure:.7},{eraser:false}).kind,'erase');assert.equal(actions.resolvePress({...event,pointerId:4242,button:0,buttons:5,pressure:.7},{eraser:false}).kind,'select');
 const mouse={...event,pointerType:'mouse',button:0,buttons:1};assert.equal(actions.inContact(mouse),true);actions.resetNativeButtons();
});

test('display capture validates the device, renews its lease and releases the pen',()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),{MacWacomOneCaptureController}=bundle('capture','src/tablet/main/pen/displayCapture.ts');
 const make=()=>{const p=new EventEmitter();p.stdout=new PassThrough();p.stdin=new PassThrough();p.kill=()=>{p.killed=true};return p;};let process=make(),args;const capture=new MacWacomOneCaptureController('helper',()=>42,(_file,a)=>{args=a;return process}),samples=[],statuses=[];
 capture.onSample((id,s)=>samples.push([id,s]));capture.onStatus((id,s)=>statuses.push([id,s.state]));capture.start(7);assert.deepEqual(args,['--capture-one']);
 process.stdout.write('{"k":"device","pid":974,"maxX":25632,"maxY":14418,"maxP":4095}\n{"k":"opened","mode":"one"}\n');assert.equal(capture.status().state,'active');assert.equal(capture.heartbeat(8),false);assert.equal(capture.heartbeat(7),true);
 process.stdout.write('{"k":"p","f":225,"x":12816,"y":3604.5,"p":2047.5}\n');assert.equal(samples.length,1);assert.equal(samples[0][1].x,.5);assert.equal(samples[0][1].y,.75);assert.equal(samples[0][1].tip,true);
 capture.stop('closed');assert.equal(samples.at(-1)[1].inRange,false);assert.equal(process.killed,true);assert.equal(capture.status().state,'idle');
 process=make();capture.start(9);process.stdout.write('{"k":"device","pid":1,"maxX":25632,"maxY":14418,"maxP":4095}\n');assert.equal(capture.status().state,'failed');assert.equal(process.killed,true);
});

test('capture leases accept only the active display and expire without a heartbeat',()=>{
 const {createPadCaptureLease}=bundle('lease','src/tablet/main/pen/padCapture.ts');let now=0,target=7;const calls=[],driver={start:id=>calls.push(['start',id]),heartbeat:id=>calls.push(['beat',id]),stop:reason=>calls.push(['stop',reason])};
 const lease=createPadCaptureLease({driver,target:()=>target,now:()=>now});lease.heartbeat(8);assert.equal(calls.length,0);lease.heartbeat(7);assert.deepEqual(calls.slice(0,2),[['start',7],['beat',7]]);now=751;lease.audit();assert.match(calls.at(-1)[1],/expired/);
 now=1000;lease.heartbeat(7);target=null;lease.audit();assert.match(calls.at(-1)[1],/unavailable/);target=7;now=2000;lease.heartbeat(7);lease.status(7,{state:'needs-input-monitoring',reason:'permission'});assert.equal(calls.at(-1)[1],'permission');const count=calls.length;now=3000;lease.heartbeat(7);assert.equal(calls.length,count);now=7000;lease.heartbeat(7);assert.equal(calls.at(-2)[0],'start');
});
