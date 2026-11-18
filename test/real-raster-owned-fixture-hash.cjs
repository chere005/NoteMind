// Checked diagnostic: stock full100 production Web workload, owned prep hash only.
require('./disable-native-pen.cjs');
const fs=require('node:fs'),path=require('node:path'),extension=require('./helpers/extend-index-driver.cjs'),{deriveOwnedFixtureDriver}=require('./helpers/owned-fixture-driver.cjs'),canonical=path.join(__dirname,'real-raster-performance.cjs'),entry=path.join(__dirname,'real-raster-index-completion.cjs'),extend=extension.extendIndexDriver;
const fixtureFolder=path.resolve('test-results/performance-0.37/real-raster-fixture');for(const name of['images.nm','fixture.json'])if(!fs.existsSync(path.join(fixtureFolder,name)))throw Error('Original frozen raster fixture must already exist.');
const original=fs.readFileSync(canonical,'utf8'),extended=extend(original),prepared=deriveOwnedFixtureDriver(extended.code,{canonicalSource:original,canonicalFile:canonical,extensionFile:require.resolve('./helpers/extend-index-driver.cjs'),wrapperFile:__filename,entryFile:entry});
if(globalThis.__notemindOwnedFixtureHashProof)throw Error('Owned fixture preparation already installed.');globalThis.__notemindOwnedFixtureHashProof=Object.freeze(prepared.proof);
let installed=false;extension.extendIndexDriver=source=>{if(installed||source!==original)throw Error('Canonical raster workload authority changed.');installed=true;return{...extended,code:prepared.code}};
require(entry);
