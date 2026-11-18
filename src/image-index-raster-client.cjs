const path=require('node:path'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const {executeBytes}=require('./document-worker-bytes.cjs'),makeBytes=require('./document-byte-tools.js'),{installImageIndexRasterHost}=require('./image-index-raster-host.js');
const abort=()=>Object.assign(Error('Image conversion cancelled.'),{name:'AbortError'});
const frame=host=>{try{return host.mainFrame?host.mainFrame.processId+':'+host.mainFrame.routingId:null}catch{return null}};
function createHostImageConverter(){let context=null,active=null,closed=false;
 const eligible=host=>host&&typeof host.executeJavaScript==='function'&&typeof host.once==='function'&&!host.isDestroyed?.();
 async function create(host){
  if(context)return context.host===host?context:null;
  const key='__notemindIndexRaster_'+randomUUID().replaceAll('-',''),state={host,key,frame:frame(host),gone:false,installed:false,listeners:[]};let departed;
  state.departed=new Promise(resolve=>departed=resolve);const gone=()=>{if(state.gone)return;state.gone=true;for(const[event,run]of state.listeners)host.removeListener?.(event,run);state.listeners=[];departed();if(context===state)context=null;};
  for(const event of['destroyed','render-process-gone','did-navigate']){host.once(event,gone);state.listeners.push([event,gone]);}
  context=state;
  try{await host.executeJavaScript('('+installImageIndexRasterHost.toString()+')('+JSON.stringify(key)+','+JSON.stringify(pathToFileURL(path.join(__dirname,'image-index-raster-worker.js')).href)+','+makeBytes.toString()+')');if(state.gone||host.isDestroyed?.())throw abort();state.installed=true;return state;}
  catch(error){if(!state.gone){state.failed=error;}throw error;}
 }
 async function convert(host,input,type,{signal,maxDimension=2400,dimensions,timeoutMs=30000}={}){
  if(closed)throw Error('Image conversion is closing.');if(signal?.aborted)throw abort();
  // Unknown/SVG/native-clean images preserve the supervised document converter.
  if(!eligible(host)||!dimensions||type==='image/svg+xml')return null;
  if(active)throw Error('An image conversion is already active.');
  const state=await create(host);if(!state)return null;if(state.failed)throw state.failed;if(!state.installed||state.gone||frame(host)!==state.frame)throw abort();
  const nonce=randomUUID(),scope='window['+JSON.stringify(state.key)+']';let timer,failure;
  const execute=code=>{if(state.gone||host.isDestroyed?.()||frame(host)!==state.frame)return Promise.reject(abort());return Promise.race([host.executeJavaScript(code),state.departed.then(()=>{throw abort()})]);};
  const cancel=()=>{void execute(scope+'.cancel('+JSON.stringify(nonce)+')').catch(()=>{});};
  const job={state,nonce,done:null};active=job;signal?.addEventListener('abort',cancel,{once:true});
  const work=(async()=>{let value;try{
   timer=setTimeout(()=>{failure=Error('Image conversion timed out.');cancel();},timeoutMs);if(signal?.aborted)cancel();
   value=await executeBytes(code=>execute(code.replaceAll('window.NoteMindDocumentBytes',scope+'.bytes').replaceAll('window.documentTools',scope+'.tools('+JSON.stringify(nonce)+')')),'image',[input,type,false,maxDimension,dimensions],{signal});
   if(signal?.aborted)throw abort();if(failure)throw failure;return value;
  }catch(error){const bytes=value?.data;if(ArrayBuffer.isView(bytes)&&!bytes.byteOffset&&bytes.byteLength===bytes.buffer.byteLength)try{bytes.buffer.transfer?.(0)}catch{}if(signal?.aborted)throw abort();if(failure)throw failure;if(error?.code==='IMAGE_WORKER_UNSUPPORTED')return null;throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);try{await Promise.race([execute(scope+'.drain('+JSON.stringify(nonce)+')'),state.departed]);}finally{if(active===job)active=null;}}})();job.done=work;return work;
 }
 async function stats(){const state=context;return{fixedContextOwner:state?{webContentsId:state.host.id,frame:state.frame,gone:state.gone,persistent:true}:null,active:!!active,...state?.installed&&!state.gone?await state.host.executeJavaScript('window['+JSON.stringify(state.key)+'].stats()'):{}};}
 async function dispose(){closed=true;const job=active;if(job){void job.state.host.executeJavaScript('window['+JSON.stringify(job.state.key)+'].cancel('+JSON.stringify(job.nonce)+')').catch(()=>{});await job.done?.catch(()=>{});}return stats();}
 return{convert,stats,dispose};
}
module.exports={createHostImageConverter};
