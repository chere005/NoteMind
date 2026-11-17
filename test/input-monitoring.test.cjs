const {test}=require('node:test'),assert=require('node:assert/strict'),{createInputMonitoring}=require('../src/input-monitoring.cjs');
const settings='x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';
function fixture({access='denied',platform='darwin',failure=null,output,openFailure=null,helper='/app/helpers/wm-pen-display'}={}){
 const calls=[],opened=[],errors=[];
 const monitor=createInputMonitoring({platform,helper,onError:error=>errors.push(error),execFile:(file,args,options,callback)=>{calls.push({file,args,options});callback(failure,output??JSON.stringify({k:'access',v:access})+'\n');},shell:{openExternal:async url=>{opened.push(url);if(openFailure)throw openFailure;}}});
 return {monitor,calls,opened,errors};
}
test('missing access requests consent and opens the fixed Input Monitoring pane only once automatically',async()=>{
 const h=fixture();for(const state of ['checking','listening','active','idle','failed'])assert.equal(h.monitor.onStatus({state}),null);assert.equal(h.calls.length,0);
 assert.deepEqual(await h.monitor.onStatus({state:'needs-input-monitoring'}),{access:'denied',openedSettings:true});
 for(const state of ['checking','needs-input-monitoring','idle','needs-input-monitoring'])await h.monitor.onStatus({state});
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].args,['--request-access']);assert.equal(h.calls[0].file,'/app/helpers/wm-pen-display');assert.equal(h.calls[0].options.timeout,10000);assert.deepEqual(h.opened,[settings]);assert.deepEqual(h.errors,[]);
});
test('granted access does not open System Settings and diagnostics may contain other JSON lines',async()=>{
 const h=fixture({output:'{"k":"log","m":"checking"}\n{"k":"access","v":"granted"}\n'});
 assert.deepEqual(await h.monitor.request(),{access:'granted',openedSettings:false});assert.deepEqual(h.opened,[]);assert.deepEqual(h.errors,[]);
});
test('manual and automatic requests share in-flight work and manual retries work after it finishes',async()=>{
 const pending=[],opened=[];const monitor=createInputMonitoring({platform:'darwin',helper:'/helper',execFile:(_file,_args,_options,callback)=>pending.push(callback),shell:{openExternal:async url=>opened.push(url)}});
 const automatic=monitor.onStatus({state:'needs-input-monitoring'});assert.equal(monitor.request(),automatic);assert.equal(monitor.onStatus({state:'needs-input-monitoring'}),automatic);
 await Promise.resolve();assert.equal(pending.length,1);pending[0](null,'{"k":"access","v":"undecided"}\n');await automatic;assert.deepEqual(opened,[settings]);assert.equal(monitor.onStatus({state:'needs-input-monitoring'}),null);
 const retry=monitor.request();assert.notEqual(retry,automatic);await Promise.resolve();assert.equal(pending.length,2);pending[1](null,'{"k":"access","v":"granted"}\n');assert.deepEqual(await retry,{access:'granted',openedSettings:false});assert.deepEqual(opened,[settings]);
});
test('a manual first request also prevents background retries from repeatedly opening Settings',async()=>{
 const h=fixture();await h.monitor.request();await h.monitor.onStatus({state:'needs-input-monitoring'});assert.equal(h.calls.length,1);assert.deepEqual(h.opened,[settings]);
});
test('helper errors, timeout, malformed output and unavailable helpers still open Settings',async()=>{
 for(const options of [{failure:Error('spawn failed')},{failure:Object.assign(Error('timeout'),{killed:true,signal:'SIGTERM'})},{output:'not valid JSON\n'},{output:'{"k":"access","v":"unexpected"}\n'},{helper:null}]){
  const h=fixture(options);assert.deepEqual(await h.monitor.request(),{access:'unknown',openedSettings:true});assert.deepEqual(h.opened,[settings]);assert.equal(h.errors.length,1);
 }
});
test('Settings errors are reported without unhandled rejections and manual retries remain available',async()=>{
 const failure=Error('Settings could not open'),h=fixture({openFailure:failure});assert.deepEqual(await h.monitor.request(),{access:'denied',openedSettings:false});assert.deepEqual(h.errors,[failure]);await h.monitor.request();assert.equal(h.calls.length,2);
});
test('other platforms never run the Mac helper or open Mac settings',async()=>{
 const h=fixture({platform:'win32'});await h.monitor.onStatus({state:'needs-input-monitoring'});await h.monitor.request();assert.deepEqual(h.calls,[]);assert.deepEqual(h.opened,[]);assert.deepEqual(h.errors,[]);
});
