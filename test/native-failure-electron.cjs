// Manual minimal Main event-order proof. No BrowserWindow or product jobs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync,execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
if(process.versions.electron){
 const {app}=require('electron'),[kind,directory]=process.argv.slice(2),report=path.join(directory,'report.json'),marker=path.join(directory,'fake-default-ran');
 app.setPath('userData',path.join(directory,'profile'));app.dock?.hide();
 for(const name of ['uncaughtException','unhandledRejection','uncaughtExceptionMonitor'])process.removeAllListeners(name);
 const fallback=()=>{try{fs.writeFileSync(marker,'default handler ran')}finally{app.exit(2);process.exit(2)}};
 process.on('uncaughtException',fallback);process.on('unhandledRejection',fallback);
 require('./native-failure-exit.cjs').installNativeFailureExit({app,report,telemetry:{source:'minimal-main-event-order',kind}});
 app.whenReady().then(()=>{if(kind==='throw')setImmediate(()=>{throw Error('owned electron fault')});else Promise.reject(Error('owned electron fault'));});
}else{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'notemind-native-fatal-')),results=[];let passed=false;
 try{
  for(const kind of ['throw','reject']){
   const directory=path.join(root,kind);fs.mkdirSync(directory);const run=spawnSync(require('electron'),[__filename,kind,directory],{encoding:'utf8',timeout:8000,killSignal:'SIGKILL'}),report=path.join(directory,'report.json');
   const result={kind,status:run.status,signal:run.signal,error:run.error?.message,marker:fs.existsSync(path.join(directory,'fake-default-ran')),artifact:fs.existsSync(report)?JSON.parse(fs.readFileSync(report,'utf8')):null,stderr:run.stderr};results.push(result);
   if(run.status!==1||run.signal||result.marker||result.artifact?.passed!==false||result.artifact?.fatal?.message!=='owned electron fault')throw Error('Actual Main failure-exit proof failed.');
  }
  passed=true;
 }finally{
  const report=path.resolve('test-results/performance/native-failure-electron.json');fs.mkdirSync(path.dirname(report),{recursive:true});const value={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),helperSHA256:createHash('sha256').update(fs.readFileSync(path.join(__dirname,'native-failure-exit.cjs'))).digest('hex'),passed,scope:'Actual Electron Main event order only; no Word jobs or windows',results};fs.writeFileSync(report,JSON.stringify(value,null,2));console.log(JSON.stringify({passed,report,results}));fs.rmSync(root,{recursive:true,force:true});
 }
}
