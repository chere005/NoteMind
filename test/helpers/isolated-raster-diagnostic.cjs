// Optional test-only process boundary around the unchanged raster host/kernel.
const path=require('node:path'),{randomUUID}=require('node:crypto');
function createIsolatedRasterDiagnostic({sourceRoot,createClient,BrowserWindow,stopConverter,uuid=randomUUID}){
 let closed=false,active=null;const rows=[];
 const empty=()=>({fixedContextOwner:null,active:false,inflightRPCs:0,pendingBinaryRPCs:0,quarantinedMainReceivers:0,lateBinaryReleases:0,persistentContexts:0,sessions:0,bytes:0});
 function convert(pixels,_originalHost,input,type,options={}){
  if(closed)return Promise.reject(Error('Isolated raster diagnostic is closing.'));if(active)return Promise.reject(Error('Isolated raster conversion is already active.'));
  const controller=new AbortController(),forward=()=>controller.abort(),row={id:rows.length+1,type,pixels,maxDimension:options.maxDimension,dimensions:options.dimensions?{...options.dimensions}:null,actualExit:false},record={row,controller,done:null};rows.push(row);active=record;options.signal?.addEventListener('abort',forward,{once:true});if(options.signal?.aborted)forward();
  record.done=(async()=>{let window,client,value,success=false;try{
   if(controller.signal.aborted)throw Object.assign(Error('Image conversion cancelled.'),{name:'AbortError'});
   window=new BrowserWindow({show:false,focusable:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'notemind-isolated-raster-'+uuid()}});record.window=window;window.webContents.setBackgroundThrottling(false);await window.loadFile(path.join(sourceRoot,'image-conversion-worker.html'));row.pid=window.webContents.getOSProcessId();if(!Number.isSafeInteger(row.pid)||row.pid<=0)throw Error('Isolated raster renderer has no captured process owner.');
   client=createClient();value=await client[pixels?'convertPixels':'convert'](window.webContents,input,type,{...options,signal:controller.signal});if(value){row.width=value.width;row.height=value.height;row.bytes=value.data?.byteLength;}
   const settled=await client.dispose();if(settled.active||settled.inflightRPCs||settled.pendingBinaryRPCs||settled.quarantinedMainReceivers||settled.bytes||settled.sessions)throw Error('Isolated raster client still owns conversion resources.');
   await stopConverter(window,{pid:row.pid});row.actualExit=true;row.exitBeforeReturn=true;window=null;if(controller.signal.aborted)throw Object.assign(Error('Image conversion cancelled.'),{name:'AbortError'});success=true;return value;
  }finally{
   options.signal?.removeEventListener('abort',forward);let cleanupError;try{try{await client?.dispose();}catch(error){cleanupError=error;}if(window)try{row.pid ||=window.webContents.getOSProcessId();await stopConverter(window,{pid:row.pid});row.actualExit=Number.isSafeInteger(row.pid)&&row.pid>0;}catch(error){cleanupError ||=error;}if(cleanupError){row.cleanupError=cleanupError.message;throw cleanupError;}}finally{if(!success&&value?.data?.buffer instanceof ArrayBuffer&&!value.data.byteOffset&&value.data.byteLength===value.data.buffer.byteLength)value.data.buffer.transfer(0);if(active===record)active=null;}
  }})();return record.done;
 }
 return{convert:(...args)=>convert(false,...args),convertPixels:(...args)=>convert(true,...args),stats:async()=>active?{...empty(),active:true}:empty(),dispose:async()=>{closed=true;const record=active;if(record){record.controller.abort();const stopping=record.window?stopConverter(record.window,{pid:record.row.pid||record.window.webContents.getOSProcessId()}):Promise.resolve();const results=await Promise.allSettled([stopping,record.done]);const failure=results.find(value=>value.status==='rejected'&&(value.reason?.name!=='AbortError'||record.row.cleanupError));if(failure)throw failure.reason;}return empty();},snapshot:()=>({scope:'Fresh hidden renderer per conversion; original kernel/options/default display; actual captured renderer exit before OCR input return',closed,active:!!active,rows:rows.map(value=>({...value}))})};
}
module.exports={createIsolatedRasterDiagnostic};
