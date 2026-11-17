const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),raw=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module');
const file=require.resolve('../src/features.cjs'),source=raw.readFileSync(file,'utf8'),code=source.slice(source.indexOf(" ipcMain.handle('save-pane',"),source.indexOf(" ipcMain.handle('open-pane',")),relative=createRequire(file),codec=require('../src/archive-codec.cjs'),format=require('../src/notepad-format.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-drawing-file-guard-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const target=path.join(root,'Drawing.nm');let handler;vm.runInNewContext(code,{require:relative,Buffer,fs,ipcMain:{handle:(_,fn)=>handler=fn},dialog:{showSaveDialog:async()=>({filePath:target})},win:()=>null});return {root,target,save:(sheet,file,options)=>handler(null,sheet,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),file,options)};}
const sheet={name:'Drawing',aspect:1,strokes:[]};
test('drawing files return durable revisions and preserve external edits since opening',async t=>{
 const h=await fixture(t),first=await h.save(sheet,null,{versioned:true});assert.equal(first.file,await fs.realpath(h.target));assert.equal(first.revision.bytes,(await fs.stat(h.target)).size);
 const external=format.encode({text:'External drawing change',assets:{}});await fs.writeFile(h.target,external);
 await assert.rejects(h.save(sheet,first.file,{versioned:true,expected:first.revision}),/changed while/);assert.deepEqual(await fs.readFile(h.target),external);
});
test('drawing atomic commit rejects edits arriving during archive preparation',async t=>{
 const h=await fixture(t),first=await h.save(sheet,null,{versioned:true}),encode=codec.encodeWithDigest.bind(codec);let resume,reached;
 const gate=new Promise(resolve=>resume=resolve),started=new Promise(resolve=>reached=resolve);t.mock.method(codec,'encodeWithDigest',async(...args)=>{reached();await gate;return encode(...args);});
 const saving=h.save(sheet,first.file,{versioned:true,expected:first.revision});await started;await fs.writeFile(h.target,'External edit during save');resume();
 await assert.rejects(saving,/changed while/);assert.equal(await fs.readFile(h.target,'utf8'),'External edit during save');assert.deepEqual(await fs.readdir(h.root),['Drawing.nm']);
});
test('legacy drawing save callers retain their path return contract',async t=>{
 const h=await fixture(t),saved=await h.save(sheet,null);assert.equal(saved,await fs.realpath(h.target));assert.equal(format.decode(await fs.readFile(saved)).kind,'drawing');
});
