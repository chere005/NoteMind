// Native probes must fail into artifacts before Electron can open a main-process error dialog.
const fs = require('node:fs'),path=require('node:path');
function installNativeFailureExit({app,report,telemetry,processObject=process}) {
 let failing = false;
 const fail = (reason,kind) => {
  if (!failing) {
   failing = true;
   try {
    const error = reason instanceof Error ? reason : Error(String(reason));
    telemetry.passed = false;telemetry.ok=false;
    telemetry.fatal = {kind,name:error.name,message:error.message,stack:error.stack,pid:processObject.pid};
    fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(telemetry,null,2));
   } catch (error) {
    try { fs.writeFileSync(report+'.fatal.txt','Native probe failed and could not write its structured artifact: '+String(error)); } catch {}
   }
  }
  // A monitor runs before Electron's uncaughtException listener. Exit synchronously;
  // cleanup cannot be awaited after an uncaught error in a main-process probe.
  try { app.exit(1); } finally { processObject.exit(1); }
 };
 const uncaught = error => fail(error,'uncaughtException'), rejection = reason => fail(reason,'unhandledRejection');
 processObject.prependListener('uncaughtExceptionMonitor',uncaught);
 processObject.prependListener('unhandledRejection',rejection);
 return () => {processObject.removeListener('uncaughtExceptionMonitor',uncaught);processObject.removeListener('unhandledRejection',rejection);};
}
module.exports = {installNativeFailureExit};
