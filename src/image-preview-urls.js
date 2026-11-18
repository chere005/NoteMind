(function(root,factory){if(typeof module==='object'&&module.exports)module.exports={create:factory};else root.NoteMindPreviewURLs={create:options=>factory({WorkerClass:root.Worker,...options})};})(typeof window==='undefined'?this:window,function({WorkerClass,workerURL='image-preview-url-worker.js',generationBytes=4*1024*1024,maxHistoricalBytes=32*1024*1024,timeoutMs=10000}={}){
 const generations=new Set();let current=null,next=0,serial=0,disposed=false;
 const totals={created:0,revoked:0,generationsCreated:0,generationsRetired:0,failed:0,maxGenerations:0,maxChunkBytes:0};
 const abortError=()=>Object.assign(Error('Picture source loading cancelled.'),{name:'AbortError'}),check=signal=>{if(signal?.aborted)throw abortError();if(disposed)throw Error('Picture sources are closing.');};
 const discard=bytes=>{if(bytes?.byteLength&&bytes.buffer instanceof ArrayBuffer&&bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&typeof bytes.buffer.transfer==='function')bytes.buffer.transfer(0)};
 const historicalBytes=()=>[...generations].reduce((sum,g)=>sum+g.bytes,0);
 function retire(g,error){if(g.closed)return;g.closed=true;generations.delete(g);if(current===g)current=null;for(const request of g.pending.values()){clearTimeout(request.timer);request.reject(error||Error('Picture owner retired.'));}g.pending.clear();for(const value of g.urls.values()){value.lost=true;try{value.onLost?.();}catch{}}g.urls.clear();try{g.worker.terminate();}finally{totals.generationsRetired++;}}
 function idle(g){if(g.closed||g.pending.size||g.creates||g.urls.size)return;if(g.sealed||disposed||historicalBytes()>maxHistoricalBytes)retire(g);}
 function seal(g){if(!g)return;g.sealed=true;if(current===g)current=null;idle(g);}
 function makeGeneration(){const worker=new WorkerClass(workerURL),g={worker,id:++serial,bytes:0,creates:0,sealed:false,closed:false,pending:new Map(),urls:new Map()};generations.add(g);current=g;totals.generationsCreated++;totals.maxGenerations=Math.max(totals.maxGenerations,generations.size);
  worker.onmessage=event=>{const answer=event.data,request=g.pending.get(answer?.id);if(!request)return;g.pending.delete(answer.id);clearTimeout(request.timer);answer.error?request.reject(Error(answer.error)):request.resolve(answer);};
  worker.onerror=()=>{totals.failed++;retire(g,Error('Picture source worker stopped.'));};worker.onmessageerror=worker.onerror;return g;
 }
 function request(g,packet,transfers=[]){if(g.closed)return Promise.reject(Error('Picture owner retired.'));const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{totals.failed++;retire(g,Error('Picture source worker timed out.'));},timeoutMs);g.pending.set(id,{resolve,reject,timer});try{g.worker.postMessage({...packet,id},transfers);}catch(error){g.pending.delete(id);clearTimeout(timer);reject(error);}});}
 async function create(chunks,{bytes,type,signal,ownedChunks=false,onLost}={}){
  check(signal);if(!Number.isSafeInteger(bytes)||bytes<0||bytes>199*1024*1024)throw Error('Invalid picture source length.');
  let g=current;if(!g||g.closed||g.sealed||g.bytes+bytes>generationBytes){seal(g);g=makeGeneration();}g.bytes+=bytes;g.creates++;if(g.bytes>=generationBytes)g.sealed=true;
  let job,complete=false,offset=0;
  try{job=(await request(g,{op:'begin',bytes,type})).id;
   for await(const borrowed of chunks){let data=ownedChunks?borrowed:null;try{check(signal);if(!(borrowed instanceof Uint8Array)||!(borrowed.buffer instanceof ArrayBuffer)||borrowed.byteLength>196608||!borrowed.byteLength)throw Error('Invalid picture byte chunk.');data ||= Uint8Array.from(borrowed);if(data.byteOffset!==0||data.byteLength!==data.buffer.byteLength)throw Error('Picture chunks must own their backing.');const length=data.byteLength,answer=await request(g,{op:'chunk',job,offset,data},[data.buffer]);totals.maxChunkBytes=Math.max(totals.maxChunkBytes,length);if(answer.received!==offset+length)throw Error('Picture source transfer was interrupted.');offset+=length;}finally{discard(data);}}
   check(signal);if(offset!==bytes)throw Error('Incomplete picture source.');const result=await request(g,{op:'finish',job});if(typeof result.url!=='string'||!result.url.startsWith('blob:')||result.bytes!==bytes)throw Error('Invalid picture URL receipt.');
   if(signal?.aborted){await request(g,{op:'release',url:result.url});throw abortError();}
   const value={url:result.url,bytes,generation:g.id,lost:false,onLost};g.urls.set(value.url,value);totals.created++;complete=true;let released=false;
   return{url:value.url,bytes,generation:g.id,get alive(){return!g.closed&&!value.lost&&!released;},release(){if(released)return;released=true;totals.revoked++;g.urls.delete(value.url);if(!g.closed){void request(g,{op:'release',url:value.url}).catch(()=>{}).finally(()=>idle(g));}idle(g);}};
  }finally{g.creates--;if(!complete&&job&&!g.closed)await request(g,{op:'cancel',job}).catch(()=>{});idle(g);}
 }
 function trim(){for(const g of [...generations])if(!g.urls.size&&!g.creates&&!g.pending.size)seal(g);}
 function dispose(){disposed=true;for(const g of [...generations])if(!g.urls.size&&!g.creates)retire(g);else seal(g);}
 return{create,trim,dispose,stats:()=>({...totals,generations:generations.size,historicalBytes:historicalBytes(),liveURLs:[...generations].reduce((sum,g)=>sum+g.urls.size,0),pending:[...generations].reduce((sum,g)=>sum+g.creates,0)})};
});
