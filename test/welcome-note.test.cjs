const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const guide=require('../src/welcome-note.cjs'),format=require('../src/notepad-format.cjs'),graphics=require('../src/graphics-pane.js'),renderer=require('../src/document-renderer.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-welcome-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {directory:path.join(root,'Documents','NoteMind'),stateFile:path.join(root,'preferences','welcome-note.json'),version:'1.0.0'};}
test('welcome examples render as interactive native content with original assets',()=>{
 const doc=format.decode(format.encode(guide.document())),html=renderer.render(doc.text,doc.assets,doc.meta);
 for(const part of ['type="checkbox"','<table>','<strong>','<em>','<u>','<s>','<mark>','language-python','data-edit-graphics','data-attachment'])assert.ok(html.includes(part),part);
 assert.equal((html.match(/type="checkbox"/g)||[]).length,4);
 const strokes=graphics.decode(Buffer.from(doc.assets['assets/welcome-ink.svg.json'],'base64').toString());assert.equal(strokes.strokes.length,3);assert.equal(strokes.aspect,2.5);
 const pdf=Buffer.from(doc.assets['assets/example-reference.pdf'],'base64').toString();assert.match(pdf,/\/Count 2/);const xref=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(xref,xref+4),'xref');
 for(const offset of [...pdf.matchAll(/^(\d{10}) 00000 n /gm)].map(m=>Number(m[1])))assert.match(pdf.slice(offset),/^\d+ 0 obj/);
 assert.equal(doc.meta.attachments['assets/example-reference.pdf'].bytes,Buffer.byteLength(pdf));
});
test('welcome lives in visible documents and repeated opens do not rewrite it',async t=>{
 const options=await fixture(t),file=await guide.ensure(options),first=await fs.readFile(file),stamp=(await fs.stat(file)).mtimeMs;
 assert.equal(file,path.join(options.directory,'Welcome to NoteMind.nm'));assert.equal(await guide.ensure(options),file);assert.deepEqual(await fs.readFile(file),first);assert.equal((await fs.stat(file)).mtimeMs,stamp);
});
test('a pristine guide refreshes once per release and keeps its document identity',async t=>{
 const options=await fixture(t),file=await guide.ensure(options),first=format.decode(await fs.readFile(file));
 await guide.ensure({...options,version:'2.0.0'});const fresh=format.decode(await fs.readFile(file));assert.equal(fresh.id,first.id);assert.equal(fresh.created,first.created);assert.equal(JSON.parse(await fs.readFile(options.stateFile)).version,'2.0.0');
});
test('guide edits and assets survive later releases',async t=>{
 const options=await fixture(t),file=await guide.ensure(options),doc=format.decode(await fs.readFile(file));doc.text+='\nMy own notes.\n';await fs.writeFile(file,format.encode(doc));const edited=await fs.readFile(file);
 assert.equal(await guide.ensure({...options,version:'2.0.0'}),file);assert.deepEqual(await fs.readFile(file),edited);assert.deepEqual(format.decode(edited).assets,doc.assets);
});
test('a conflicted open draft blocks a template refresh',async t=>{
 const options=await fixture(t),file=await guide.ensure(options),first=await fs.readFile(file);await guide.ensure({...options,version:'2.0.0',preserve:true});assert.deepEqual(await fs.readFile(file),first);assert.equal(JSON.parse(await fs.readFile(options.stateFile)).version,'1.0.0');
});
test('existing and deleted guide paths are never overwritten or resurrected',async t=>{
 const options=await fixture(t);await fs.mkdir(options.directory,{recursive:true});const collision=path.join(options.directory,'Welcome to NoteMind.nm');await fs.writeFile(collision,'user file');const file=await guide.ensure(options);assert.equal(path.basename(file),'Welcome to NoteMind 2.nm');assert.equal(await fs.readFile(collision,'utf8'),'user file');
 await fs.unlink(file);const replacement=await guide.ensure({...options,blocked:[file]});assert.equal(path.basename(replacement),'Welcome to NoteMind 3.nm');assert.equal(await fs.access(file).then(()=>true,()=>false),false);
});
test('concurrent welcome opens share the same document',async t=>{
 const options=await fixture(t),files=await Promise.all(Array.from({length:4},()=>guide.ensure(options)));assert.equal(new Set(files).size,1);assert.equal((await fs.readdir(options.directory)).length,1);
});
