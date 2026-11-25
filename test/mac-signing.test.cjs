const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {signMacApp,auditMacSignature,resolveIdentity,teamOf,ENTITLEMENTS}=require('../scripts/mac-signing.cjs');
const DEVELOPER_ID='Developer ID Application: Example Dev (TEAMID0000)',TEAM='TEAMID0000';
const APP='/build/NoteMind.app',FW=APP+'/Contents/Frameworks',MACHO='cffaedfe';

/** A fake app tree: paths map to a magic string ('' for plain files, null for directories); names ending 'Current' are symlinks. */
function tree(files){
 const dirs=new Map();
 const add=(folder,name,kind)=>{if(!dirs.has(folder))dirs.set(folder,new Map());dirs.get(folder).set(name,kind);};
 const magic={};
 for(const [file,kind] of Object.entries(files)){
  const parts=file.split('/').filter(Boolean);
  for(let i=1;i<parts.length;i++)add('/'+parts.slice(0,i-1).join('/'),parts[i-1],'dir');
  add('/'+parts.slice(0,-1).join('/'),parts.at(-1),kind==='link'?'link':'file');magic[file]=kind==='link'?'':kind;
 }
 return {
  readdirSync:folder=>{if(!dirs.has(folder)){const e=Error('missing');e.code='ENOENT';throw e;}return [...dirs.get(folder)].map(([name,kind])=>({name,isDirectory:()=>kind==='dir',isSymbolicLink:()=>kind==='link'}));},
  magic:file=>magic[file]??'',
 };
}
const APP_FILES={
 [APP+'/Contents/MacOS/NoteMind']:MACHO,
 [APP+'/Contents/Info.plist']:'',
 [APP+'/Contents/Resources/app/src/helpers/wm-pen']:MACHO,
 [APP+'/Contents/Resources/app/src/helpers/wm-pen-display']:MACHO,
 [APP+'/Contents/Resources/app/src/main.cjs']:'636f6e73',
 [APP+'/Contents/Resources/app/node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node']:MACHO,
 [APP+'/Contents/Resources/app/node_modules/x/Classy.class']:'cafebabe',
 [FW+'/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU)']:MACHO,
 [FW+'/Electron Helper (GPU).app/Contents/Info.plist']:'',
 [FW+'/Electron Framework.framework/Versions/A/Electron Framework']:MACHO,
 [FW+'/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib']:MACHO,
 [FW+'/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler']:MACHO,
 [FW+'/Electron Framework.framework/Versions/A/Helpers/Nested.app/Contents/MacOS/Nested']:MACHO,
 [FW+'/Electron Framework.framework/Versions/Current']:'link',
 [FW+'/Electron Framework.framework/Electron Framework']:'link',
 [FW+'/Squirrel.framework/Versions/A/Squirrel']:MACHO,
 [FW+'/Squirrel.framework/Versions/A/Resources/ShipIt']:MACHO,
};
function fixture({env={},namespace='com.seancheren.notemind',identities='  1) 0123 "'+DEVELOPER_ID+'"\n  2) 4567 "Apple Development: Someone (ZZZZZZZZZZ)"\n  3) 89AB "Local Signing"\n',failure=false,files=APP_FILES,archs='arm64'}={}){
 const calls=[],warnings=[],execFileSync=(file,args)=>{calls.push({file,args});if(file==='/usr/bin/security'){if(failure)throw Error('keychain unavailable');return identities;}if(file==='/usr/libexec/PlistBuddy')return namespace+'\n';if(file==='/usr/bin/lipo'){if(args[1].endsWith('Classy.class'))throw Error('not a Mach-O');return typeof archs==='function'?archs(args[1]):archs;}};
 return {calls,warnings,run:()=>signMacApp(APP,{execFileSync,env,platform:'darwin',fileSystem:tree(files),warn:message=>warnings.push(message)}),signs:()=>calls.filter(call=>call.args.includes('--sign'))};
}
const target=call=>call.args.at(-1),flag=(call,name)=>call.args[call.args.indexOf(name)+1];

test('a release signature names the full Developer ID found in the keychain, ignoring other kinds of identity',()=>{
 const h=fixture(),result=h.run();assert.equal(result.identity,DEVELOPER_ID);assert.equal(result.team,TEAM);assert.equal(teamOf(DEVELOPER_ID),TEAM);
 for(const call of h.signs())assert.equal(flag(call,'--sign'),DEVELOPER_ID);assert.deepEqual(h.warnings,[]);
 assert.equal(teamOf('-'),null);assert.equal(teamOf('Developer ID Application: No Team'),null);
});
test('two Developer ID identities are an error, never a guess',()=>{
 const two='  1) AA "Developer ID Application: One (TEAMID0000)"\n  2) BB "Developer ID Application: Two (TEAMID0001)"\n';
 const h=fixture({identities:two});assert.throws(h.run,/2 Developer ID Application identities; set NOTEMIND_CODESIGN_IDENTITY/);assert.ok(!h.calls.some(call=>call.file==='/usr/bin/codesign'));
 assert.equal(fixture({identities:two,env:{NOTEMIND_CODESIGN_IDENTITY:'Developer ID Application: Two (TEAMID0001)'}}).run().team,'TEAMID0001');
});
test('every Mach-O gets the hardened runtime and a secure timestamp, and nothing is signed with --deep',()=>{
 const h=fixture();h.run();const signs=h.signs();
 for(const call of signs){assert.equal(flag(call,'--options'),'runtime');assert.ok(call.args.includes('--timestamp'));assert.ok(!call.args.includes('--timestamp=none'));assert.ok(!call.args.includes('--deep'));assert.ok(!call.args.includes('--preserve-metadata=entitlements'));}
 const targets=signs.map(target);
 for(const name of ['Contents/Resources/app/src/helpers/wm-pen','Contents/Resources/app/src/helpers/wm-pen-display','Contents/Resources/app/node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node'])assert.ok(targets.includes(APP+'/'+name),name);
 for(const name of ['Libraries/libffmpeg.dylib','Helpers/chrome_crashpad_handler'])assert.ok(targets.includes(FW+'/Electron Framework.framework/Versions/A/'+name),name);
 assert.ok(targets.includes(FW+'/Squirrel.framework/Versions/A/Resources/ShipIt'));
 assert.ok(!targets.some(file=>file.endsWith('Classy.class')),'a Java class file is not code');
});
test('bundle executables are signed by their bundle, not on their own, and nothing signs through a symlink',()=>{
 const h=fixture();h.run();const targets=h.signs().map(target);
 for(const exe of [APP+'/Contents/MacOS/NoteMind',FW+'/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU)',FW+'/Electron Framework.framework/Versions/A/Electron Framework',FW+'/Squirrel.framework/Versions/A/Squirrel'])assert.ok(!targets.includes(exe),exe);
 assert.ok(!targets.some(file=>file.includes('/Current')));assert.equal(targets.at(-1),APP);
});
test('contents are signed before the bundle around them, deepest first, and the app last',()=>{
 const h=fixture();h.run();const targets=h.signs().map(target),at=file=>targets.indexOf(file);
 const framework=FW+'/Electron Framework.framework',nested=framework+'/Versions/A/Helpers/Nested.app';
 assert.ok(at(framework+'/Versions/A/Libraries/libffmpeg.dylib')<at(framework));assert.ok(at(nested)<at(framework));assert.ok(at(FW+'/Squirrel.framework/Versions/A/Resources/ShipIt')<at(FW+'/Squirrel.framework'));
 assert.ok(at(APP+'/Contents/Resources/app/src/helpers/wm-pen')<at(APP));
 assert.deepEqual(h.calls.at(-1),{file:'/usr/bin/codesign',args:['--verify','--deep','--strict',APP]});
});
test('app and helper apps carry the entitlements file; frameworks and loose tools carry none',()=>{
 const h=fixture();h.run();const byTarget=Object.fromEntries(h.signs().map(call=>[target(call),call]));
 for(const bundle of [APP,FW+'/Electron Helper (GPU).app',FW+'/Electron Framework.framework/Versions/A/Helpers/Nested.app'])assert.equal(flag(byTarget[bundle],'--entitlements'),ENTITLEMENTS,bundle);
 for(const other of [FW+'/Electron Framework.framework',FW+'/Squirrel.framework',APP+'/Contents/Resources/app/src/helpers/wm-pen',FW+'/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib'])assert.ok(!byTarget[other].args.includes('--entitlements'),other);
});
test('stable identifiers keep the helpers and runtime bundles in the NoteMind namespace',()=>{
 const h=fixture();h.run();const byTarget=Object.fromEntries(h.signs().map(call=>[target(call),flag(call,'--identifier')]));
 assert.equal(byTarget[APP],'com.seancheren.notemind');
 assert.equal(byTarget[APP+'/Contents/Resources/app/src/helpers/wm-pen'],'com.seancheren.notemind.wm-pen');
 assert.equal(byTarget[APP+'/Contents/Resources/app/src/helpers/wm-pen-display'],'com.seancheren.notemind.wm-pen-display');
 assert.equal(byTarget[FW+'/Electron Helper (GPU).app'],'com.seancheren.notemind.runtime.Electron-Helper-GPU');
 assert.equal(byTarget[FW+'/Electron Framework.framework'],'com.seancheren.notemind.runtime.Electron-Framework');
});
test('the entitlements file allows only JIT, WebAssembly code and the camera',()=>{
 const text=fs.readFileSync(ENTITLEMENTS,'utf8'),keys=[...text.matchAll(/<key>([^<]+)<\/key>/g)].map(match=>match[1]).sort();
 assert.deepEqual(keys,['com.apple.security.cs.allow-jit','com.apple.security.cs.allow-unsigned-executable-memory','com.apple.security.device.camera']);
 assert.ok(!keys.some(key=>/audio-input|disable-library-validation|get-task-allow|dyld/.test(key)));
});
test('NOTEMIND_CODESIGN_IDENTITY overrides the default, and NOTEMIND_SIGN_TIMESTAMP=none skips the timestamp server',()=>{
 const h=fixture({env:{NOTEMIND_CODESIGN_IDENTITY:'My signing identity',NOTEMIND_SIGN_TIMESTAMP:'none'},namespace:'com.seancheren.notemind.preview'});const result=h.run();
 assert.equal(result.identity,'My signing identity');assert.ok(!h.calls.some(call=>call.file==='/usr/bin/security'));
 for(const call of h.signs()){assert.ok(call.args.includes('--timestamp=none'));assert.equal(flag(call,'--options'),'runtime');}
 assert.equal(flag(h.signs().at(-1),'--identifier'),'com.seancheren.notemind.preview');
});
test('machines without the Developer ID sign ad hoc with a warning and no timestamp',()=>{
 for(const options of [{identities:'  1) 4567 "Other Identity"\n'},{failure:true},{env:{NOTEMIND_CODESIGN_IDENTITY:'-'}}]){
  const h=fixture(options),result=h.run();assert.equal(result.identity,'-');assert.equal(result.adhoc,true);assert.ok(h.warnings.some(message=>message.includes('ad hoc signing')));
  for(const call of h.signs())assert.ok(call.args.includes('--timestamp=none'));
 }
});
test('unexpected bundle identities are rejected before any signing',()=>{
 const h=fixture({namespace:'com.example.other'});assert.throws(h.run,/Unexpected NoteMind/);assert.ok(!h.calls.some(call=>call.file==='/usr/bin/codesign'));
});
test('an Intel or universal Mach-O anywhere in the app stops the build before signing',()=>{
 for(const archs of ['x86_64','x86_64 arm64']){const h=fixture({archs});assert.throws(h.run,/Apple Silicon only/);assert.ok(!h.calls.some(call=>call.file==='/usr/bin/codesign'));}
});
test('resolveIdentity prefers the environment, then the only Developer ID Application, never another kind',()=>{
 const exec=()=>'  1) AA "Apple Development: Someone Else (ABCDE12345)"\n';
 assert.equal(resolveIdentity({env:{},execFileSync:exec,warn(){}}),'-');
 assert.equal(resolveIdentity({env:{NOTEMIND_CODESIGN_IDENTITY:' X '},execFileSync:exec,warn(){}}),'X');
});

function auditHarness(details){
 const spawn=(file,args)=>{const target=args.at(-1);if(args[0]==='--verify'){return details.invalid===target?{status:1,stderr:'invalid signature\n'}:{status:0,stderr:''};}return {status:0,stdout:'',stderr:details.text(target)};};
 return ()=>auditMacSignature(APP,{team:TEAM,spawn,execFileSync:(file,args)=>{if(file==='/usr/bin/lipo')return 'arm64';},fileSystem:tree(APP_FILES)});
}
const good='Authority=Developer ID Application: Example Dev (TEAMID0000)\nTeamIdentifier=TEAMID0000\nCodeDirectory v=20500 flags=0x10000(runtime) hashes=1+1\nTimestamp=Nov 23, 2026 at 1:00:00 AM\n';
test('the audit passes when every signature is Developer ID, hardened and timestamped',()=>{
 assert.ok(auditHarness({text:()=>good})()>10);
});
test('the audit names each file that is ad hoc, unhardened, untimestamped or from another team',()=>{
 const run=auditHarness({text:file=>file.endsWith('libffmpeg.dylib')?'Signature=adhoc\nflags=0x20002(adhoc,linker-signed)\n':file.endsWith('wm-pen')?good.replace(/flags=0x10000\(runtime\)/,'flags=0x0(none)'):file.endsWith('ShipIt')?good.replace(/Timestamp=.*\n/,''):file.endsWith('koffi.node')?good.replace('TeamIdentifier=TEAMID0000','TeamIdentifier=ZZZZZZZZZZ'):good});
 assert.throws(run,error=>/libffmpeg\.dylib: not signed by a Developer ID/.test(error.message)&&/libffmpeg\.dylib: hardened runtime is off/.test(error.message)&&/wm-pen: hardened runtime is off/.test(error.message)&&/ShipIt: no secure timestamp/.test(error.message)&&/koffi\.node: TeamIdentifier is not TEAMID0000/.test(error.message));
});
test('the audit reports a file whose signature does not verify',()=>{
 const bad=APP+'/Contents/Resources/app/src/helpers/wm-pen-display';
 assert.throws(auditHarness({text:()=>good,invalid:bad}),/wm-pen-display: invalid signature/);
});

test('requireReleaseIdentity accepts only a full Developer ID Application name from the environment', () => {
  const {requireReleaseIdentity, teamOfApp} = require('../scripts/mac-signing.cjs');
  assert.deepEqual(requireReleaseIdentity({NOTEMIND_CODESIGN_IDENTITY: ' Developer ID Application: Example Dev (TEAMID0000) '}), {identity: 'Developer ID Application: Example Dev (TEAMID0000)', team: 'TEAMID0000'});
  for (const value of [undefined, '', '-', 'Developer ID Application: Example Dev', 'Apple Development: Example Dev (TEAMID0000)', '0123456789ABCDEF0123456789ABCDEF01234567']) {
    assert.throws(() => requireReleaseIdentity({NOTEMIND_CODESIGN_IDENTITY: value}), /full name of one Developer ID Application identity/);
  }
  assert.equal(teamOfApp('/x/NoteMind.app', {spawn: () => ({stderr: 'Identifier=x\nTeamIdentifier=TEAMID0000\n'})}), 'TEAMID0000');
  assert.equal(teamOfApp('/x/NoteMind.app', {spawn: () => ({stderr: 'TeamIdentifier=not set\n'})}), null);
});
