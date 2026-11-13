const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
 const root=path.resolve(__dirname,'..'),folder=path.join(root,'dist/NoteMind'),icon=path.join(root,'src/icon.ico'),pkg=require('../package.json');
 const digest=crypto.createHash('sha256').update(await fs.readFile(icon)).update(pkg.version).digest('hex');
 const marker=path.join(folder,'.icon.sha256');
 if(await fs.readFile(marker,'utf8').catch(()=>null)===digest)return;
 const staged=path.join(folder,'NoteMind-icon-update.exe');await fs.copyFile(path.join(folder,'electron.exe'),staged);
 try{
  const {rcedit}=await import('rcedit');
  await rcedit(staged,{icon,'version-string':{ProductName:'NoteMind',FileDescription:'NoteMind',InternalName:'NoteMind',OriginalFilename:'NoteMind.exe'},'file-version':pkg.version,'product-version':pkg.version});
  await fs.rename(staged,path.join(folder,'NoteMind.exe'));await fs.writeFile(marker,digest);
 }finally{await fs.unlink(staged).catch(()=>{});}
})().catch(error=>{console.error('Could not install the app icon. Close NoteMind and rebuild.\n'+error.message);process.exitCode=1;});
