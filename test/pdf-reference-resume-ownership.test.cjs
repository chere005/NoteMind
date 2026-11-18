const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{create}=require('../src/pdf-reference-notes.js');
const file=fs.readFileSync(require.resolve('../src/tablet/renderer/PDFReferenceWorkspace.tsx'),'utf8'),start=file.indexOf(' async function openSource(){'),end=file.indexOf('\n useLayoutEffect(()=>{if(!active)',start);assert.ok(start>=0&&end>start);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function fixture(){
 const tab={doc:{id:'note',assets:{'assets/source.pdf':'exact-original-pdf'},meta:{}}},other={doc:{id:'other-note',assets:{'assets/source.pdf':'exact-original-pdf'},meta:{}}},dirty=[],tabs=[tab,other],refs=create({getTabs:()=>tabs,uuid:()=> 'attachment-binding',matchDocument:async snapshot=>snapshot.assets['assets/source.pdf']==='exact-original-pdf',onDirty:owner=>dirty.push(owner)}),id=refs.captureAttachment(tab,'assets/source.pdf').bindingId,source={id:'existing-service',sourceHash:'a'.repeat(64),pageCount:2,index:null};refs.register(id,source);await refs.suspend(id);assert.equal(refs.get(id).sourceData,null);assert.equal(refs.get(id).suspended,true);
 const retained=[],previous={source},c={closing:{current:false},owner:{closed:false},activeRef:{current:true},views:new Map(),key:'original-view',state:{current:previous},binding:{current:id},importer:{current:null},refs,api:{retain:async(...args)=>retained.push(args),open:async()=>{throw Error('Existing source must not reopen.');}}};vm.createContext(c);vm.runInContext(file.slice(start,end),c);return{tab,other,dirty,tabs,refs,id,source,c,previous,retained};
}
const edit=h=>h.refs.edited(h.id,1,[{colorHex:'#123456',width:2,points:[{x:.2,y:.3}]}],1);
test('reactivating an existing PDF service source restores its suspended actual attachment binding',async()=>{
 const h=await fixture();try{assert.equal(await h.c.openSource(),h.previous);assert.equal(h.refs.get(h.id).sourceData,h.tab.doc.assets['assets/source.pdf']);assert.equal(h.refs.get(h.id).suspended,false);assert.deepEqual(h.retained,[['existing-service',true]]);edit(h);assert.deepEqual(h.dirty,[h.tab]);assert.deepEqual(h.other.doc.meta,{});}finally{h.refs.dispose(h.id);}
});
for(const change of ['closed-original','changed-attachment'])test('PDF cached reactivation cannot attach ink to '+change,async()=>{
 const h=await fixture();try{if(change==='closed-original')h.tabs.splice(0,1);else h.tab.doc.assets['assets/source.pdf']='different-pdf';await h.c.openSource();assert.equal(h.refs.get(h.id).sourceData,null);edit(h);assert.deepEqual(h.dirty,[]);assert.deepEqual(h.other.doc.meta,{});assert.deepEqual(h.tab.doc.meta,{});}finally{h.refs.dispose(h.id);}
});
test('an admitted source that opens after suspension remains unretained until its exact active successor resumes it',async()=>{
 const h=await fixture(),opened=deferred(),releases=[];try{
  h.c.state.current=null;h.c.doc={path:'original.pdf'};h.c.password='';h.c.setOpened=()=>{};h.c.releaseModels=async()=>releases.push('models');h.c.makeState=source=>({source,retained:true});h.c.api.open=()=>opened.promise;
  const loading=h.c.openSource();await new Promise(setImmediate);h.c.activeRef.current=false;opened.resolve(h.source);const state=await loading;assert.equal(state.source,h.source);assert.equal(state.retained,false);assert.equal(h.refs.get(h.id).suspended,true);assert.equal(h.refs.get(h.id).sourceData,null);assert.deepEqual(h.retained,[['existing-service',false]]);
  h.c.activeRef.current=true;assert.equal(await h.c.openSource(),state);assert.equal(state.retained,true);assert.equal(h.refs.get(h.id).sourceData,'exact-original-pdf');assert.deepEqual(h.retained,[['existing-service',false],['existing-service',true]]);assert.deepEqual(releases,['models']);
 }finally{h.refs.dispose(h.id);}
});
