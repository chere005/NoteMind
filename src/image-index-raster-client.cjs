const {types}=require('node:util');
const path=require('node:path'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const {executeBytes,retireBinaryReceiver,isBinaryReceiver}=require('./document-worker-bytes.cjs'),makeBytes=require('./document-byte-tools.js'),{installImageIndexRasterHost}=require('./image-index-raster-host.js');
const {createInputSender,createInputReceiver}=require('./image-index-input-data.cjs');
const abort=()=>Object.assign(Error('Image conversion cancelled.'),{name:'AbortError'});
const frame=host=>{try{return host.mainFrame?host.mainFrame.processId+':'+host.mainFrame.routingId:null}catch{return null}};
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}},pause=()=>new Promise(resolve=>setTimeout(resolve,100));
function createHostImageConverter({isAlive=alive,wait=pause}={}){let context=null,active=null,admission=null,closed=false;
 const eligible=host=>host&&typeof host.executeJavaScript==='function'&&typeof host.getOSProcessId==='function'&&typeof host.once==='function'&&!host.isDestroyed?.();
 async function create(host){
  if(context)return context.host===host&&!context.invalid?context:null;
  const pid=host.getOSProcessId();if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Image conversion has no renderer owner.');
  const key='__notemindIndexRaster_'+randomUUID().replaceAll('-',''),state={host,key,pid,frame:frame(host),invalid:false,installed:false,listeners:[],inflight:new Set(),binaryReads:new Set(),lateBinaryReleases:0,unknownMainReceivers:new Set(),gone:null};
  const gone=()=>{if(state.invalid)return;state.invalid=true;state.inputData?.stop();for(const[event,run]of state.listeners)host.removeListener?.(event,run);state.listeners=[];for(const ticket of state.inflight)ticket.reject(abort());state.inflight.clear();
   // Context loss never proves native framework exit. Keep the single fixed
   // tracker; an active variable owner also waits here before releasing quota.
   state.gone=(async()=>{for(;;){let running=true;try{running=isAlive(state.pid)}catch(error){state.stopError ||=error;}if(!running)break;try{await wait()}catch(error){state.stopError ||=error;await pause();}}while(state.binaryReads.size)await Promise.allSettled([...state.binaryReads]);await state.inputData?.afterExit();if(context===state)context=null;})();
  };
  for(const event of['destroyed','render-process-gone','did-navigate']){host.once(event,gone);state.listeners.push([event,gone]);}
  state.invalidate=gone;
  state.execute=code=>{
   if(state.invalid||host.isDestroyed?.()||frame(host)!==state.frame){gone();return Promise.reject(abort());}
   const binary=code.includes('.bytes["readBinary"]');
   return new Promise((resolve,reject)=>{
    const ticket={reject};state.inflight.add(ticket);
    const settled=Promise.resolve().then(()=>{if(state.invalid||host.isDestroyed?.()||frame(host)!==state.frame){gone();throw abort();}return host.executeJavaScript(code)}).then(async value=>{
     // This private WebContents method returns structured-cloned Main values,
     // never caller-borrowed views. Even a malformed view owns its whole clone.
     if(binary&&(ArrayBuffer.isView(value?.data)||types.isArrayBuffer(value?.data)||types.isSharedArrayBuffer(value?.data))){
      const backing=ArrayBuffer.isView(value.data)?value.data.buffer:value.data;
      if(types.isArrayBuffer(backing)&&!isBinaryReceiver(value.data)){
       if(backing.byteLength)await retireBinaryReceiver(new Uint8Array(backing));
       const error=Object.assign(Error('Invalid private image output clone.'),{code:'DOCUMENT_BYTES_RELEASE_UNCONFIRMED',resourcesReleased:false});
       if(state.inflight.delete(ticket))reject(error);else state.lateBinaryReleases++;return;
      }
      if(types.isSharedArrayBuffer(backing)){
       state.unknownMainReceivers.add(value.data);
       if(state.inflight.delete(ticket))reject(Object.assign(Error('An unexpected shared Main receiver remains quarantined.'),{code:'DOCUMENT_BYTES_MAIN_QUARANTINED',resourcesReleased:false}));
       // Renderer exit cannot end an unretirable Main-side shared owner.
       await new Promise(()=>{});return;
      }
     }
     if(state.inflight.delete(ticket))resolve(value);
     else if(binary&&isBinaryReceiver(value?.data)){await retireBinaryReceiver(value.data);state.lateBinaryReleases++;}
    },error=>{if(state.inflight.delete(ticket))reject(error)});
    if(binary){state.binaryReads.add(settled);settled.finally(()=>state.binaryReads.delete(settled)).catch(error=>{state.stopError ||=error;});}
   });
  };
  context=state;
  try{await state.execute('('+installImageIndexRasterHost.toString()+')('+JSON.stringify(key)+','+JSON.stringify(pathToFileURL(path.join(__dirname,'image-index-raster-worker.js')).href)+','+makeBytes.toString()+','+(typeof host.postMessage==='function'?createInputReceiver.toString():'undefined')+')');if(state.invalid||host.isDestroyed?.())throw abort();state.installed=true;if(typeof host.postMessage==='function'&&await state.execute('Boolean(window.notemind?.indexInputDataPort)').catch(()=>false)){const {MessageChannelMain}=require('electron'),channel=new MessageChannelMain();state.inputData=createInputSender(channel.port1,{key:state.key,valid:()=>!state.invalid&&!host.isDestroyed?.()&&frame(host)===state.frame,onBroken:()=>state.invalidate()});host.postMessage('notemind-index-input-port',{key:state.key},[channel.port2]);}return state;}
  catch(error){if(!state.invalid)state.failed=error;throw error;}
 }
 async function convertOwned(host,input,type,{signal,maxDimension=2400,dimensions,timeoutMs=30000}={},pixels=false){
  if(closed)throw Error('Image conversion is closing.');if(signal?.aborted)throw abort();
  if(!eligible(host)||!dimensions||type==='image/svg+xml'||input?.byteLength>50*1024*1024)return null;
  if(active)throw Error('An image conversion is already active.');
  const state=await create(host);if(signal?.aborted||closed)throw abort();if(!state)return null;if(state.failed)throw state.failed;if(!state.installed||state.invalid||frame(host)!==state.frame)throw abort();
  const outerSignal=signal,controller=new AbortController(),forward=()=>controller.abort();outerSignal?.addEventListener('abort',forward,{once:true});if(outerSignal?.aborted)forward();signal=controller.signal;
  const nonce=randomUUID(),scope='window['+JSON.stringify(state.key)+']';let timer,failure,unconfirmed=false;
  const execute=state.execute,cancel=()=>{void execute(scope+'.cancel('+JSON.stringify(nonce)+')').catch(()=>{});};
  const job={state,nonce,controller,done:null};active=job;signal?.addEventListener('abort',cancel,{once:true});
  const work=(async()=>{let value;try{
   timer=setTimeout(()=>{failure=Error('Image conversion timed out.');cancel();},timeoutMs);if(signal?.aborted)cancel();
   value=await executeBytes(code=>execute(code.replaceAll('window.NoteMindDocumentBytes',scope+'.bytes').replaceAll('window.documentTools',scope+'.tools('+JSON.stringify(nonce)+')')),pixels?'imagePixels':'image',[input,type,false,maxDimension,dimensions],{signal,binaryOutput:true,inputTransport:state.inputData});
   if(signal?.aborted||state.invalid)throw abort();if(failure)throw failure;return value;
  }catch(error){unconfirmed=error?.resourcesReleased===false;const bytes=value?.data;if(ArrayBuffer.isView(bytes)&&!bytes.byteOffset&&bytes.byteLength===bytes.buffer.byteLength)try{bytes.buffer.transfer?.(0)}catch{}if(signal?.aborted||state.invalid)throw abort();if(failure)throw failure;if(error?.code==='IMAGE_WORKER_UNSUPPORTED')return null;throw error;}finally{clearTimeout(timer);outerSignal?.removeEventListener('abort',forward);signal.removeEventListener('abort',cancel);try{if(unconfirmed&&!state.invalid)state.invalidate();if(state.invalid)await state.gone;else try{await execute(scope+'.drain('+JSON.stringify(nonce)+')')}catch(error){if(state.invalid)await state.gone;else throw error;}}finally{if(active===job)active=null;}}})();job.done=work;return work;
 }
 function convertMode(pixels,host,input,type,options){if(closed)return Promise.reject(Error('Image conversion is closing.'));if(admission)return Promise.reject(Error('An image conversion is already active.'));const request={done:null};admission=request;request.done=convertOwned(host,input,type,options,pixels).finally(()=>{if(admission===request)admission=null;});return request.done;}
 async function stats(){const state=context;return{fixedContextOwner:state?{webContentsId:state.host.id,pid:state.pid,frame:state.frame,invalid:state.invalid,persistent:true}:null,active:!!admission,inflightRPCs:state?.inflight.size||0,pendingBinaryRPCs:state?.binaryReads.size||0,quarantinedMainReceivers:state?.unknownMainReceivers.size||0,lateBinaryReleases:state?.lateBinaryReleases||0,...state?.installed&&!state.invalid?await state.execute('window['+JSON.stringify(state.key)+'].stats()'):{}};}
 async function dispose(){closed=true;const request=admission;active?.controller.abort();await request?.done?.catch(()=>{});return stats();}
 return{convert:(...args)=>convertMode(false,...args),convertPixels:(...args)=>convertMode(true,...args),stats,dispose};
}
module.exports={createHostImageConverter};
