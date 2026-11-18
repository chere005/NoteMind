const defaultFs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{constants}=require('node:fs');

async function stampIcon({root=path.resolve(__dirname,'..'),fs=defaultFs,edit}={}){
 const folder=path.join(root,'dist/NoteMind'),source=path.join(folder,'electron.exe'),target=path.join(folder,'NoteMind.exe'),marker=path.join(folder,'.icon.sha256'),icon=path.join(root,'src/icon.ico');
 const regular=async file=>{try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unexpected executable or cache entry: '+file);return stat;}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const same=(a,b)=>!a&&!b||!!a&&!!b&&['dev','ino','size','mtimeMs','mode'].every(key=>a[key]===b[key]);
 const unchanged=async(file,before)=>{if(!same(before,await regular(file)))throw Error('Executable publication ownership changed: '+file);};
 const hashFile=async file=>{
  const before=await regular(file);if(!before)throw Error('Missing stamp input: '+file);
  const handle=await fs.open(file,'r'),scratch=Buffer.allocUnsafeSlow(196608),hash=crypto.createHash('sha256');
  try{if(!same(before,await handle.stat()))throw Error('Stamp input ownership changed: '+file);for(;;){const {bytesRead}=await handle.read(scratch,0,scratch.length,null);if(!bytesRead)break;hash.update(scratch.subarray(0,bytesRead));}if(!same(before,await handle.stat()))throw Error('Stamp input changed: '+file);await unchanged(file,before);return hash.digest('hex');}
  finally{try{await handle.close();}finally{scratch.buffer.transfer?.(0);}}
 };
 const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(typeof pkg.version!=='string'||!pkg.version)throw Error('Missing application version.');
 const sourceStat=await regular(source);if(!sourceStat)throw Error('The Windows Electron runtime is missing.');
 const sourceHash=await hashFile(source),iconHash=await hashFile(icon),inputHash=crypto.createHash('sha256').update(JSON.stringify({runtime:sourceHash,icon:iconHash,version:pkg.version})).digest('hex'),targetStat=await regular(target),markerStat=await regular(marker);
 let cached=null;if(markerStat){try{cached=JSON.parse(await fs.readFile(marker,'utf8'));}catch(error){if(!(error instanceof SyntaxError))throw error;}await unchanged(marker,markerStat);}
 if(cached?.version===1&&cached.inputHash===inputHash&&targetStat&&cached.outputHash===await hashFile(target)){await unchanged(target,targetStat);return{changed:false,inputHash,outputHash:cached.outputHash};}
 const temporary=await fs.mkdtemp(path.join(folder,'NoteMind-icon-update-')),temporaryStat=await fs.lstat(temporary),staged=path.join(temporary,'NoteMind.exe'),stagedMarker=path.join(temporary,'cache.json'),stagedIcon=path.join(temporary,'icon.ico');
 const ownedDirectory=async()=>{const current=await fs.lstat(temporary);if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==temporaryStat.dev||current.ino!==temporaryStat.ino)throw Error('Owned Windows stamp staging directory changed.');};
 try{
  await fs.copyFile(source,staged,constants.COPYFILE_EXCL);await fs.chmod(staged,sourceStat.mode&0o7777);if(await hashFile(staged)!==sourceHash)throw Error('Windows runtime changed while staging.');
  await fs.copyFile(icon,stagedIcon,constants.COPYFILE_EXCL);if(await hashFile(stagedIcon)!==iconHash)throw Error('Windows icon changed while staging.');
  const rcedit=edit||(await import('rcedit')).rcedit;await rcedit(staged,{icon:stagedIcon,'version-string':{ProductName:'NoteMind',FileDescription:'NoteMind',InternalName:'NoteMind',OriginalFilename:'NoteMind.exe'},'file-version':pkg.version,'product-version':pkg.version});await ownedDirectory();
  const outputHash=await hashFile(staged);await fs.writeFile(stagedMarker,JSON.stringify({version:1,inputHash,outputHash})+'\n',{flag:'wx',mode:0o600});
  await unchanged(source,sourceStat);await unchanged(target,targetStat);await unchanged(marker,markerStat);
  await fs.rename(staged,target);await unchanged(marker,markerStat);await fs.rename(stagedMarker,marker);
  return{changed:true,inputHash,outputHash};
 }finally{await ownedDirectory();await fs.rm(temporary,{recursive:true,force:true});}
}
module.exports={stampIcon};
if(require.main===module)stampIcon().catch(error=>{console.error('Could not install the app icon. Close NoteMind and rebuild.\n'+error.message);process.exitCode=1;});
