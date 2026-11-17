// Pending immutable edits outlive a mounted Surface, but never an owning page's geometry lease.
const graphics=require('./graphics-pane.js'),bounds=require('./stroke-bounds.js'),signatures=require('./stroke-signature.js');
const shared=globalThis.NoteMindInkMutations||(()=>{
 const pending=new WeakMap(),active=new Set(),projections=new WeakMap(),projectionSet=new Set(),listeners=new Set();
 const changed=owner=>{for(const listener of listeners){try{listener(owner)}catch{}}};
 const aborted=()=>{const error=Error('Drawing change cancelled.');error.name='AbortError';return error;};
 async function project(strokes,replacements,{signal}={}){if(replacements?.eraseOccurrences){const counts=new Map(),next=[],box=bounds.emptyInkBox();let work=0;for(const stroke of replacements.eraseOccurrences){counts.set(stroke,(counts.get(stroke)||0)+1);if(++work%4096===0)await graphics.yieldTask();}for(let i=strokes.length-1;i>=0;i--){if(signal?.aborted)throw aborted();const stroke=strokes[i],count=counts.get(stroke)||0;if(count)counts.set(stroke,count-1);else{next.push(stroke);bounds.extendInkBox(box,bounds.strokeBox(stroke));}if(++work%4096===0)await graphics.yieldTask();}for(let i=0,j=next.length-1;i<j;i++,j--){const item=next[i];next[i]=next[j];next[j]=item;if(++work%4096===0)await graphics.yieldTask();}bounds.primeInkBox(next,box);return next;}if(replacements?.target)return replacements.target;if(replacements?.identity)return strokes;const append=replacements?.append;if(append)replacements=new Map();const next=[],box=bounds.emptyInkBox();for(let i=0;i<strokes.length;i++){if(signal?.aborted)throw aborted();const original=strokes[i],stroke=replacements.has(original)?replacements.get(original):original;if(!stroke)continue;next.push(stroke);bounds.extendInkBox(box,bounds.strokeBox(stroke));if(i%4096===4095)await graphics.yieldTask();}if(append){next.push(append);bounds.extendInkBox(box,bounds.strokeBox(append));}bounds.primeInkBox(next,box);return next;}
 async function appendedTo(strokes,source,signal){if(strokes===source)return true;if(strokes.length<source.length)return false;for(let i=0;i<source.length;i++){if(signal.aborted)throw aborted();if(strokes[i]!==source[i])return false;if(i%4096===4095)await graphics.yieldTask();}return true;}
 function registerInkProjection(page,ready,done,{capture}={}){const record={ready,done,capture};let list=projections.get(page);if(!list)projections.set(page,list=[]);list.push(record);projectionSet.add(record);changed(page);done.finally(()=>{const index=list.indexOf(record);if(index>=0)list.splice(index,1);projectionSet.delete(record);changed(page);}).catch(()=>{});return record;}
 function beginInkMutation(page,produce,{onCommit=()=>{}}={}){
  if(pending.has(page))throw Error('A drawing change is already finishing.');if(active.size>=2)throw Error('Another large drawing change is finishing.');
  const source=page.strokes,controller=new AbortController(),release=page.retainGeometry?.()||(()=>{}),op={page,source,controller,candidate:null,ready:null,done:null,cancel:()=>controller.abort()};
  pending.set(page,op);active.add(op);
  op.ready=Promise.resolve().then(()=>produce(source,controller.signal));
  op.done=(async()=>{try{const replacements=await op.ready;if(!replacements||typeof replacements.get!=='function'||typeof replacements.size!=='number')throw Error('Invalid drawing change.');for(;;){if(controller.signal.aborted)throw aborted();const before=page.strokes;if(!await appendedTo(before,source,controller.signal))throw aborted();if(!replacements.size)return false;const next=await project(before,replacements,{signal:controller.signal});if(page.strokes!==before)continue;op.candidate=next;const did=await page.replaceAsync(next,{signal:controller.signal,valid:()=>page.strokes===before&&!controller.signal.aborted,yieldControl:graphics.yieldTask});if(did){onCommit(next,before);return true;}op.candidate=null;}}finally{if(pending.get(page)===op)pending.delete(page);active.delete(op);op.candidate=null;release();}})();
  // The owner receives the rejection through done; ready may reject before an export subscribes.
  registerInkProjection(page,op.ready,op.done);op.ready.catch(()=>{});op.done.catch(()=>{});return op;
 }
 function appendInkStroke(owner,stroke,{nativeCanonical=false,commit=value=>owner.add(value),retain=()=>owner.retainGeometry?.()||(()=>{}),onCommit=()=>{},finalize,before}={}){
  const prior=before===undefined?flushInkMutations(owner):before,release=retain();let hash,geometry=null
  try{
   hash=signatures.knownStrokeFingerprint(stroke)
   if(!hash){
    if(nativeCanonical){const keys=Object.keys(stroke).join(','),expected=stroke.pressures?'colorHex,width,points,pressures':'colorHex,width,points';if(keys!==expected||(stroke.points.length&&Object.keys(stroke.points[0]).join(',')!=='x,y'))throw Error('Native ink must use canonical stroke and point field ordering.')}
    if(nativeCanonical&&stroke.points.length>=50000){const run=finalize||globalThis.NoteMindDrawingExport?.fingerprintStroke||((value)=>signatures.canonicalStrokeFingerprintAsync(value,graphics.yieldTask));hash=run(stroke)}else hash=signatures.strokeFingerprint(stroke)
   }
   geometry=!bounds.knownStrokeBox(stroke)&&stroke.points.length>=50000?bounds.strokeBoxAsync(stroke,{yieldControl:graphics.yieldTask}):null
   if(typeof hash==='string'&&!prior&&!geometry){commit(stroke);onCommit(stroke);release();return null}
  }catch(error){release();throw error}
  const ready=Promise.all([Promise.resolve(hash).then(value=>{signatures.primeStrokeFingerprint(stroke,value)}),prior?.catch?.(()=>{}),geometry]).then(()=>({append:stroke})),done=ready.then(()=>{commit(stroke);onCommit(stroke)}).finally(release)
  ready.catch(()=>{});done.catch(()=>{});registerInkProjection(owner,ready,done);return done
 }
 function createInkActionController(owner,adapters={}){
  let handlers={onEdited:adapters.onEdited,repaint:adapters.repaint,onError:adapters.onError};const jobs=new Set(),get=adapters.getStrokes||(()=>owner.strokes),retain=adapters.retain||(()=>owner.retainGeometry?.()||(()=>{})),changed=()=>{handlers?.repaint?.();handlers?.onEdited?.()}
  function enqueue(prepare,{capture=true}={}){
   const prior=flushInkMutations(owner),captured=capture?projectInkSnapshot(owner,get()):null,release=retain(),controller=new AbortController();captured?.catch?.(()=>{});jobs.add(controller);let projection={identity:true}
   const done=Promise.resolve().then(async()=>{await prior?.catch?.(()=>{});if(controller.signal.aborted)throw aborted();const source=get(),plan=await prepare(captured?await captured:source,source,{signal:controller.signal,yieldControl:graphics.yieldTask});if(!plan)return false;if(controller.signal.aborted)throw aborted();const result=await plan.commit({signal:controller.signal,yieldControl:graphics.yieldTask,valid:()=>!controller.signal.aborted&&get()===source});if(result===false)throw aborted();projection=plan.projection||(Array.isArray(plan.target)?{target:plan.target}:{identity:true});changed();return true}).finally(()=>{jobs.delete(controller);release()})
   const ready=done.then(()=>projection);ready.catch(()=>{});done.catch(error=>{try{handlers?.onError?.(error)}catch{}});registerInkProjection(owner,ready,done);return done
  }
  function history(which){return enqueue((_captured,source)=>{const target=which==='clear'?[]:(adapters.peekUndo?adapters.peekUndo(which==='redo'):owner.peekUndo(which==='redo'));if(!target||which==='clear'&&!source.length)return null;return {target,commit:options=>which==='clear'?(adapters.replace?adapters.replace(target,options):owner.replaceAsync(target,options)):which==='undo'?(adapters.undo?adapters.undo(options):owner.undoAsync(options)):(adapters.redo?adapters.redo(options):owner.redoAsync(options))}},{capture:false})}
  return {enqueue,undo:()=>history('undo'),redo:()=>history('redo'),clear:()=>history('clear'),append:(stroke,options={})=>appendInkStroke(owner,stroke,{...options,retain,commit:options.commit||adapters.append||((value)=>owner.add(value)),onCommit:()=>{options.onCommit?.(stroke);changed()}}),flush:()=>flushInkMutations(owner)||Promise.resolve(),pending:()=>!!projections.get(owner)?.length,cancel:()=>{for(const job of jobs)job.abort()},attach:next=>{handlers={...handlers,...next}},detach:()=>{handlers=null}}
 }
 function pendingInkMutation(page){return pending.get(page)||null;}
 function flushInkMutations(page){const held=[...(projections.get(page)||[])];return held.length?Promise.all(held.map(record=>record.done)).then(()=>{}):null;}
 async function flushAllInkMutations(){const held=[...projectionSet];await Promise.all(held.map(record=>record.done));}
 function projectInkSnapshot(page,strokes){const held=(projections.get(page)||[]).map(record=>{const ready=record.capture?record.capture():record.ready;ready?.catch?.(()=>{});return {ready};});return held.length?(async()=>{for(const record of held)strokes=await project(strokes,await record.ready);return strokes;})():strokes;}
 return {beginInkMutation,pendingInkMutation,flushInkMutations,flushAllInkMutations,projectInkSnapshot,projectInkReplacements:project,registerInkProjection,appendInkStroke,createInkActionController,hasPendingInkMutations:owner=>!!projections.get(owner)?.length,subscribeInkMutations:listener=>{listeners.add(listener);return()=>listeners.delete(listener)}};
})();
globalThis.NoteMindInkMutations=shared;module.exports=shared;
