const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{parentPort,workerData}=require('node:worker_threads');
const context=vm.createContext({TextDecoder,TextEncoder,self:{postMessage:value=>parentPort.postMessage(value)},importScripts(file){vm.runInContext(fs.readFileSync(path.join(workerData.root,file),'utf8'),context,{filename:file});}});
vm.runInContext(fs.readFileSync(path.join(workerData.root,'notes-footer.js'),'utf8'),context,{filename:'notes-footer.js'});
parentPort.on('message',value=>context.self.onmessage({data:value}));
