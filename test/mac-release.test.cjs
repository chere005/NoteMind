const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {packageRelease,names,DEFAULT_PROFILE}=require('../scripts/mac-release.cjs');
const GOOD='Authority=Developer ID Application: Example Dev (TEAMID0000)\nTeamIdentifier=TEAMID0000\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=Nov 23, 2026\n';

function fixture({version='1.2.0',built='1.2.0',notaryStatus='Accepted',gatekeeper='source=Notarized Developer ID',identities='  1) AA "Developer ID Application: Example Dev (TEAMID0000)"\n',profileWorks=true,env={NOTEMIND_CODESIGN_IDENTITY:'Developer ID Application: Example Dev (TEAMID0000)'},stapleFailures=0}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nm-release-test-'));
 const app=path.join(root,'dist/NoteMind/NoteMind.app');fs.mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});
 fs.writeFileSync(path.join(app,'Contents/MacOS/NoteMind'),Buffer.from('cffaedfe00','hex'));fs.writeFileSync(path.join(app,'Contents/Info.plist'),'');
 const calls=[],log=[];let stapleTries=0;
 const exec=(command,args)=>{
  calls.push([command,...args]);
  const tool=path.basename(command),verb=args[0];
  if(tool==='xcrun'&&verb==='stapler'&&args[1]==='staple'&&stapleTries++<stapleFailures)throw Object.assign(Error('x'),{stderr:'Could not find base64 encoded ticket in response (error 65)'});
  if(tool==='PlistBuddy')return built+'\n';
  if(tool==='lipo')return 'arm64\n';
  if(tool==='security')return identities;
  if(tool==='xcrun'&&verb==='notarytool'){
   if(args[1]==='history'){if(!profileWorks)throw Object.assign(Error('x'),{stderr:'No Keychain password item found for profile'});return '{}';}
   if(args[1]==='submit')return JSON.stringify({id:'sub-'+calls.length,status:notaryStatus});
   if(args[1]==='log')return 'issues: the binary is not signed';
  }
  if(tool==='ditto'&&args[0]==='-c')fs.writeFileSync(args.at(-1),'zip of '+calls.length);
  if(tool==='ditto'&&args[0]==='-x')fs.mkdirSync(path.join(args.at(-1),'NoteMind.app'),{recursive:true});
  if(tool==='ditto'&&!args[0].startsWith('-'))fs.mkdirSync(args[1],{recursive:true});
  if(tool==='hdiutil')fs.writeFileSync(args.at(-1),'dmg bytes');
  return '';
 };
 const spawn=(command,args)=>{
  calls.push([command,...args]);
  if(path.basename(command)==='spctl')return {status:gatekeeper.includes('Notarized')?0:3,stdout:'',stderr:gatekeeper};
  if(args[0]==='--verify')return {status:0,stderr:''};
  return {status:0,stdout:'',stderr:GOOD};
 };
 return {root,calls,log,run:(options={})=>packageRelease({root,version,exec,spawn,env,platform:'darwin',arch:'arm64',log:message=>log.push(message),sleep:ms=>log.push('slept '+ms),...options})};
}
const verbs=calls=>calls.map(call=>call.slice(0,3).map(part=>path.basename(part)).join(' '));
const index=(calls,...needle)=>calls.findIndex(call=>needle.every(part=>call.some(value=>String(value).includes(part))));

test('release files are named for the version, and the updater matches only the zip',()=>{
 const n=names('1.2.0');assert.equal(n.zip,'NoteMind-1.2.0-mac-arm64.zip');assert.equal(n.dmg,'NoteMind-1.2.0-mac-arm64.dmg');
 const {ASSET_NAME}=require('../src/updater.cjs');assert.ok(ASSET_NAME.test(n.zip));assert.ok(!ASSET_NAME.test(n.dmg));assert.ok(!ASSET_NAME.test(n.sums));
});
test('the app is notarized and stapled before the update zip is made from it',()=>{
 const h=fixture(),made=h.run();
 const submitApp=index(h.calls,'notarytool','submit','NoteMind-notarize.zip'),stapleApp=index(h.calls,'stapler','staple','NoteMind.app'),zipMade=index(h.calls,'ditto','NoteMind-1.2.0-mac-arm64.zip');
 assert.ok(submitApp>0&&submitApp<stapleApp&&stapleApp<zipMade,'notarize, then staple, then zip');
 assert.ok(h.calls.some(call=>call.includes('--keychain-profile')&&call.includes(DEFAULT_PROFILE)),'the DisplayMind profile');
 assert.ok(fs.existsSync(made.zip)&&fs.existsSync(made.dmg)&&fs.existsSync(made.sums));
 const sums=fs.readFileSync(made.sums,'utf8');assert.match(sums,/^[0-9a-f]{64}  NoteMind-1\.2\.0-mac-arm64\.zip$/m);assert.match(sums,/^[0-9a-f]{64}  NoteMind-1\.2\.0-mac-arm64\.dmg$/m);
 assert.equal(made.hashes['NoteMind-1.2.0-mac-arm64.zip'],crypto.createHash('sha256').update(fs.readFileSync(made.zip)).digest('hex'));
});
test('the dmg is signed, notarized and stapled as its own submission, with a link to Applications',()=>{
 const h=fixture();h.run();const dmg=index(h.calls,'hdiutil','create'),sign=index(h.calls,'codesign','--force','.dmg'),submit=h.calls.findIndex((call,i)=>i>dmg&&call.includes('submit')),staple=index(h.calls,'staple','.dmg');
 assert.ok(dmg>0&&dmg<sign&&sign<submit&&submit<staple);assert.ok(h.calls[sign].includes('--timestamp'));assert.ok(h.calls[sign].includes('Developer ID Application: Example Dev (TEAMID0000)'));
 assert.equal(h.calls.filter(call=>call.includes('submit')).length,2,'exactly two notarization submissions: the app and the dmg');
});
test('the zip is unpacked and re-verified, so a lost ticket or seal is caught',()=>{
 const h=fixture();h.run();const unpack=index(h.calls,'ditto','-x'),validate=h.calls.findIndex((call,i)=>i>unpack&&call.includes('validate')),verify=h.calls.findIndex((call,i)=>i>unpack&&call.includes('--verify'));
 assert.ok(unpack>0&&validate>unpack&&verify>unpack);
});
test('a rejected notarization stops with Apple\'s log and writes no release file',()=>{
 const h=fixture({notaryStatus:'Invalid'});assert.throws(h.run,/did not accept[\s\S]*the binary is not signed/);
 assert.ok(!fs.existsSync(path.join(h.root,'dist/NoteMind-1.2.0-mac-arm64.zip')));assert.ok(!h.calls.some(call=>call.includes('staple')));
});
test('a stale build, a missing identity or a broken profile stops before anything is submitted',()=>{
 for(const [options,pattern] of [[{built:'1.1.0'},/says 1\.2\.0/],[{env:{}},/full name of one Developer ID Application identity/],[{profileWorks:false},/profile "DisplayMind" does not work/]]){
  const h=fixture(options);assert.throws(h.run,pattern);assert.ok(!h.calls.some(call=>call.includes('submit')));
 }
});
test('Gatekeeper not calling the app notarized Developer ID is a failure',()=>{
 const h=fixture({gatekeeper:'source=Developer ID'});assert.throws(h.run,/does not accept NoteMind\.app as a notarized Developer ID/);
});
test('NOTEMIND_NOTARY_PROFILE chooses another keychain profile',()=>{
 const h=fixture({env:{NOTEMIND_CODESIGN_IDENTITY:'Developer ID Application: Example Dev (TEAMID0000)',NOTEMIND_NOTARY_PROFILE:'Other'}});h.run();assert.ok(h.calls.some(call=>call.includes('submit')&&call.includes('Other')));assert.ok(!h.calls.some(call=>call.includes('submit')&&call.includes('DisplayMind')));
});
test('a scratch run without notarization submits nothing and says so by skipping the Gatekeeper check',()=>{
 const h=fixture();h.run({notarize:false});assert.ok(!h.calls.some(call=>call.includes('notarytool')||call.includes('staple')));
});
test('only Apple Silicon Macs make release files',()=>{
 const h=fixture();assert.throws(()=>h.run({arch:'x64'}),/Apple Silicon/);
});

test('a release is signed only with the identity the owner names in full, never one found in the keychain',()=>{
 for(const env of [{},{NOTEMIND_CODESIGN_IDENTITY:'-'},{NOTEMIND_CODESIGN_IDENTITY:'Developer ID Application: Example Dev'},{NOTEMIND_CODESIGN_IDENTITY:'ABCDEF0123456789ABCDEF0123456789ABCDEF01'},{NOTEMIND_CODESIGN_IDENTITY:'Apple Development: Example Dev (TEAMID0000)'}]){
  const h=fixture({env});assert.throws(h.run,/full name of one Developer ID Application identity/);
  assert.ok(!h.calls.some(call=>path.basename(call[0])==='security'),'the keychain is not searched');assert.ok(!h.calls.some(call=>call.includes('submit')));
 }
 const other=fixture({env:{NOTEMIND_CODESIGN_IDENTITY:'Developer ID Application: Someone Else (TEAMID0000)'},identities:'  1) AA "Developer ID Application: Example Dev (TEAMID0000)"\n'});
 other.run();assert.ok(other.calls.some(call=>call.includes('Developer ID Application: Someone Else (TEAMID0000)')&&call.includes('--force')),'the named identity signs the dmg');
 assert.ok(!other.calls.some(call=>call.includes('Developer ID Application: Example Dev (TEAMID0000)')));
 const scratch=fixture({env:{}});scratch.run({notarize:false});
});

test('a ticket Apple has just accepted is stapled again after a pause, and a ticket that never arrives is a clear failure',()=>{
 const slow=fixture({stapleFailures:2});slow.run();
 assert.equal(slow.calls.filter(call=>call.includes('staple')&&call[0].endsWith('xcrun')&&call.some(part=>part.endsWith('NoteMind.app'))).length>=3,true);
 assert.equal(slow.log.filter(message=>/^slept /.test(message)).length,2,'one pause per failed try');
 assert.ok(fs.existsSync(path.join(slow.root,'dist/NoteMind-1.2.0-mac-arm64.dmg')));
 const never=fixture({stapleFailures:99});assert.throws(never.run,/could not staple NoteMind\.app after 5 tries[\s\S]*error 65/);
 assert.equal(never.log.filter(message=>/^slept /.test(message)).length,4);
 assert.ok(!fs.existsSync(path.join(never.root,'dist/NoteMind-1.2.0-mac-arm64.dmg')));
});
