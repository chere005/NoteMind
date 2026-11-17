// Ordered edits retain immutable nodes outside the edited leaves. Every old
// record is checked once; no persisted range summary is trusted as an ID proof.
const {LEAF,FANOUT,MAX_STROKES,MAX_POINTS,descriptor,empty,validRecord,strokeBytes}=require('./sheet-order-index.cjs');
const {isPrivateSheetIds,sheetIdAt,SheetPrivateIdBuilder,releasePrivateSheetIds}=require('./sheet-private-ids.js');
const notOrdered=Symbol('unordered previous drawing');
async function spliceOrdered(index,root,input,added,{onRecord=()=>{},signal,check=()=>{},yieldControl=()=>new Promise(setImmediate)}={}){
 descriptor(root);if(!(Array.isArray(input)||input instanceof Float64Array||isPrivateSheetIds(input))||input.length>MAX_STROKES)throw Error('Invalid drawing stroke identities.');
 const verify=()=>{if(signal?.aborted)throw Object.assign(Error('Drawing edit cancelled.'),{name:'AbortError'});check();};
 let captured,builder,ids=input,position=0,previous=0,count=0,points=0,binaryBytes=0,work=0;
 const started=performance.now(),stats={records:0,reusedLeaves:0,writtenLeaves:0,reusedBranches:0,writtenBranches:0,captureMs:0,publishMs:0,walkMs:0,totalMs:0};
 const publish=async(method,value)=>{const start=performance.now();try{return await index[method](value);}finally{stats.publishMs+=performance.now()-start;}};
 const pause=()=>{verify();if(++work%8192===0)return Promise.resolve().then(yieldControl).then(verify);};
 try{
  // Borrowed generic lists may change while the index yields. Capture their
  // values; the transport's private sequence already has immutable ownership.
  if(!isPrivateSheetIds(input))builder=new SheetPrivateIdBuilder(input.length);
  let prior=0;for(let at=0;at<input.length;at++){verify();const id=sheetIdAt(input,at);if(!Number.isSafeInteger(id)||id<=0)throw Error('Duplicate drawing stroke identity.');if(id<=prior)return null;prior=id;builder?.push(id);const waiting=pause();if(waiting)await waiting;}
  if(builder){captured=builder.finish();builder=null;ids=captured;}
  stats.captureMs=performance.now()-started;
  const consume=(record,validated=false)=>{verify();if(!validated)validRecord(record);if(++count>MAX_STROKES||(points+=record.points)>MAX_POINTS)throw Error('This graphics pane is too large.');binaryBytes+=strokeBytes(record);onRecord(record);return pause();};
  const current=()=>position<ids.length?sheetIdAt(ids,position):Infinity;
  const walk=async(nodeRoot,last,ancestors)=>{
   verify();if(ancestors.has(nodeRoot.ref.sha256))throw Error('Cyclic drawing index.');const path=new Set(ancestors);path.add(nodeRoot.ref.sha256);const node=await index.node(nodeRoot);verify();
   if(node.kind==='leaf'){
    const result=[],pending=[];let changed=false;
    const flush=async()=>{if(pending.length){result.push(await publish('leaf',pending));stats.writtenLeaves++;pending.length=0;verify();}};
    const emit=(record,validated=false)=>{const put=()=>{const waiting=consume(record,validated);pending.push(record);if(changed&&pending.length===LEAF)return waiting?waiting.then(flush):flush();return waiting;};return changed&&pending.length===LEAF?flush().then(put):put();};
    for(const record of node.records){
     verify();validRecord(record);if(record.id<=previous)throw notOrdered;previous=record.id;stats.records++;if(added.has(record.id))throw Error('Duplicate drawing stroke identity.');
     while(current()<record.id){changed=true;const next=added.get(current());if(!next)throw notOrdered;const waiting=emit(next);if(waiting)await waiting;position++;}
     if(current()===record.id){const waiting=emit(record,true);if(waiting)await waiting;position++;}else changed=true;
    }
    if(last)while(position<ids.length){changed=true;const next=added.get(current());if(!next)throw Error('Unknown drawing stroke identity.');const waiting=emit(next);if(waiting)await waiting;position++;}
    if(!changed){stats.reusedLeaves++;return[nodeRoot];}await flush();return result;
   }
   const children=[];let changed=false;
   for(let at=0;at<node.children.length;at++){const child=node.children[at],next=await walk(child,last&&at===node.children.length-1,path);if(next.length!==1||next[0]!==child)changed=true;children.push(...next);}
   if(!changed){stats.reusedBranches++;return[nodeRoot];}
   const result=[];for(let at=0;at<children.length;at+=FANOUT){result.push(await publish('branch',children.slice(at,at+FANOUT)));stats.writtenBranches++;verify();}return result;
  };
  let roots;if(root.count)roots=await walk(root,true,new Set());else{
   const records=[];roots=[];for(;position<ids.length;position++){const record=added.get(current());if(!record)throw Error('Unknown drawing stroke identity.');const waiting=consume(record);if(waiting)await waiting;records.push(record);if(records.length===LEAF){roots.push(await publish('leaf',records));stats.writtenLeaves++;records.length=0;}}
   if(records.length){roots.push(await publish('leaf',records));stats.writtenLeaves++;}
  }
  verify();if(position!==ids.length||count!==ids.length)throw Error('Invalid drawing edit count.');
  while(roots.length>1){const next=[];for(let at=0;at<roots.length;at+=FANOUT){if(roots[at].height>=8)return null;next.push(await publish('branch',roots.slice(at,at+FANOUT)));stats.writtenBranches++;verify();}roots=next;}
  let order=roots[0]||empty();while(order.height>1){const node=await index.node(order);if(node.children.length!==1)break;order=node.children[0];}
  verify();stats.totalMs=performance.now()-started;stats.walkMs=stats.totalMs-stats.captureMs-stats.publishMs;return{order,binaryBytes,stats};
 }catch(error){if(error===notOrdered)return null;throw error;}
 finally{builder?.dispose();releasePrivateSheetIds(captured);}
}
module.exports={spliceOrdered};
