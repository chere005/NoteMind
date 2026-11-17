const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../src/notes-core.js'),'utf8'),changed=source.slice(source.indexOf(' function changed(tab)'),source.indexOf(' async function saveActive'));
test('typing in another tab cannot cancel pending image search cleanup',async()=>{
 const a={doc:{id:'A',path:'A.nm',assets:{}},hadImageAssets:true},b={doc:{id:'B',path:'B.nm',assets:{'assets/image.png':'AA=='}}},calls=[],timers=new Map(),context={indexTimers:new Map(),indexTimer:null,ready:true,tabs:[a,b],activeTab:a,NoteMindDocument:{mime:name=>name.endsWith('.png')?'image/png':null},window:{NoteMindHistory:{record(){}}},schedule(){},snapshot:tab=>tab.doc,api:{indexImages:async(doc,options)=>{calls.push({id:doc.id,options});return {errors:[]}}},$(){return {}},setTimeout:fn=>{const id={};timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(changed,context);context.changed(a);context.activeTab=b;context.changed(b);assert.equal(timers.size,2);
 for(const fn of [...timers.values()])fn();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.map(c=>c.id),['A','B']);assert.ok(calls.every(c=>c.options.background));assert.equal(context.indexTimers.size,0);
});
