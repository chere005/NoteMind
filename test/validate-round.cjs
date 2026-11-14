const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const round=process.argv[2]||'source',out=path.resolve('test-results/validation-'+round);fs.mkdirSync(out,{recursive:true});
const packaged=round==='packaged',appDir=path.resolve(process.platform==='darwin'?'dist/NoteMind/NoteMind.app/Contents/Resources/app':'dist/NoteMind/resources/app'),summary={round,started:new Date().toISOString(),checks:[]};
function run(exe,args,report,env={}){console.log('Checking '+args.join(' '));const result=spawnSync(exe,args,{stdio:'inherit',windowsHide:true,env:{...process.env,...env}});if(result.status!==0)throw Error('Failed: '+args.join(' '));if(report){const data=JSON.parse(fs.readFileSync('test-results/'+report+'.json','utf8'));if(!data.ok)throw Error('Failed report: '+report);fs.copyFileSync('test-results/'+report+'.json',path.join(out,report+'.json'));summary.checks.push({name:report,count:data.checks?.length,ok:true});}else summary.checks.push({name:args.join(' '),ok:true})}
try{
 if(!packaged)run(process.platform==='win32'?'npm.cmd':'npm',['run','preflight']);
 for(const name of ['review','restart','sidebar','sidebar-actions','document-pane','document-integration','welcome','welcome-guide','welcome-tour','editor-toolbar','workspace-ux','menu-audit','tables-styles','notes-features','notes-recovery','keys-format','syntax-highlighting','projects','find-replace','clipboard','footer','structure','tabs-recents','pdf-export','help','drawing-tools','nm-format','large-drawing','image-note','launch-file'])run(require('electron'),['test/hidden-runner.cjs',name],name,{NOTEMIND_TEST_APP:packaged?(name==='document-integration'?appDir:path.join(appDir,'src')):''});
 for(const name of ['pad-app','pen-display-events','pad-coordinate-events','menu-rotation','picture-editor','light-mode'])run(require('electron'),['test/'+name+'.cjs'],null,{NOTEMIND_TEST_APP:packaged?path.join(appDir,'src'):''});
 run(require('electron'),['test/hidden-runner.cjs','picture-app'],null,{NOTEMIND_TEST_APP:packaged?path.join(appDir,'src'):''});
 run(process.execPath,['test/pen-smoke.cjs']);if(process.platform==='win32')run(process.execPath,['test/portable.cjs'],'portable');
 summary.ok=true;
}catch(e){summary.ok=false;summary.error=e.stack;process.exitCode=1;}
summary.finished=new Date().toISOString();fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
