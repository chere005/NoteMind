const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');

function runtimeBundles(bundle,fileSystem){
 const root=path.join(bundle,'Contents/Frameworks'),found=[];
 function visit(folder){let entries;try{entries=fileSystem.readdirSync(folder,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink()||!entry.isDirectory())continue;const target=path.join(folder,entry.name);visit(target);if(/\.(?:app|framework|xpc)$/.test(entry.name))found.push(target);}}
 visit(root);return found.map(file=>({file,role:path.relative(root,file).split(path.sep).map(part=>part.replace(/\.(?:app|framework|xpc)$/,'').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')).join('.')}));
}

function signMacApp(bundle,{execFileSync=cp.execFileSync,env=process.env,platform=process.platform,warn=console.warn,fileSystem=fs}={}){
 if(platform!=='darwin')throw Error('Mac application signing requires macOS.');
 let identity=env.NOTEMIND_CODESIGN_IDENTITY?.trim();
 if(!identity){
  try{const identities=execFileSync('/usr/bin/security',['find-identity','-v','-p','codesigning'],{encoding:'utf8'});identity=String(identities).match(/\b([A-Fa-f0-9]{40})\s+"Developer ID Application:[^"]+"/)?.[1];}catch(error){warn('Could not find a local Developer ID signing identity: '+error.message);}
 }
 if(!identity||identity==='-'){identity='-';warn('WARNING: NoteMind is using ad hoc signing; macOS privacy permissions may not survive app updates. Set NOTEMIND_CODESIGN_IDENTITY to a persistent signing identity.');}
 const namespace=execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleIdentifier',path.join(bundle,'Contents/Info.plist')],{encoding:'utf8'}).trim();
 if(!/^com\.seancheren\.notemind(?:\.preview)?$/.test(namespace))throw Error('Unexpected NoteMind bundle identifier: '+namespace);
 const sign=(file,identifier)=>execFileSync('/usr/bin/codesign',['--force','--sign',identity,'--identifier',identifier,'--timestamp=none','--preserve-metadata=entitlements',file],{stdio:'inherit'});
 // These executable resources need explicit signing; signing the enclosing app does not update their linker signatures.
 for(const name of ['wm-pen','wm-pen-display'])sign(path.join(bundle,'Contents/Resources/app/src/helpers',name),namespace+'.'+name);
 // Electron's helper apps and framework containers must be sealed inside-out; --deep on the parent is not signing.
 for(const {file,role} of runtimeBundles(bundle,fileSystem))sign(file,namespace+'.runtime.'+role);
 sign(bundle,namespace);
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});
 return {identity,namespace};
}

module.exports={signMacApp};
