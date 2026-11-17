// Install an isolated build without replacing or opening the app in use.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
if(process.platform!=='darwin')throw Error('The Preview installer currently supports macOS.');
const source=path.resolve('dist/NoteMind/NoteMind.app');
const destination=path.join(os.homedir(),'Applications','NoteMind Preview.app');
const staging=destination+'.installing';
fs.mkdirSync(path.dirname(destination),{recursive:true});
if(fs.existsSync(destination)){
 const id=cp.execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleIdentifier',path.join(destination,'Contents/Info.plist')],{encoding:'utf8'}).trim();
 if(id!=='com.seancheren.notemind.preview')throw Error('The Preview destination belongs to a different application.');
}
fs.rmSync(staging,{recursive:true,force:true});
cp.execFileSync('/usr/bin/ditto',[source,staging]);
const plist=path.join(staging,'Contents/Info.plist'),appDir=path.join(staging,'Contents/Resources/app');
for(const [key,value] of Object.entries({CFBundleName:'NoteMind Preview',CFBundleDisplayName:'NoteMind Preview',CFBundleIdentifier:'com.seancheren.notemind.preview'}))cp.execFileSync('/usr/bin/plutil',['-replace',key,'-string',value,plist]);
for(const key of ['CFBundleDocumentTypes','UTExportedTypeDeclarations'])cp.execFileSync('/usr/bin/plutil',['-remove',key,plist]);
const manifest=JSON.parse(fs.readFileSync(path.join(appDir,'package.json'),'utf8'));
Object.assign(manifest,{name:'notemind-preview',productName:'NoteMind Preview',main:'preview.cjs'});
fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(appDir,'preview.cjs'),`const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
process.env.NOTEMIND_PAD_OWNER=path.join(app.getPath('documents'),'NoteMind','Devices','pad-owner.json');
app.setName('NoteMind Preview');
const documents=path.join(app.getPath('documents'),'NoteMind Preview'),data=path.join(documents,'App Data');
fs.mkdirSync(data,{recursive:true});app.setPath('documents',documents);app.setPath('userData',data);
const inside=value=>{if(!value)return false;const relative=path.relative(data,path.resolve(value));return relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)};
if(!inside(process.env.NOTEMIND_DATA))delete process.env.NOTEMIND_DATA;
if(!inside(process.env.NOTEMIND_HOME))process.env.NOTEMIND_HOME=data;
if(!inside(process.env.NOTEMIND_WORKSPACES))process.env.NOTEMIND_WORKSPACES=path.join(data,'workspaces');
require('./src/main.cjs');
`);
require('./mac-signing.cjs').signMacApp(staging);
const previous=destination+'.previous';
fs.rmSync(previous,{recursive:true,force:true});
if(fs.existsSync(destination))fs.renameSync(destination,previous);
try{fs.renameSync(staging,destination);}catch(error){if(fs.existsSync(previous))fs.renameSync(previous,destination);throw error;}
fs.rmSync(previous,{recursive:true,force:true});
console.log('Installed '+destination+' (not launched).');
