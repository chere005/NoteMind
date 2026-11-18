// Brand the copied Electron runtime as a local macOS application.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
if(process.platform!=='darwin')throw Error('The Mac application must be packaged on macOS.');
const bundle=path.resolve('dist/NoteMind/NoteMind.app'),plist=path.join(bundle,'Contents/Info.plist'),resources=path.join(bundle,'Contents/Resources');
if(!fs.existsSync(plist))throw Error('The copied Electron application is missing.');
const executable=cp.execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleExecutable',plist],{encoding:'utf8'}).trim();
const arch=cp.execFileSync('lipo',['-archs',path.join(bundle,'Contents/MacOS',executable)],{encoding:'utf8'});
require('./mac-target.cjs').validateMacTarget(process.platform,process.arch,arch);
const set=(key,value)=>{try{cp.execFileSync('/usr/bin/plutil',['-replace',key,'-string',value,plist]);}catch{cp.execFileSync('/usr/bin/plutil',['-insert',key,'-string',value,plist]);}};
// Electron's macOS packaged-mode test uses the executable basename, not the
// branded bundle name. Rename before publishing the entry and sealing the app.
const brandedExecutable='NoteMind',brandedPath=path.join(bundle,'Contents/MacOS',brandedExecutable);
if(executable!==brandedExecutable){try{fs.lstatSync(brandedPath);throw Error('The branded NoteMind executable already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}fs.renameSync(path.join(bundle,'Contents/MacOS',executable),brandedPath);}
set('CFBundleExecutable',brandedExecutable);
const version=require('../package.json').version;
set('CFBundleName','NoteMind');set('CFBundleDisplayName','NoteMind');set('CFBundleIdentifier','com.seancheren.notemind');set('CFBundleShortVersionString',version);set('CFBundleVersion',version);
set('NSCameraUsageDescription','NoteMind uses the camera to capture pages and pictures.');
const types=JSON.stringify([{CFBundleTypeName:'NoteMind document',CFBundleTypeRole:'Editor',CFBundleTypeExtensions:['nm'],LSItemContentTypes:['com.seancheren.notemind.document'],LSHandlerRank:'Owner'},{CFBundleTypeName:'Legacy Notepad or project',CFBundleTypeRole:'Editor',CFBundleTypeExtensions:['wm','wmpr'],LSHandlerRank:'Alternate'}]);
const nativeType=JSON.stringify([{UTTypeIdentifier:'com.seancheren.notemind.document',UTTypeDescription:'NoteMind document',UTTypeConformsTo:['public.zip-archive'],UTTypeTagSpecification:{'public.filename-extension':['nm']}}]);
cp.execFileSync('/usr/bin/plutil',['-replace','UTExportedTypeDeclarations','-json',nativeType,plist]);
try{cp.execFileSync('/usr/bin/plutil',['-replace','CFBundleDocumentTypes','-json',types,plist]);}catch{cp.execFileSync('/usr/bin/plutil',['-insert','CFBundleDocumentTypes','-json',types,plist]);}
const icons=path.join('dist','NoteMind','NoteMind.iconset');fs.rmSync(icons,{recursive:true,force:true});fs.mkdirSync(icons,{recursive:true});
try{
 for(const [name,size] of [['icon_16x16.png',16],['icon_16x16@2x.png',32],['icon_32x32.png',32],['icon_32x32@2x.png',64],['icon_128x128.png',128],['icon_128x128@2x.png',256],['icon_256x256.png',256],['icon_256x256@2x.png',512],['icon_512x512.png',512],['icon_512x512@2x.png',1024]])cp.execFileSync('/usr/bin/sips',['-z',String(size),String(size),'src/icon.png','--out',path.join(icons,name)],{stdio:'ignore'});
 cp.execFileSync('/usr/bin/iconutil',['-c','icns',icons,'-o',path.join(resources,'NoteMind.icns')]);set('CFBundleIconFile','NoteMind');
}finally{fs.rmSync(icons,{recursive:true,force:true});}
require('./mac-signing.cjs').signMacApp(bundle);
console.log('Built '+bundle+' (locally signed).');
