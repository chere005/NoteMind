// Pending immutable edits outlive a mounted Surface, but never an owning page's geometry lease.
const graphics=require('./graphics-pane.js'),bounds=require('./stroke-bounds.js');
const shared=globalThis.NoteMindInkMutations||(()=>{
 const pending=new WeakMap(),active=new Set(),projections=new WeakMap(),projectionSet=new Set();
 const aborted=()=>{const error=Error('Drawing change cancelled.');error.name='AbortError';return error;};
 async function project(strokes,replacements,{signal}={}){if(replacements?.target)return replacements.target;if(replacements?.identity)return strokes;const append=replacements?.append;if(append)replacements=new Map();const next=[],box=bounds.emptyInkBox();for(let i=0;i<strokes.length;i++){if(signal?.aborted)throw aborted();const original=strokes[i],stroke=replacements.has(original)?replacements.get(original):original;if(!stroke)continue;next.push(stroke);bounds.extendInkBox(box,bounds.strokeBox(stroke));if(i%4096===4095)await graphics.yieldTask();}if(append){next.push(append);bounds.extendInkBox(box,bounds.strokeBox(append));}bounds.primeInkBox(next,box);return next;}
 async function appendedTo(strokes,source,signal){if(strokes===source)return true;if(strokes.length<source.length)return false;for(let i=0;i<source.length;i++){if(signal.aborted)throw aborted();if(strokes[i]!==source[i])return false;if(i%4096===4095)await graphics.yieldTask();}return true;}
 function registerInkProjection(page,ready,done){const record={ready,done};let list=projections.get(page);if(!list)projections.set(page,list=[]);list.push(record);projectionSet.add(record);done.finally(()=>{const index=list.indexOf(record);if(index>=0)list.splice(index,1);projectionSet.delete(record);}).catch(()=>{});return record;}
 function beginInkMutation(page,produce,{onCommit=()=>{}}={}){
  if(pending.has(page))throw Error('A drawing change is already finishing.');if(active.size>=2)throw Error('Another large drawing change is finishing.');
  const source=page.strokes,controller=new AbortController(),release=page.retainGeometry?.()||(()=>{}),op={page,source,controller,candidate:null,ready:null,done:null,cancel:()=>controller.abort()};
  pending.set(page,op);active.add(op);
  op.ready=Promise.resolve().then(()=>produce(source,controller.signal));
  op.done=(async()=>{try{const replacements=await op.ready;if(!replacements||typeof replacements.get!=='function'||typeof replacements.size!=='number')throw Error('Invalid drawing change.');for(;;){if(controller.signal.aborted)throw aborted();const before=page.strokes;if(!await appendedTo(before,source,controller.signal))throw aborted();if(!replacements.size)return false;const next=await project(before,replacements,{signal:controller.signal});if(page.strokes!==before)continue;op.candidate=next;const did=await page.replaceAsync(next,{signal:controller.signal,valid:()=>page.strokes===before&&!controller.signal.aborted,yieldControl:graphics.yieldTask});if(did){onCommit(next,before);return true;}op.candidate=null;}}finally{if(pending.get(page)===op)pending.delete(page);active.delete(op);op.candidate=null;release();}})();
  // The owner receives the rejection through done; ready may reject before an export subscribes.
  registerInkProjection(page,op.ready,op.done);op.ready.catch(()=>{});op.done.catch(()=>{});return op;
 }
 function pendingInkMutation(page){return pending.get(page)||null;}
 function flushInkMutations(page){const held=[...(projections.get(page)||[])];return held.length?Promise.all(held.map(record=>record.done)).then(()=>{}):null;}
 async function flushAllInkMutations(){const held=[...projectionSet];await Promise.all(held.map(record=>record.done));}
 function projectInkSnapshot(page,strokes){const held=[...(projections.get(page)||[])];return held.length?(async()=>{for(const record of held)strokes=await project(strokes,await record.ready);return strokes;})():strokes;}
 return {beginInkMutation,pendingInkMutation,flushInkMutations,flushAllInkMutations,projectInkSnapshot,projectInkReplacements:project,registerInkProjection};
})();
globalThis.NoteMindInkMutations=shared;module.exports=shared;
