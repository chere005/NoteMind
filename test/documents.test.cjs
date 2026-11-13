const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const format=require('../src/notepad-format.cjs'),zip=require('../src/zip.cjs'),document=require('../src/document-renderer.cjs'),word=require('../src/documents.cjs');
test('versioned Notepad validates attachments and distinguishes archive kinds',()=>{
 const doc={text:'# A\n\n![Drawing](assets/a.svg)',assets:{'assets/a.svg':Buffer.from('<svg/>').toString('base64')}};
 const bytes=format.encode(doc),read=format.decode(bytes);assert.equal(read.text,doc.text);assert.deepEqual(read.assets,doc.assets);assert.equal(read.kind,'notepad');
 const files=zip.unpack(bytes);files['assets/a.svg']=Buffer.from('damaged');assert.throws(()=>format.decode(zip.pack(files)),/damaged/);
 files['manifest.json']=Buffer.from(JSON.stringify({format:'notemind',version:88}));assert.throws(()=>format.decode(zip.pack(files)),/not supported/);
 assert.throws(()=>format.encode({text:'',assets:{'assets/../escape':'AA=='}}),/Invalid/);
});
test('Markdown visual conversion retains nested structures, links, code and tables',()=>{
 const text='# Heading\n\n**Bold** and *italic* [link](https://example.com)\n\n1. First\n2. Second\n   - Nested\n\n> Quoted\n\n```python\nprint("hello")\n```\n\n| A | B |\n|---|---|\n| a | b |';
 const md=document.toMarkdown(document.render(text));const html=document.render(md);for(const tag of ['<h1>','<strong>','<em>','<ol>','<ul>','<blockquote>','<pre>','<table>'])assert.ok(html.includes(tag),tag);assert.ok(html.includes('href="https://example.com"'));assert.ok(!document.render('<script>alert(1)</script>').includes('<script>'));
});
test('Word round trip retains heading, styles, lists, table contents and links',async()=>{
 const text='# Heading\n\n**Bold** *Italic* and [Link](https://example.com)\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| Left | Right |';
 const bytes=await word.exportWord({text,assets:{}}),read=await word.importWord(bytes),html=document.render(read.text);for(const s of ['Heading','<strong>Bold</strong>','<em>Italic</em>','<ol>','<table>','Left','Right','https://example.com'])assert.ok(html.includes(s),s);assert.equal((html.match(/<table>/g)||[]).length,1);
});
test('Markdown sidecar images survive export, reopen, and conversion to a Notepad',async()=>{
 const files=require('../src/markdown-files.cjs'),fsp=require('node:fs/promises'),path=require('node:path');const folder=await fsp.mkdtemp(path.join(require('node:os').tmpdir(),'notemind-md-'));
 const doc={text:'![Drawing](assets/image.svg)',assets:{'assets/image.svg':Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}};
 const file=path.join(folder,'Example.md'),out=await files.prepare(doc,file);await fsp.writeFile(file,out.text);const read=await files.read(file,out.text);assert.equal(Object.keys(read.assets).length,1);const back=files.canonical(read);assert.ok(back.text.includes('assets/'));assert.equal(Object.keys(format.decode(format.encode(back)).assets).length,1);
});

test('Word export preserves underlining alongside nested emphasis',async()=>{
 const bytes=await word.exportWord({text:'<u>under **bold** text</u> and plain',assets:{}});
 const xml=zip.unpack(bytes)['word/document.xml'].toString();
 assert.match(xml,/<w:u\b[^>]*w:val="single"/);
 const html=document.render((await word.importWord(bytes)).text);
 assert.match(html,/<u>under/);assert.match(html,/<strong><u>bold<\/u><\/strong>/);assert.match(html,/plain/);
});

test('Word export restarts separate numbered lists and keeps table alignment',async()=>{
 const text='1. First\n2. Second\n\nA paragraph\n\n1. Third\n2. Fourth\n\n| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
 const files=zip.unpack(await word.exportWord({text,assets:{}})),xml=files['word/document.xml'].toString();
 const ids=[...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(m=>m[1]);assert.equal(ids.length,4);assert.equal(ids[0],ids[1]);assert.equal(ids[2],ids[3]);assert.notEqual(ids[0],ids[2]);
 assert.match(xml,/<w:jc w:val="center"\/>/);assert.match(xml,/<w:jc w:val="right"\/>/);
});
