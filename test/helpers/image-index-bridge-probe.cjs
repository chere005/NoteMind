// Read-only scalar observer. Never retains source text, byte arrays or RPC replies.
function observeImageBridge(host,{sample=async()=>{},limit=96,now=()=>performance.now()}={}){
 const original=host.executeJavaScript,rows=[],totals={calls:0,codeChars:0,uploadCalls:0,uploadCodeChars:0,readCalls:0,readChars:0,binaryReadBytes:0,ackCalls:0,outputBytes:0,completed:0,dropped:0};
 let current=null,sequence=0,closed=false,sampling=false;
 const record=async boundary=>{
  if(rows.length>=limit){totals.dropped++;return;}
  const row={boundary,at:now(),attempt:current?.attempt||sequence,...current,totals:{...totals}};
  rows.push(row);sampling=true;
  try{await sample(row);}catch(error){row.probeError=String(error?.message||error);}finally{sampling=false;}
 };
 const kind=code=>typeof code!=='string'?null:code.includes('function installImageIndexRasterHost')?'install':/\.bytes\["begin"\]\(/.test(code)?'begin':/\.bytes\["write"\]\(/.test(code)?'write':/\.bytes\["read(?:Binary)?"\]\(/.test(code)?'read':/\.bytes\["ackBinary"\]\(/.test(code)?'ack':/\.bytes\["release"\]\(/.test(code)?'release':/\.tools\([^)]*\)\["image(?:Pixels)?"\]\(/.test(code)?'convert':/\.drain\(/.test(code)?'drain':null;
 async function observed(...args){
  const code=args[0],operation=kind(code);
  if(closed||sampling||!operation)return original.apply(this,args);
  totals.calls++;totals.codeChars+=code.length;
  if(operation==='begin'){
   current={attempt:++sequence,inputBytes:Number(code.match(/\.bytes\["begin"\]\((\d+)\)/)?.[1]||0),uploadCalls:0,uploadCodeChars:0,readCalls:0,readChars:0,binaryReadBytes:0,ackCalls:0,outputBytes:0};
   await record('before-begin');
  }
  const value=await original.apply(this,args);
  if(operation==='install')await record('after-install');
  if(operation==='write'){
   totals.uploadCalls++;totals.uploadCodeChars+=code.length;
   if(current){current.uploadCalls++;current.uploadCodeChars+=code.length;if(value===current.inputBytes)await record('after-last-upload');}
  }
  if(operation==='convert'){
   const output=value?.data?.bytes;
   if(Number.isSafeInteger(output)&&output>=0){totals.outputBytes+=output;if(current)current.outputBytes=output;}
   await record('after-worker-output');
  }
  if(operation==='read'){
   const chars=typeof value?.data==='string'?value.data.length:0;
   totals.readCalls++;totals.readChars+=chars;const binaryBytes=ArrayBuffer.isView(value?.data)?value.data.byteLength:0;totals.binaryReadBytes+=binaryBytes;
   if(current){current.readCalls++;current.readChars+=chars;current.binaryReadBytes+=binaryBytes;if(value?.offset+value?.bytes===current.outputBytes)await record('after-last-read');}
  }
  if(operation==='ack'){totals.ackCalls++;if(current)current.ackCalls++;}
  if(operation==='release'){totals.completed++;await record('after-release');}
  if(operation==='drain'){await record('after-drain');current=null;}
  return value;
 }
 host.executeJavaScript=observed;
 return{rows,snapshot:()=>({...totals,attempts:sequence,active:!!current}),detach(){closed=true;if(host.executeJavaScript===observed)host.executeJavaScript=original;}};
}
module.exports={observeImageBridge};
