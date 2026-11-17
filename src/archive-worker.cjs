const {parentPort}=require('node:worker_threads');
const format=require('./notepad-format.cjs');
parentPort.on('message',async({id,op,args})=>{
 try{
  let value;const transfers=[];
  if(op==='encode'){
   const bytes=format.encode(...args);value=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?new Uint8Array(bytes.buffer):Uint8Array.from(bytes);transfers.push(value.buffer);
  }else if(op==='decode'){
   value=format.decode(Buffer.from(args[0]));const mode=args[1]?.files??'metadata';
   if(mode===false)delete value.files;
   else{
    value.files=Object.fromEntries(Object.entries(value.files).filter(([name])=>mode===true||!name.startsWith('assets/')).map(([name,bytes])=>{
     const copy=Uint8Array.from(bytes);transfers.push(copy.buffer);return [name,copy];
    }));
   }
  }else if(op==='prepareSnapshot'){
   value=require('./snapshot-store.cjs').prepareSnapshot(...args);
   for(const object of value.objects){const bytes=object.bytes;const copy=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes:Uint8Array.from(bytes);object.bytes=copy;transfers.push(copy.buffer);}
   if(value.manifestBytes)transfers.push(value.manifestBytes.buffer);
  }else if(op==='readSnapshot')value=await require('./snapshot-store.cjs').readSnapshot(...args);
  else if(op==='readCommitted')value=await require('./recovery-commit.cjs').readCommitted(...args);
  else if(op==='parseJson'){const bytes=args[0];value=JSON.parse(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('utf8'));}
  else if(op==='stringifyJson'){value=new TextEncoder().encode(JSON.stringify(args[0]));transfers.push(value.buffer);}
  else throw Error('Unknown archive operation.');
  parentPort.postMessage({id,value},transfers);
 }catch(error){parentPort.postMessage({id,error:{name:error.name,message:error.message,stack:error.stack}});}
});
