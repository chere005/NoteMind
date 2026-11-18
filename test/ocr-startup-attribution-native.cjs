// Diagnostic only: unchanged mixed100 acceptance, with bounded scalar startup
// observation, or an explicitly isolated three-real-fixture attribution lane.
require('./disable-native-pen.cjs');
if(process.argv[2]==='isolated')require('./helpers/ocr-startup-isolated.cjs');
else{
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{extendIndexDriver}=require('./helpers/extend-index-driver.cjs'),{extendStartupDriver}=require('./helpers/ocr-startup-attribution.cjs');
 for(const[key,value]of Object.entries({NOTEMIND_RASTER_ALL_IMAGES:'1',NOTEMIND_RASTER_HARDWARE:'1',NOTEMIND_PERF_INDEX_MODE:'integrated'})){if(process.env[key]&&process.env[key]!==value)throw Error('Startup mixed diagnostic requires '+key+'='+value);process.env[key]=value;}
 for(const key of['NOTEMIND_RASTER_CACHE_ONLY','NOTEMIND_PERF_IDLE_ONLY','NOTEMIND_RASTER_SKIA_MB','NOTEMIND_RASTER_PRESENT','NOTEMIND_RASTER_MEMORY_PROBE','NOTEMIND_RASTER_NATIVE_ALLOCATORS'])if(process.env[key]&&process.env[key]!=='0')throw Error('Attribution cannot weaken mixed acceptance: '+key);
 process.env.NOTEMIND_PERF_VARIANT||='ocr-startup-diagnostic';
 const code=extendStartupDriver(extendIndexDriver(fs.readFileSync(path.join(__dirname,'real-raster-performance.cjs'),'utf8')).code);
 const entry=new Module(__filename,module);entry.filename=__filename;entry.paths=module.paths;entry._compile(code,__filename);
}
