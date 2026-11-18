(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports={create:factory};
 else root.NoteMindPreviewURLs={create:options=>factory({WorkerClass:root.Worker,...options})};
})(typeof window==='undefined'?this:window,function({WorkerClass,workerURL='image-preview-url-worker.js',generationBytes=4*1024*1024,maxHistoricalBytes=32*1024*1024,maxCreates=2,maxWaiters=64,timeoutMs=10000}={}){
 const generations=new Set(),waiters=[];
 let current=null,next=0,serial=0,creating=0,disposed=false,pumping=false;
 const totals={created:0,revoked:0,generationsCreated:0,generationsRetired:0,failed:0,maxGenerations:0,maxChunkBytes:0,maxCreating:0};
 const abortError=()=>Object.assign(Error('Picture source loading cancelled.'),{name:'AbortError'});
 const check=signal=>{if(signal?.aborted)throw abortError();if(disposed)throw Error('Picture sources are closing.');};
 const discard=bytes=>{if(bytes?.byteLength&&bytes.buffer instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0)};
 const historicalBytes=()=>[...generations].reduce((sum,g)=>sum+g.bytes,0);
 for(const value of [generationBytes,maxHistoricalBytes,maxCreates,maxWaiters,timeoutMs])if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid picture owner limits.');
 function retire(g,error){
  if(g.closed)return;g.closed=true;if(current===g)current=null;
  for(const request of [...g.pending.values()])request.fail(error||Error('Picture owner retired.'));
  for(const value of g.urls.values()){value.lost=true;try{value.onLost?.();}catch{}}
  g.urls.clear();
  // Browser Worker.terminate has no actual-exit receipt. RSS supervision, rather
  // than a fabricated Node exit barrier, covers the retiring-context overlap.
  try{g.worker.terminate();generations.delete(g);totals.generationsRetired++;}
  catch(failure){g.quarantined=true;g.failure=failure;}
  pump();
 }
 function idle(g){if(!g.closed&&!g.pending.size&&!g.creates&&!g.cleanups&&!g.urls.size&&(g.sealed||disposed||historicalBytes()>maxHistoricalBytes))retire(g);}
 function seal(g){if(!g)return;g.sealed=true;if(current===g)current=null;idle(g);}
 function makeGeneration(){
  const worker=new WorkerClass(workerURL),g={worker,id:++serial,bytes:0,creates:0,cleanups:0,sealed:false,closed:false,pending:new Map(),urls:new Map()};
  generations.add(g);current=g;totals.generationsCreated++;totals.maxGenerations=Math.max(totals.maxGenerations,generations.size);
  worker.onmessage=event=>{const answer=event.data,request=g.pending.get(answer?.id);if(!request)return;answer.error?request.fail(Error(answer.error)):request.succeed(answer);};
  worker.onerror=()=>{totals.failed++;retire(g,Error('Picture source worker stopped.'));};worker.onmessageerror=worker.onerror;
  return g;
 }
 function request(g,packet,transfers=[],signal){
  const id=++next;let succeed,fail;
  const promise=new Promise((resolve,reject)=>{succeed=resolve;fail=reject});promise.requestId=id;
  if(g.closed){fail(Error('Picture owner retired.'));return promise;}
  let settled=false,timer;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);g.pending.delete(id);};
  const finish=(fn,value)=>{if(settled)return;settled=true;cleanup();fn(value);};
  const aborted=()=>finish(fail,abortError());
  g.pending.set(id,{succeed:value=>finish(succeed,value),fail:error=>finish(fail,error)});
  signal?.addEventListener('abort',aborted,{once:true});
  if(signal?.aborted){aborted();return promise;}
  timer=setTimeout(()=>{totals.failed++;retire(g,Error('Picture source worker timed out.'));},timeoutMs);
  try{g.worker.postMessage({...packet,id},transfers);}catch(error){finish(fail,error);}
  return promise;
 }
 function pruneFor(bytes){for(const g of [...generations])if(!g.closed&&!g.creates&&!g.cleanups&&!g.pending.size&&!g.urls.size&&(g.sealed||historicalBytes()+bytes>maxHistoricalBytes))seal(g);}
 function canAdmit(bytes){const used=historicalBytes();return creating<maxCreates&&(used+bytes<=maxHistoricalBytes||bytes>maxHistoricalBytes&&used===0&&creating===0);}
 function reserve(bytes){
  let g=current;if(!g||g.closed||g.sealed||g.bytes+bytes>generationBytes){seal(g);g=makeGeneration();}
  g.bytes+=bytes;g.creates++;creating++;totals.maxCreating=Math.max(totals.maxCreating,creating);if(g.bytes>=generationBytes)g.sealed=true;
  return g;
 }
 function pump(){
  if(pumping)return;pumping=true;
  try{while(waiters.length){const waiter=waiters[0];pruneFor(waiter.bytes);if(!canAdmit(waiter.bytes))break;waiters.shift();waiter.cleanup();try{check(waiter.signal);waiter.resolve(reserve(waiter.bytes));}catch(error){waiter.reject(error);}}}
  finally{pumping=false;}
 }
 function admit(bytes,signal){
  check(signal);pruneFor(bytes);
  if(!waiters.length&&canAdmit(bytes))return Promise.resolve(reserve(bytes));
  if(waiters.length>=maxWaiters)return Promise.reject(Error('Too many picture sources are waiting.'));
  return new Promise((resolve,reject)=>{
   let timer;const waiter={bytes,signal,resolve,reject,cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',abort)}};
   const remove=error=>{const at=waiters.indexOf(waiter);if(at<0)return;waiters.splice(at,1);waiter.cleanup();reject(error);pump();};
   const abort=()=>remove(abortError());signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>remove(Error('Picture source capacity is busy.')),timeoutMs);waiters.push(waiter);if(signal?.aborted)abort();
  });
 }
 function cancelUnpublished(g,job){
  if(!job||g.closed)return;g.cleanups++;
  // Keep partial Blob ownership charged until a cancellation receipt arrives.
  // Caller cancellation stays prompt and never retires another active lease.
  const cleanup=request(g,{op:'cancel',job}).then(answer=>{if(answer.ok!==true)throw Error('Picture source cancellation was not confirmed.');},error=>{throw error;}).catch(error=>{totals.failed++;retire(g,error);}).finally(()=>{g.cleanups--;idle(g);pump();});
  cleanup.catch(()=>{});
 }
 async function create(chunks,{bytes,type,signal,ownedChunks=false,onLost}={}){
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>199*1024*1024)throw Error('Invalid picture source length.');
  const g=await admit(bytes,signal);let job,complete=false,offset=0;
  try{
   check(signal);const begin=request(g,{op:'begin',bytes,type},[],signal);job=begin.requestId;await begin;
   for await(const borrowed of chunks){
    let data=ownedChunks?borrowed:null;
    try{check(signal);if(!(borrowed instanceof Uint8Array)||!(borrowed.buffer instanceof ArrayBuffer)||borrowed.byteLength>196608||!borrowed.byteLength)throw Error('Invalid picture byte chunk.');data ||= Uint8Array.from(borrowed);if(data.byteOffset!==0||data.byteLength!==data.buffer.byteLength)throw Error('Picture chunks must own their backing.');
     const length=data.byteLength,answer=await request(g,{op:'chunk',job,offset,data},[data.buffer],signal);totals.maxChunkBytes=Math.max(totals.maxChunkBytes,length);if(answer.received!==offset+length)throw Error('Picture source transfer was interrupted.');offset+=length;
    }finally{discard(data);}
   }
   check(signal);if(offset!==bytes)throw Error('Incomplete picture source.');
   const result=await request(g,{op:'finish',job},[],signal);check(signal);
   if(typeof result.url!=='string'||!result.url.startsWith('blob:')||result.bytes!==bytes){retire(g,Error('Invalid picture URL receipt.'));throw Error('Invalid picture URL receipt.');}
   const value={url:result.url,bytes,generation:g.id,lost:false,onLost};g.urls.set(value.url,value);totals.created++;complete=true;let released=false,releasing;
   return{url:value.url,bytes,generation:g.id,get alive(){return!g.closed&&!value.lost&&!released;},release(){
    if(releasing)return releasing;released=true;totals.revoked++;
    releasing=g.closed?Promise.resolve():request(g,{op:'release',url:value.url}).then(answer=>{if(answer.ok!==true)throw Error('Picture URL release was not confirmed.');g.urls.delete(value.url);idle(g);pump();}).catch(error=>{totals.failed++;retire(g,error);throw error;});
    releasing.catch(()=>{});return releasing;
   }};
  }finally{g.creates--;creating--;if(!complete)cancelUnpublished(g,job);idle(g);pump();}
 }
 function trim(){for(const g of [...generations])if(!g.urls.size&&!g.creates&&!g.cleanups&&!g.pending.size)seal(g);pump();}
 function dispose(){disposed=true;for(const waiter of waiters.splice(0)){waiter.cleanup();waiter.reject(Error('Picture sources are closing.'));}for(const g of [...generations])seal(g);}
 return{create,trim,dispose,stats:()=>({...totals,generations:generations.size,historicalBytes:historicalBytes(),liveURLs:[...generations].reduce((sum,g)=>sum+g.urls.size,0),pending:creating,waiting:waiters.length,cleanupPending:[...generations].reduce((sum,g)=>sum+g.cleanups,0),quarantined:[...generations].filter(g=>g.quarantined).length})};
});
