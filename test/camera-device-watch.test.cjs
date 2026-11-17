const {test}=require('node:test'),assert=require('node:assert/strict'),{watchCameraDevices}=require('../src/camera-device-watch.cjs');
test('inactive capture never touches media services and activation owns only its exact subscription',()=>{
 let accesses=0;const listeners=new Set(),media={addEventListener(name,fn){assert.equal(name,'devicechange');listeners.add(fn)},removeEventListener(name,fn){assert.equal(name,'devicechange');listeners.delete(fn)}};
 const get=()=>{accesses++;return media},changed=()=>{};
 const idle=watchCameraDevices(get,false,changed);assert.equal(accesses,0);idle();assert.equal(listeners.size,0);
 const active=watchCameraDevices(get,true,changed),other=()=>{};listeners.add(other);assert.equal(accesses,1);assert.ok(listeners.has(changed));active();active();assert.deepEqual([...listeners],[other]);
});
test('unavailable camera APIs leave an enabled workflow without a leaked cleanup obligation',()=>{
 for(const media of [undefined,{}])assert.doesNotThrow(()=>watchCameraDevices(()=>media,true,()=>{})());
});
