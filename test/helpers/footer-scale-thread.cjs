const {parentPort,workerData}=require('node:worker_threads'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const count=require('../../src/notes-footer.js'),source=workerData.text,hash=value=>crypto.createHash('sha256').update(value).digest('hex');
parentPort.postMessage({phase:'ready',sha256:hash(source),bytes:Buffer.byteLength(source),heapLimit:require('node:v8').getHeapStatistics().heap_size_limit});
parentPort.once('message',()=>{
 const start=performance.now();let result,stats;
 const context=vm.createContext({TextEncoder,TextDecoder,structuredClone});context.source=source;
 if(workerData.mode==='baseline'){
  context.module={exports:{}};vm.runInContext(fs.readFileSync(path.join(workerData.root,'notes-footer.js'),'utf8'),context,{filename:'notes-footer.js'});
  vm.runInContext(fs.readFileSync(path.join(workerData.root,'document-renderer.js'),'utf8'),context,{filename:'document-renderer.js'});
  result=vm.runInContext('module.exports.countHTML(NoteMindDocument.render(source))',context);
 }else{
  vm.runInContext(fs.readFileSync(path.join(workerData.root,'notes-footer-markdown.js'),'utf8'),context,{filename:'notes-footer-markdown.js'});context.options={onStats:value=>stats=value};result=vm.runInContext('NoteMindFooterMarkdown.countMarkdown(source,options)',context);
 }
 parentPort.postMessage({phase:'result',count:result,wallMs:performance.now()-start,stats});
});
