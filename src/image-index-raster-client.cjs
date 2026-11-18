const path=require('node:path'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const {executeBytes}=require('./document-worker-bytes.cjs'),makeBytes=require('./document-byte-tools.js'),{installImageIndexRasterHost}=require('./image-index-raster-host.js');
const abort=()=>Object.assign(Error('Image conversion cancelled.'),{name:'AbortError'});
const frame=host=>{try{return host.mainFrame?host.mainFrame.processId+':'+host.mainFrame.routingId:null}catch{return null}};
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}},pause=()=>new Promise(resolve=>setTimeout(resolve,100));
function createHostImageConverter({isAlive=alive,wait=pause}={}){let context=null,active=null,closed=false;
 const eligible=host=>host&&typeof host.executeJavaScript==='function'&&typeof host.getOSProcessId==='function'&&typeof host.once==='function'&&!host.isDestroyed?.();
 async function create(host){
  if(context)return context.host===host&&!context.invalid?context:null;
  const pid=host.getOSProcessId();if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Image conversion has no renderer owner.');
  const key='__notemindIndexRaster_'+randomUUID().replaceAll('-',''),state={host,key,pid,frame:frame(host),invalid:false,installed:false,listeners:[],inflight:new Set(),gone:null};
  const gone=()=>{if(state.invalid)return;state.invalid=true;for(const[event,run]of state.listeners)host.removeListener?.(event,run);state.listeners=[];for(const ticket of state.inflight)ticket.reject(abort());state.inflight.clear();
   // Context loss never proves native framework exit. Keep the single fixed
   // tracker; an active variable owner also waits here before releasing quota.
   state.gone=(async()=>{for(;;){let running=true;try{running=isAlive(state.pid)}catch(error){state.stopError ||=error;}if(!running)break;try{await wait()}catch(error){state.stopError ||=error;await pause();}}if(context===state)context=null;})();
  };
  for(const event of['destroyed','render-process-gone','did-navigate']){host.once(event,gone);state.listeners.push([event,gone]);}
  state.execute=code=>{if(state.invalid||host.isDestroyed?.()||frame(host)!==state.frame){gone();return Promise.reject(abort());}return new Promise((resolve,reject)=>{const ticket={reject};state.inflight.add(ticket);Promise.resolve().then(()=>{if(state.invalid||host.isDestroyed?.()||frame(host)!==state.frame){gone();throw abort();}return host.executeJavaScript(code)}).then(value=>{if(state.inflight.delete(ticket))resolve(value)},error=>{if(state.inflight.delete(ticket))reject(error)});});};
  context=state;
  try{await state.execute('('+installImageIndexRasterHost.toString()+')('+JSON.stringify(key)+','+JSON.stringify(pathToFileURL(path.join(__dirname,'image-index-raster-worker.js')).href)+','+makeBytes.toString()+')');if(state.invalid||host.isDestroyed?.())throw abort();state.installed=true;return state;}
  catch(error){if(!state.invalid)state.failed=error;throw error;}
 }
 async function convert(host,input,type,{signal,maxDimension=2400,dimensions,timeoutMs=30000}={}){
  if(closed)throw Error('Image conversion is closing.');if(signal?.aborted)throw abort();
  if(!eligible(host)||!dimensions||type==='image/svg+xml'||input?.byteLength>50*1024*1024)return null;
  if(active)throw Error('An image conversion is already active.');
  const state=await create(host);if(!state)return null;if(state.failed)throw state.failed;if(!state.installed||state.invalid||frame(host)!==state.frame)throw abort();
  const nonce=randomUUID(),scope='window['+JSON.stringify(state.key)+']';let timer,failure;
  const execute=state.execute,cancel=()=>{void execute(scope+'.cancel('+JSON.stringify(nonce)+')').catch(()=>{});};
  const job={state,nonce,done:null};active=job;signal?.addEventListener('abort',cancel,{once:true});
  const work=(async()=>{let value;try{
   timer=setTimeout(()=>{failure=Error('Image conversion timed out.');cancel();},timeoutMs);if(signal?.aborted)cancel();
   value=await executeBytes(code=>execute(code.replaceAll('window.NoteMindDocumentBytes',scope+'.bytes').replaceAll('window.documentTools',scope+'.tools('+JSON.stringify(nonce)+')')),'image',[input,type,false,maxDimension,dimensions],{signal});
   if(signal?.aborted)throw abort();if(failure)throw failure;return value;
  }catch(error){const bytes=value?.data;if(ArrayBuffer.isView(bytes)&&!bytes.byteOffset&&bytes.byteLength===bytes.buffer.byteLength)try{bytes.buffer.transfer?.(0)}catch{}if(signal?.aborted)throw abort();if(failure)throw failure;if(error?.code==='IMAGE_WORKER_UNSUPPORTED')return null;throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);try{if(state.invalid)await state.gone;else try{await execute(scope+'.drain('+JSON.stringify(nonce)+')')}catch(error){if(state.invalid)await state.gone;else throw error;}}finally{if(active===job)active=null;}}})();job.done=work;return work;
 }
 async function stats(){const state=context;return{fixedContextOwner:state?{webContentsId:state.host.id,pid:state.pid,frame:state.frame,invalid:state.invalid,persistent:true}:null,active:!!active,inflightRPCs:state?.inflight.size||0,...state?.installed&&!state.invalid?await state.execute('window['+JSON.stringify(state.key)+'].stats()'):{}};}
 async function dispose(){closed=true;const job=active;if(job){void job.state.execute('window['+JSON.stringify(job.state.key)+'].cancel('+JSON.stringify(job.nonce)+')').catch(()=>{});await job.done?.catch(()=>{});}return stats();}
 return{convert,stats,dispose};
}
module.exports={createHostImageConverter};
