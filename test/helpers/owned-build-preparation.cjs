// Finish the fixture's compiler preparation before measuring its native editor.
// This retires completed tooling, without changing any application worker policy.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),threads=require('node:worker_threads'),{execFileSync}=require('node:child_process');
function installBuildPreparation(original,receipt,write){
 const entry=require.resolve('esbuild'),NativeWorker=threads.Worker,load=Module._load,workers=[];let builds=0,joining=null;
 class PreparationWorker extends NativeWorker{
  constructor(file,...args){super(file,...args);if(typeof file==='string'&&path.resolve(file)===entry){const record={worker:this,threadId:this.threadId,actualExit:false};record.done=new Promise(resolve=>this.once('exit',code=>{record.actualExit=this.threadId===-1;record.exitCode=code;resolve();}));workers.push(record);}}
 }
 threads.Worker=PreparationWorker;
 const hook=function(name,parent,isMain){const value=load.call(this,name,parent,isMain);if(name!=='esbuild'||parent?.filename!==original)return value;return{...value,buildSync(...args){const result=value.buildSync(...args);if(++builds===2){
   const compilerPIDs=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)).filter(([,ppid])=>ppid===process.pid).map(([pid])=>pid).filter(pid=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(pid),'-o','comm='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim())==='esbuild';}catch(error){if(error.status===1)return false;throw error;}});
   const retireScript=path.join(__dirname,'retire-owned-compiler.py'),compilerIdentity=JSON.parse(execFileSync('/usr/bin/python3',[retireScript,'capture',String(process.pid),...compilerPIDs.map(String)],{encoding:'utf8'}));
   receipt.buildPreparation={builds,compilerPIDs,compilerIdentity,workers:workers.map(row=>({threadId:row.threadId})),stopRequested:true,actualExit:false};write();
   if(Module._load===hook)Module._load=load;if(threads.Worker===PreparationWorker)threads.Worker=NativeWorker;
   joining=Promise.resolve(value.stop()).then(async()=>{await Promise.all(workers.map(row=>row.done));receipt.buildPreparation.compilerRetirement=JSON.parse(execFileSync('/usr/bin/python3',[retireScript,'retire',String(process.pid),JSON.stringify(compilerIdentity)],{encoding:'utf8',timeout:10000}));if(workers.some(row=>!row.actualExit))throw Error('Completed compiler worker did not exit.');receipt.buildPreparation.actualExit=true;receipt.buildPreparation.workers=workers.map(({threadId,actualExit,exitCode})=>({threadId,actualExit,exitCode}));write();});
  }return result;}};};
 Module._load=hook;
 return{async join(){if(builds!==2||!joining)throw Error('The original two compiler preparations did not finish.');await joining;}};
}
module.exports={installBuildPreparation};
