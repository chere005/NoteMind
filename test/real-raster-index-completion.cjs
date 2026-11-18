// Extends the original100-image App driver after its unchanged display phases.
// Every source, model, observer and recovery authority remains inside its guard.
require('./disable-native-pen.cjs');
const earlyApp=require('electron').app,earlyPath=require('node:path'),earlyVariant=process.env.NOTEMIND_PERF_VARIANT||'index-completion';
require('./native-failure-exit.cjs').installNativeFailureExit({app:earlyApp,report:earlyPath.resolve('test-results/performance-0.37','real-raster-'+earlyVariant+'.json'),telemetry:{variant:earlyVariant,phase:'extended-driver-bootstrap',ok:false}});
for(const[key,value]of Object.entries({NOTEMIND_RASTER_ALL_IMAGES:'1',NOTEMIND_RASTER_HARDWARE:'1',NOTEMIND_PERF_INDEX_MODE:'integrated'})){if(process.env[key]&&process.env[key]!==value)throw Error('Mixed completion driver requires '+key+'='+value);process.env[key]=value;}
for(const key of['NOTEMIND_RASTER_CACHE_ONLY','NOTEMIND_PERF_IDLE_ONLY','NOTEMIND_RASTER_SKIA_MB','NOTEMIND_RASTER_PRESENT','NOTEMIND_RASTER_MEMORY_PROBE','NOTEMIND_RASTER_NATIVE_ALLOCATORS'])if(process.env[key]&&process.env[key]!=='0')throw Error('Optional attribution flags cannot change mixed acceptance: '+key);
process.env.NOTEMIND_PERF_VARIANT ||= 'index-completion';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),{extendIndexDriver}=require('./helpers/extend-index-driver.cjs'),canonical=path.join(__dirname,'real-raster-performance.cjs'),extended=extendIndexDriver(fs.readFileSync(canonical,'utf8')),entry=new Module(__filename,module);entry.filename=__filename;entry.paths=module.paths;entry._compile(extended.code,__filename);
