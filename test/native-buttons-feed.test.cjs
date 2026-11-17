const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
const output=esbuild.buildSync({stdin:{contents:"export {installNativeButtons} from './src/tablet/renderer/nativeButtonsFeed.ts';export {nativeState} from './src/tablet/renderer/nativeButtons.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['react'],write:false}).outputFiles[0].text;
function harness(){
 const reads=[],events={},module={exports:{}};let push,subscriptions=0;
 const window={wm:{pen:{onButtons:fn=>{push=fn;subscriptions++;},buttons:()=>new Promise(resolve=>reads.push(resolve))}},addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(output,{module,exports:module.exports,require,window,performance});
 return {...module.exports,reads,focus:()=>events.focus(),push:value=>push(value),subscriptions:()=>subscriptions};
}
const state=patch=>({present:true,range:true,tip:false,lower:false,upper:false,...patch});
test('initial and focus snapshots cannot overwrite newer physical button pushes',async()=>{
 const h=harness();h.installNativeButtons();h.installNativeButtons();assert.equal(h.subscriptions(),1);assert.equal(h.reads.length,1);
 h.push(state({lower:true}));h.reads[0](state({present:false,range:false}));await Promise.resolve();assert.equal(h.nativeState().lower,true);assert.equal(h.nativeState().present,true);
 h.focus();assert.equal(h.reads.length,2);h.push(state({lower:false}));h.reads[1](state({lower:true}));await Promise.resolve();assert.equal(h.nativeState().lower,false);
});
test('the newest focus refresh wins when snapshots resolve out of order',async()=>{
 const h=harness();h.installNativeButtons();h.reads[0](state({}));await Promise.resolve();h.focus();h.focus();assert.equal(h.reads.length,3);
 h.reads[2](state({upper:true}));await Promise.resolve();h.reads[1](state({upper:false,range:false}));await Promise.resolve();assert.equal(h.nativeState().upper,true);assert.equal(h.nativeState().range,true);
});
