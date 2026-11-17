const {test}=require('node:test'),assert=require('node:assert/strict'),{SheetSaveQueue}=require('../src/sheet-save-queue.js'),{SheetLazyLoader}=require('../src/sheet-lazy-loader.js');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',C='00000000-0000-4000-8000-000000000003';
function state(pageId,count,start,backdrop=null){const strokes=Array.from({length:count},()=>({colorHex:'#123456',width:2,points:[]}));return{session:'store',version:1,nextStroke:50000,backdropIds:[backdrop?2:0],strokeIds:[strokes.map((_,at)=>at+start)],sheets:[{pageId,geometryRevision:'root-'+pageId,name:pageId,aspect:1,strokes,backdrop}]};}
const base=state(A,9000,1),incoming=state(B,17000,9001,'data:image/png;base64,INCOMING'),other=state(C,10,26001);
async function fixture(){const queue=new SheetSaveQueue({saveSheetsDelta:async delta=>({session:delta.session,requestId:delta.requestId,version:delta.baseVersion+(delta.unchanged?0:1),unchanged:!!delta.unchanged})});queue.seedCatalog({session:'store',version:1,nextStroke:50000,pages:[A,B,C].map(pageId=>({pageId,geometryRevision:'root-'+pageId,metadata:{name:pageId,aspect:1}}))});await queue.seedPage(base,{yieldControl:async()=>{}});return queue;}
async function stages(){const queue=await fixture();let count=0;await queue.seedPage(incoming,{yieldControl:async()=>count++});queue.dispose();return count;}
function unchanged(queue,known,epoch){assert.equal(queue.knownStrokes,known);assert.equal(queue.knownStrokes.size,9000);assert.equal(queue.knownStrokes.has(9001),false);assert.equal(queue.pageHeads.get(B).strokes,undefined);assert.equal(queue.freshStrokes.has(B),false);assert.equal(queue.freshBackdrops.size,0);assert.equal(queue.backdropIds.has(incoming.sheets[0].backdrop),false);assert.equal(queue.seedEpoch,epoch);assert.equal(queue.pageHeads.get(A).strokes,base.sheets[0].strokes);}
test('aborting at every seed yield leaves the existing baseline untouched and retries publish exact ownership',async()=>{
 const count=await stages();assert.ok(count>=5);
 for(let cut=1;cut<=count;cut++){
  const queue=await fixture(),known=queue.knownStrokes,epoch=queue.seedEpoch,controller=new AbortController();let paused=0;
  await assert.rejects(queue.seedPage(incoming,{signal:controller.signal,yieldControl:async()=>{if(++paused===cut)controller.abort();}}),{name:'AbortError'});unchanged(queue,known,epoch);
  await queue.seedPage(incoming,{yieldControl:async()=>{}});assert.equal(queue.knownStrokes.size,26000);assert.equal(queue.knownStrokes.has(26000),true);assert.equal(queue.pageHeads.get(B).strokes,incoming.sheets[0].strokes);assert.equal(queue.backdropIds.get(incoming.sheets[0].backdrop),2);assert.equal(queue.freshStrokes.get(B).ids.size,17000);queue.dispose();
 }
});
test('closing a lazy page at every seed yield never installs or retains its geometry or background',async()=>{
 for(let cut=1,count=await stages();cut<=count;cut++){
  const queue=await fixture(),known=queue.knownStrokes,epoch=queue.seedEpoch,page={},seed=queue.seedPage.bind(queue);let rows=[{pageId:B,page,loaded:false}],paused=0,installed=false;
  const loader=new SheetLazyLoader({api:{loadSheetPage:async()=>incoming},queue,getSheets:()=>rows,hydrate:async value=>value,install:()=>{installed=true;}});
  queue.seedPage=(value,options)=>seed(value,{...options,yieldControl:async()=>{if(++paused===cut){rows=[];loader.prune();}}});
  await assert.rejects(loader.ensure(page),{name:'AbortError'});assert.equal(installed,false);unchanged(queue,known,epoch);loader.dispose();queue.dispose();
 }
});
test('a save acknowledgement and another page seed during staging retain all newer legitimate identities',async()=>{
 const queue=await fixture();let paused=0,interleaved=false,newStroke;
 await queue.seedPage(incoming,{yieldControl:async()=>{
  if(++paused!==3||interleaved)return;interleaved=true;newStroke={colorHex:'#654321',width:3,points:[{x:.5,y:.5}]};
  await queue.save([{...base.sheets[0],name:'Written while seeding',strokes:[...base.sheets[0].strokes,newStroke]},{...incoming.sheets[0],loaded:false,strokes:undefined},{...other.sheets[0],loaded:false,strokes:undefined}]);
  await queue.seedPage(other,{yieldControl:async()=>{}});
 }});
 assert.equal(interleaved,true);assert.equal(queue.version,2);assert.equal(queue.pageHeads.get(A).strokes.at(-1),newStroke);assert.equal(queue.pageHeads.get(A).metadataSignature.includes('Written while seeding'),true);assert.equal(queue.pageHeads.get(C).strokes,other.sheets[0].strokes);assert.equal(queue.knownStrokes.has(queue.idOf(newStroke)),true);assert.equal(queue.knownStrokes.has(26010),true);assert.equal(queue.knownStrokes.has(26000),true);assert.equal(queue.knownStrokes.size,26011);assert.equal(queue.nextStroke,50001);assert.equal(queue.freshStrokes.has(C),true);assert.equal(queue.freshStrokes.has(B),true);queue.dispose();
});
