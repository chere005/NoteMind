const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),raw=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os'),{createRequire}=require('node:module');
const relative=createRequire(require.resolve('../src/features.cjs')),source=raw.readFileSync(require.resolve('../src/features.cjs'),'utf8'),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,writeFile){const home=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-preference-order-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));const handlers=new Map(),module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,process,Buffer,require:name=>name==='electron'?{app:{on(){},whenReady:()=>new Promise(()=>{})},dialog:{},ipcMain:{on(){},handle:(key,fn)=>handlers.set(key,fn)}}:name==='node:fs/promises'?{...fs,writeFile}:relative(name)});module.exports(()=>null,{home,root:home,registry:{},recents:{}});return {home,set:(key,value)=>handlers.get('preference-set')({},key,value),get:key=>handlers.get('preference-get')({},key)};}

test('rapid preference changes commit in request order without blocking other keys',async t=>{
 let release,started,secondStarted=false;const gate=new Promise(resolve=>release=resolve),blocked=new Promise(resolve=>started=resolve);
 const f=await fixture(t,async(file,data,...args)=>{if(data==='1'){started();await gate;}if(data==='2')secondStarted=true;return fs.writeFile(file,data,...args);});
 const first=f.set('orientation',1);await blocked;const second=f.set('orientation',2);await f.set('padChromeOrientation',true);await tick();assert.equal(secondStarted,false);assert.equal(await f.get('padChromeOrientation'),true);
 release();await Promise.all([first,second]);assert.equal(await f.get('orientation'),2);assert.deepEqual((await fs.readdir(path.join(f.home,'preferences'))).sort(),['orientation.json','padChromeOrientation.json']);
});

test('failed preference writes reject their caller and allow later choices to save',async t=>{
 let fail=true;const f=await fixture(t,async(...args)=>{if(fail){fail=false;throw Error('fixture disk error');}return fs.writeFile(...args);});
 const first=f.set('orientation',1),rejected=assert.rejects(first,/fixture disk error/),second=f.set('orientation',3);await rejected;await second;assert.equal(await f.get('orientation'),3);
 await assert.rejects(f.set('unknown',1),/Invalid preference/);assert.deepEqual(await fs.readdir(path.join(f.home,'preferences')),['orientation.json']);
});
