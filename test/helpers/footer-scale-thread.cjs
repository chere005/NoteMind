const {parentPort,workerData}=require('node:worker_threads'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const count=require('../../src/notes-footer.js'),source=workerData.text,hash=value=>crypto.createHash('sha256').update(value).digest('hex');
parentPort.postMessage({phase:'ready',sha256:hash(source),bytes:Buffer.byteLength(source)});
parentPort.once('message',()=>{
 const start=performance.now();let result,stats;
 if(workerData.mode==='baseline')result=count.countHTML(require('../../src/document-renderer.cjs').render(source));
 else{
  const context=vm.createContext({TextEncoder,TextDecoder,structuredClone});vm.runInContext(fs.readFileSync(path.join(workerData.root,'notes-footer-markdown.js'),'utf8'),context,{filename:'notes-footer-markdown.js'});context.source=source;context.options={onStats:value=>stats=value};result=vm.runInContext('NoteMindFooterMarkdown.countMarkdown(source,options)',context);
 }
 parentPort.postMessage({phase:'result',count:result,wallMs:performance.now()-start,stats});
});
