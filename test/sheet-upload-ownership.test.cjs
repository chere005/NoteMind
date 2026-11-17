const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const tick=()=>new Promise(setImmediate),gate=()=>{let resolve;return{promise:new Promise(yes=>resolve=yes),resolve:()=>resolve()};};
function preload(invoke){let api;vm.runInNewContext(fs.readFileSync(require.resolve('../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{if(name==='notemind')api=value;}},ipcRenderer:{invoke},webFrame:{},webUtils:{}}),process:{platform:'darwin'},setTimeout,clearTimeout});return api;}
test('actual preload retains only its own bridge clone until upload ACK and releases on either success or failure',async()=>{
 for(const fail of [false,true])for(const method of ['writeSheetsDeltaUpload','writeCameraPagesDeltaUpload']){const hold=gate(),world=new Uint8Array([3,4,5]),isolated=structuredClone({kind:'geometry',index:0,offset:0,data:world});let main;
 const api=preload(async(channel,token,part,options)=>{assert.equal(options.consume,true);main=structuredClone(part);await hold.promise;if(fail)throw Error('upload failed');return 3;});
 const pending=api[method]('owned',isolated,{consume:true});assert.equal(isolated.data.length,3);assert.equal(main.data.length,3);hold.resolve();if(fail)await assert.rejects(pending,/upload failed/);else assert.equal(await pending,3);assert.equal(isolated.data.buffer.byteLength,0);assert.deepEqual(world,new Uint8Array([3,4,5]));assert.deepEqual(main.data,new Uint8Array([3,4,5]));}
});
test('preload default borrowed and incomplete backing arguments remain intact',async()=>{const api=preload(async()=>true),bytes=new Uint8Array([1,2,3]);await api.writeSheetsDeltaUpload('legacy',{data:bytes});assert.equal(bytes.length,3);await api.writeSheetsDeltaUpload('partial',{data:bytes.subarray(1)},{consume:true});assert.deepEqual(bytes,new Uint8Array([1,2,3]));});
test('worker releases a transferred upload input after staging copy, including rejected offsets',async()=>{
 for(const fail of [false,true]){let handle,reply;const parentPort={on:(event,fn)=>handle=fn,postMessage:value=>reply=value};
 const FakeStore=class{constructor(){}},append=(token,part)=>{assert.equal(part.data.length,3);if(fail)throw Error('wrong offset');return 3;};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/sheet-persistence-worker.cjs'),'utf8'),{require:name=>name==='node:worker_threads'?{parentPort,workerData:{}}:name==='./sheet-store.cjs'?{SheetStore:FakeStore}:name==='./sheet-delta-staging.cjs'?{SheetDeltaStaging:class{append(...args){return append(...args);}}}:name==='./sheet-read-work.cjs'?{}:require(name),Uint8Array,ArrayBuffer,DataView,Promise});
 const bytes=new Uint8Array([7,8,9]);handle({id:1,kind:'writeDeltaUpload',value:{token:'owned',part:{data:bytes},ownedPart:true}});await tick();assert.equal(bytes.buffer.byteLength,0);if(fail)assert.match(reply.error,/wrong offset/);else assert.equal(reply.value,3);}
});
