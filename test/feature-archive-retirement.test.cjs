const {EventEmitter}=require('node:events'),{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module');
const file=require.resolve('../src/features.cjs'),relative=createRequire(file),source=raw.readFileSync(file,'utf8'),{ArchiveCodec}=relative('./archive-codec.cjs');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-feature-archive-retirement-')),target=path.join(root,'Drawing.nm'),codec=new ArchiveCodec(),buffers=[],handlers=new Map(),drawingSaves=new(relative('./drawing-save-transport.cjs').DrawingSaveTransport)(),owner=new EventEmitter();owner.isDestroyed=()=>!!owner.dead;owner.destroy=()=>{owner.dead=true;owner.emit('destroyed')};
 t.after(async()=>{await drawingSaves.dispose();await codec.dispose();await fs.rm(root,{recursive:true,force:true});});
 const context={Buffer,fs,win:()=>null,drawingSaves,dialog:{showSaveDialog:async()=>({canceled:false,filePath:target})},ipcMain:{handle:(name,run)=>handlers.set(name,run)},require:name=>name==='./archive-codec.cjs'?Object.fromEntries(['encodeWithDigest','encodeDrawingOwned'].map(method=>[method,async(...args)=>{const result=await codec[method](...args);buffers.push(result.bytes);return result;}])):relative(name)};
 const code=source.slice(source.indexOf(" ipcMain.handle('save-pane',"),source.indexOf(" ipcMain.handle('open-pane',"));vm.runInNewContext(require('./helpers/actual-main-lifecycles.cjs').featureOutputPrefix(source)+code,context);
 return{root,target,buffers,codec,drawingSaves,owner,uploaded:token=>handlers.get('save-pane')({sender:owner},{drawingUpload:token},null,target,{versioned:true}),save:()=>handlers.get('save-pane')({}, {name:'Exact',aspect:1,strokes:[]},Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),null,{versioned:true})};
}
test('drawing save retires its actual transferred archive receiver after file publication',async t=>{
 const h=await fixture(t),saved=await h.save(),bytes=await fs.readFile(h.target);
 assert.equal(saved.revision.bytes,bytes.length);assert.equal(relative('./notepad-format.cjs').decode(bytes).kind,'drawing');assert.equal(h.buffers.length,1);assert.equal(h.buffers[0].byteLength,0);
});
test('drawing save retires its actual transferred archive receiver when guarded publication fails',async t=>{
 const h=await fixture(t),guard=relative('./guarded-write.cjs');t.mock.method(guard,'replaceIfUnchanged',async()=>{throw Object.assign(Error('owned publication fault'),{code:'EIO'})});
 await assert.rejects(h.save(),{code:'EIO'});assert.equal(h.buffers.length,1);assert.equal(h.buffers[0].byteLength,0);await assert.rejects(fs.stat(h.target),{code:'ENOENT'});
});

function upload(h){const graphics=relative('./graphics-pane.js').encodeBytes({name:'Exact upload',aspect:1,strokes:[{colorHex:'#aBcDeF',width:2.125,points:[{x:-0,y:.75}],pressures:[-0]}]}),image=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),original=Buffer.from(graphics),values={graphics,image},header=Object.fromEntries(Object.entries(values).map(([key,bytes])=>[key,{bytes:bytes.length,chars:Buffer.from(bytes).toString('base64').length}])),{token}=h.drawingSaves.begin(h.owner,header);for(const[stream,bytes]of Object.entries(values))h.drawingSaves.write(h.owner,token,{stream,offset:0,data:Buffer.from(bytes).toString('base64')});return{token,graphics,image,original};}
test('uploaded drawing retires its encoded receiver and preserves exact caller ink after publication',async t=>{
 const h=await fixture(t),input=upload(h),saved=await h.uploaded(input.token),bytes=await fs.readFile(h.target),doc=relative('./notepad-format.cjs').decode(bytes),sheet=relative('./graphics-pane.js').decode(doc.files['assets/drawing.svg.json']);
 assert.equal(saved.revision.bytes,bytes.length);assert.equal(h.buffers[0].byteLength,0);assert.deepEqual(Buffer.from(input.graphics),input.original);assert.equal(sheet.strokes[0].colorHex,'#aBcDeF');assert.ok(Object.is(sheet.strokes[0].points[0].x,-0));assert.ok(Object.is(sheet.strokes[0].pressures[0],-0));assert.deepEqual(h.drawingSaves.stats(),{bytes:0,sessions:0,owners:0});
});
test('uploaded owner loss after encoding retires output before releasing its upload claim',async t=>{
 const h=await fixture(t),input=upload(h),encode=h.codec.encodeDrawingOwned.bind(h.codec);let entered,resume;const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>resume=resolve);t.mock.method(h.codec,'encodeDrawingOwned',async(...args)=>{const value=await encode(...args);entered();await gate;return value;});
 const saving=h.uploaded(input.token),rejected=assert.rejects(saving,/cancelled/);await reached;h.owner.destroy();resume();await rejected;assert.equal(h.buffers[0].byteLength,0);assert.deepEqual(Buffer.from(input.graphics),input.original);assert.deepEqual(h.drawingSaves.stats(),{bytes:0,sessions:0,owners:0});await assert.rejects(fs.stat(h.target),{code:'ENOENT'});
});

test('post-commit directory warning preserves the revision while retiring its private archive',async t=>{
 if(process.platform==='win32')return;const h=await fixture(t),open=fs.open,folder=raw.realpathSync.native(h.root);t.mock.method(fs,'open',async(file,...args)=>{const handle=await open(file,...args);if(file===h.root||file===folder)handle.sync=async()=>{throw Object.assign(Error('owned directory sync warning'),{code:'EIO'})};return handle;});
 const saved=await h.save(),bytes=await fs.readFile(h.target);assert.equal(saved.revision.bytes,bytes.length);assert.equal(h.buffers[0].byteLength,0);assert.equal(relative('./notepad-format.cjs').decode(bytes).kind,'drawing');
});
