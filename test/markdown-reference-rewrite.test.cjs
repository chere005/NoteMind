const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const markdown=require('../src/markdown-files.cjs'),format=require('../src/notepad-format.cjs');
function document(text){return {text,assets:Object.fromEntries(markdown.references(text).map(name=>[name,Buffer.from('fixture image bytes: '+name).toString('base64')]))};}
function intact(doc){for(const name of markdown.references(doc.text))assert.ok(doc.assets[name],'Missing remapped attachment: '+name);}

test('native saves preserve multiline, escaped, encoded, and reference image destinations',()=>{
 const cases=[
  '![Drawing](photo.png\n "A title")',
  '![Drawing](photo.png\n)',
  '![Drawing](photo\\(1\\).png)',
  '![Drawing](photo&amp;ink.png)',
  '![Drawing](<photo one.png> "A title")',
  '![Drawing][picture]\n\n[picture]:\n  <photo one.png>\n  "A title"',
  '> ![Drawing](photo.png\n> "A title")',
  '- ![Drawing](photo.png)\n  ![Second](photo.png)',
  '![Drawing](photo.png\r\n "A title")\r\n\r\n![Second](other.png)',
  '| Picture | Another |\n|---|---|\n| ![Drawing](photo.png) | ![Other](other.png) |',
  '| Picture | Another |\n|---|---|\n| ![Drawing](photo\\|ink.png) | ![Other](other.png) |',
 ];
 for(const text of cases){const original=document(text);assert.ok(Object.keys(original.assets).length,text);const saved=markdown.canonical(original);intact(saved);intact(format.decode(format.encode(saved)));assert.equal(markdown.references(saved.text).length,markdown.references(text).length,text);}
 assert.equal(markdown.rewrite(cases[0],'photo.png','assets/new.png'),'![Drawing](assets/new.png\n "A title")');
});

test('remapping changes parsed references while code, escaped syntax and unrelated text stay literal',()=>{
 const literal='`![Example](photo.png)`\n\n```markdown\n![Example](photo.png)\n[picture]: photo.png\n```\n\n    ![Example](photo.png)\n\n!\\[Example](photo.png)\n\n==![Example](photo.png)==';
 const text=literal+'\n\n![Actual](photo.png)\n\n| Literal | Actual |\n|---|---|\n| `![Example](photo.png)` | ![Actual](photo.png) |';
 const saved=markdown.canonical(document(text));intact(saved);assert.ok(saved.text.startsWith(literal+'\n\n'));assert.match(saved.text,/\| `!\[Example\]\(photo\.png\)` \| !\[Actual\]\(assets\//);
 assert.equal(markdown.rewrite('![Invalid](photo.png garbage)','photo.png','assets/new.png'),'![Invalid](photo.png garbage)');
});

test('Markdown saves and moves keep every image and the original code examples',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notemind-markdown-references-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const text='![Drawing](photo\\(1\\).png\n "Title")\n\n`![Example](photo\\(1\\).png)`\n\n![Second][picture]\n\n[picture]: <photo one.png>',first=path.join(root,'First.md'),second=path.join(root,'Second.md');
 const prepared=await markdown.prepare(document(text),first);intact(prepared);assert.match(prepared.text,/`!\[Example\]\(photo\\\(1\\\)\.png\)`/);await fs.writeFile(first,prepared.text);await markdown.copy(first,second,{move:true});const reopened=await markdown.read(second,await fs.readFile(second,'utf8'));intact(reopened);assert.equal(Object.keys(reopened.assets).length,2);assert.match(reopened.text,/`!\[Example\]\(photo\\\(1\\\)\.png\)`/);
});
