const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module'),{createHash}=require('node:crypto');
const featureFile=require.resolve('../src/features.cjs'),source=raw.readFileSync(featureFile,'utf8'),relative=createRequire(featureFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{warningFailure=false}={}){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-feature-publication-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const target=path.join(folder,'Drawing.nm'),warnings=[],handlers=new Map(),encoded=Buffer.from('exact-new-drawing-bytes');
 const context={Buffer,fs,win:()=>null,drawingSaves:{},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},dialog:{showSaveDialog:async()=>({canceled:false,filePath:target}),showMessageBox:async(_win,options)=>{warnings.push(options);if(warningFailure)throw Error('warning window closed');}},require:name=>name==='./archive-codec.cjs'?{encodeWithDigest:async()=>({bytes:encoded,revision:hash(encoded)})}:relative(name)};
 const code=source.slice(source.indexOf(" ipcMain.handle('export-image',"),source.indexOf(" ipcMain.handle('open-pane',"));assert.ok(code.includes("ipcMain.handle('save-pane'"));vm.runInNewContext(require('./helpers/actual-main-lifecycles.cjs').featureOutputPrefix(source)+code,context);
 return{folder,target,warnings,encoded,image:(data='bmV3LWltYWdl')=>handlers.get('export-image')({},data,'png'),drawing:options=>handlers.get('save-pane')({}, {name:'Drawing',aspect:1,strokes:[]},Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),target,options)};
}
function directoryFailure(t,folder){const open=fs.open,physical=raw.realpathSync.native(folder);t.mock.method(fs,'open',async(file,...args)=>{const handle=await open(file,...args);if(file===folder||file===physical)handle.sync=async()=>{throw Object.assign(Error('fixture directory sync failure'),{code:'EIO'})};return handle;});}
test('image export preserves the previous file when its replacement write fails partway',async t=>{
 const h=await fixture(t),previous=Buffer.from('previous image bytes');await fs.writeFile(h.target,previous);const writeFile=fs.writeFile,open=fs.open;
 t.mock.method(fs,'writeFile',async(file,data,...args)=>{if(file===h.target){await writeFile(file,Buffer.from(data).subarray(0,3),...args);throw Object.assign(Error('partial replacement write'),{code:'EIO'})}return writeFile(file,data,...args)});
 t.mock.method(fs,'open',async(file,...args)=>{const handle=await open(file,...args);if(String(file).endsWith('.tmp')){const write=handle.writeFile.bind(handle);handle.writeFile=async data=>{await write(Buffer.from(data).subarray(0,3));throw Object.assign(Error('partial replacement write'),{code:'EIO'})};}return handle;});
 await assert.rejects(h.image(),{code:'EIO'});assert.deepEqual(await fs.readFile(h.target),previous);assert.deepEqual(await fs.readdir(h.folder),['Drawing.nm']);assert.equal(h.warnings.length,0);
});
test('drawing export keeps the committed revision when directory durability or warning display fails',async t=>{
 if(process.platform==='win32')return;
 for(const warningFailure of[false,true]){
  const h=await fixture(t,{warningFailure});await fs.writeFile(h.target,'previous drawing');directoryFailure(t,h.folder);const expected=await relative('./guarded-write.cjs').fingerprintFile(h.target),saved=await h.drawing({versioned:true,expected});
  assert.equal(saved.file,await fs.realpath(h.target));assert.equal(saved.revision.sha256,hash(h.encoded));assert.equal(saved.revision.bytes,h.encoded.length);assert.deepEqual(await fs.readFile(h.target),h.encoded);assert.equal(h.warnings.length,1);assert.match(h.warnings[0].detail,/directory sync failure/);
 }
});
test('image export returns its legacy path and reports a post-commit directory durability failure',async t=>{
 if(process.platform==='win32')return;const h=await fixture(t);await fs.writeFile(h.target,'previous image');directoryFailure(t,h.folder);assert.equal(await h.image(),h.target);assert.equal(await fs.readFile(h.target,'utf8'),'new-image');assert.equal(h.warnings.length,1);assert.match(h.warnings[0].detail,/directory sync failure/);
});
