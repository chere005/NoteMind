import * as pdfjs from './vendor/pdfjs/pdf.mjs';
import {ReferenceSession} from './pdf-reference-session.cjs';
import {create} from './pdf-reference-provider.cjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',location.href).href;
const session=new ReferenceSession(create({pdfjs,baseURL:location.href})),controllers=new Map();
window.notemindPDFWorker.onRequest(async packet=>{
 const {id,method,args={}}=packet;if(method==='cancel'){controllers.get(args.requestId)?.abort();return;}const controller=new AbortController();controllers.set(args.requestId||id,controller);
 try{
  let value;
  if(method==='open')value=await session.open({data:args.bytes,password:args.password},{identity:args.sourceHash,signal:controller.signal});
  else if(method==='info')value=await session.info(args.page,{signal:controller.signal});
  else if(method==='render'){const lease=await session.render(args.page,{maxDimension:args.maxDimension||2048,thumbnail:!!args.thumbnail,signal:controller.signal});try{value={...lease.value};delete value.dispose;window.notemindPDFWorker.reply({id,value});return;}finally{lease.release();}}
  else if(method==='text'){const page=await session.document.page(args.page,{signal:controller.signal});try{value=await page.text({signal:controller.signal});}finally{page.cleanup();}}
  else if(method==='stats')value=session.stats();
  else if(method==='source')value=await session.document.bytes();
  else if(method==='close'){await session.close();value=null;}
  else throw Error('Unknown PDF reference operation.');window.notemindPDFWorker.reply({id,value});
 }catch(error){window.notemindPDFWorker.reply({id,error:{name:error.name,message:error.message}});}
 finally{controllers.delete(args.requestId||id);}
});
