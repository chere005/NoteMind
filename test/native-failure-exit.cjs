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
  try { app.exit(1); } finally {
   // Electron replaces process.exit with another asynchronous app.exit call.
   // Node's original native exit is required to stop this listener dispatch.
   try { if (typeof processObject.reallyExit === 'function') processObject.reallyExit(1); } catch {}
   // Last resort is restricted to this owned disposable probe, after its artifact.
   try { processObject.kill(processObject.pid,'SIGKILL'); } catch {}
   processObject.exit(1);
  }
 };
 const uncaught = error => fail(error,'uncaughtException'), rejection = reason => fail(reason,'unhandledRejection');
 // Replace Electron's main-process dialog handlers only in this disposable test.
 processObject.removeAllListeners('uncaughtException');
 processObject.removeAllListeners('unhandledRejection');
 processObject.prependListener('uncaughtExceptionMonitor',uncaught);
 processObject.prependListener('uncaughtException',uncaught);
 processObject.prependListener('unhandledRejection',rejection);
 return () => {processObject.removeListener('uncaughtExceptionMonitor',uncaught);processObject.removeListener('uncaughtException',uncaught);processObject.removeListener('unhandledRejection',rejection);};
}
module.exports = {installNativeFailureExit};
