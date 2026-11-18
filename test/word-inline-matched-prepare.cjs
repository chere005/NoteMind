const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const dir=path.resolve(process.argv[2]),file=path.resolve('src/word-inline.cjs'),base='2ab0c0183cee63f8747a1d91eeefa2c72dc2c6e6';
if(process.env.ELECTRON_RUN_AS_NODE!=='1'||process.versions.node!=='24.22.2'||process.versions.electron!=='44.11.3')throw Error('Pinned runtime required.');
require('node:os').setPriority(process.pid,15);fs.mkdirSync(dir,{recursive:false});
const baseline=cp.execFileSync('git',['show',base+':src/word-inline.cjs'],{encoding:'utf8'}),candidate=fs.readFileSync(file,'utf8'),children=[],originalSpawn=cp.spawn;
const receipt={scope:'Source-only matched compact parser preparation; no performance or release claim',pid:process.pid,versions:process.versions,sourceHead:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baselineHead:base,baselineWordSHA:sha(baseline),candidateWordSHA:sha(candidate),bundles:{},files:{}};
fs.writeFileSync(path.join(dir,'word-inline-before.cjs'),baseline,{flag:'wx'});
cp.spawn=function(...args){const child=originalSpawn.apply(this,args);if(String(args[0]).includes('esbuild'))children.push({child,pid:child.pid,exit:new Promise(resolve=>child.once('exit',(code,signal)=>resolve({pid:child.pid,code,signal})))});return child;};
const esbuild=require('esbuild');
// esbuild unrefs its owned child. Keep this controller alive until its captured
// actual exit, rather than letting an unresolved Promise masquerade as a join.
let timeoutFailure,hardStop;const deadline=setTimeout(()=>{timeoutFailure=Error('Source-only preparation did not drain in30s.');for(const row of children)if(row.child.exitCode===null&&row.child.signalCode===null)row.child.kill('SIGTERM');hardStop=setTimeout(()=>{for(const row of children)if(row.child.exitCode===null&&row.child.signalCode===null)row.child.kill('SIGKILL');},5000);},30000);
console.log(JSON.stringify({phase:'prepare-start',pid:process.pid,dir}));
(async()=>{
 try{
  for(const[label,contents]of[['before',baseline],['after',candidate]]){
   const outfile=path.join(dir,label+'.js'),result=await esbuild.build({entryPoints:['src/footer-markdown.cjs'],bundle:true,platform:'browser',format:'iife',globalName:'NoteMindFooterMarkdown',outfile,minify:true,metafile:true,plugins:[{name:'exact-word-only',setup(build){build.onLoad({filter:/[/\\]word-inline\.cjs$/},()=>({contents,loader:'js',resolveDir:path.dirname(file)}));}}]});
   receipt.bundles[label]={file:outfile,sha256:sha(fs.readFileSync(outfile))};
   for(const name of Object.keys(result.metafile.inputs))if(path.resolve(name)!==file)receipt.files[path.resolve(name)]=sha(fs.readFileSync(name));
  }
  if(sha(fs.readFileSync(file))!==receipt.candidateWordSHA)throw Error('Candidate source changed.');
 }finally{
  for(const row of children)row.child.ref();esbuild.stop();receipt.esbuildExits=await Promise.all(children.map(row=>row.exit));cp.spawn=originalSpawn;clearTimeout(deadline);clearTimeout(hardStop);
 }
 if(timeoutFailure)throw timeoutFailure;
 receipt.preparerSHA=sha(fs.readFileSync(__filename));receipt.controllerSHA=sha(fs.readFileSync(path.join(__dirname,'word-inline-matched-performance.cjs')));
 fs.writeFileSync(path.join(dir,'source-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({phase:'prepare-exit',pid:process.pid,bundles:receipt.bundles,esbuildExits:receipt.esbuildExits}));
})().catch(error=>{console.error(error);process.exitCode=1;});
