const {test}=require('node:test'),assert=require('node:assert/strict'),{signMacApp}=require('../scripts/mac-signing.cjs');
function fixture({env={},namespace='com.seancheren.notemind',identities='  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Example (TEAM)"\n',failure=false,tree={}}={}){
 const calls=[],warnings=[],execFileSync=(file,args)=>{calls.push({file,args});if(file==='/usr/bin/security'){if(failure)throw Error('keychain unavailable');return identities;}if(file==='/usr/libexec/PlistBuddy')return namespace+'\n';};
 const fileSystem={readdirSync:folder=>(tree[folder]||[]).map(name=>({name,isDirectory:()=>true,isSymbolicLink:()=>name==='Current'}))};
 return {calls,warnings,run:()=>signMacApp('/build/NoteMind.app',{execFileSync,env,platform:'darwin',fileSystem,warn:message=>warnings.push(message)})};
}
test('Mac signing selects Developer ID and signs native helpers before the app with stable identifiers',()=>{
 const h=fixture(),result=h.run(),signs=h.calls.filter(call=>call.args.includes('--sign'));assert.equal(result.identity,'0123456789ABCDEF0123456789ABCDEF01234567');assert.equal(signs.length,3);assert.deepEqual(signs.map(call=>call.args.at(-1)),['/build/NoteMind.app/Contents/Resources/app/src/helpers/wm-pen','/build/NoteMind.app/Contents/Resources/app/src/helpers/wm-pen-display','/build/NoteMind.app']);
 assert.deepEqual(signs.map(call=>call.args[call.args.indexOf('--identifier')+1]),['com.seancheren.notemind.wm-pen','com.seancheren.notemind.wm-pen-display','com.seancheren.notemind']);
 for(const {args} of signs){assert.ok(args.includes('--timestamp=none'));assert.ok(args.includes('--preserve-metadata=entitlements'));assert.ok(!args.some(value=>value.includes('requirements')));assert.ok(!args.includes('--deep'));}assert.deepEqual(h.warnings,[]);
});
test('explicit identity overrides discovery and Preview keeps a distinct stable namespace',()=>{
 const h=fixture({env:{NOTEMIND_CODESIGN_IDENTITY:'My signing identity'},namespace:'com.seancheren.notemind.preview'});assert.equal(h.run().identity,'My signing identity');assert.ok(!h.calls.some(call=>call.file==='/usr/bin/security'));assert.deepEqual(h.calls.filter(call=>call.args.includes('--sign')).map(call=>call.args[call.args.indexOf('--identifier')+1]),['com.seancheren.notemind.preview.wm-pen','com.seancheren.notemind.preview.wm-pen-display','com.seancheren.notemind.preview']);
});
test('machines without a Developer ID retain local builds with an explicit privacy-permission warning',()=>{
 for(const options of [{identities:''},{failure:true},{env:{NOTEMIND_CODESIGN_IDENTITY:'-'}}]){const h=fixture(options);assert.equal(h.run().identity,'-');assert.ok(h.warnings.some(message=>message.includes('ad hoc signing')));}
});
test('unexpected bundle identities are rejected before any signing',()=>{
 const h=fixture({namespace:'com.example.other'});assert.throws(h.run,/Unexpected NoteMind/);assert.ok(!h.calls.some(call=>call.file==='/usr/bin/codesign'));
});
test('nested Electron helpers and frameworks are signed inside-out, then the complete app is verified',()=>{
 const root='/build/NoteMind.app/Contents/Frameworks',h=fixture({tree:{[root]:['Electron Helper (Plugin).app','Electron Framework.framework','Electron Helper (GPU).app'],[root+'/Electron Framework.framework']:['Versions'],[root+'/Electron Framework.framework/Versions']:['A','Current'],[root+'/Electron Framework.framework/Versions/A']:['Helpers'],[root+'/Electron Framework.framework/Versions/A/Helpers']:['Nested.app']}});h.run();const signs=h.calls.filter(call=>call.args.includes('--sign')),targets=signs.map(call=>call.args.at(-1));
 assert.ok(targets.indexOf(root+'/Electron Framework.framework/Versions/A/Helpers/Nested.app')<targets.indexOf(root+'/Electron Framework.framework'));
 for(const name of ['Electron Helper (Plugin).app','Electron Helper (GPU).app']){const call=signs.find(call=>call.args.at(-1)===root+'/'+name);assert.ok(call);assert.ok(call.args.includes('--preserve-metadata=entitlements'));assert.equal(call.args[call.args.indexOf('--sign')+1],'0123456789ABCDEF0123456789ABCDEF01234567');assert.match(call.args[call.args.indexOf('--identifier')+1],/^com\.seancheren\.notemind\.runtime\./);}
 assert.equal(targets.at(-1),'/build/NoteMind.app');assert.deepEqual(h.calls.at(-1),{file:'/usr/bin/codesign',args:['--verify','--deep','--strict','/build/NoteMind.app']});assert.ok(!targets.some(file=>file.includes('/Current/')));
});
