const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),root=process.env.NOTEMIND_TEST_APP||path.resolve('src');
const document=require(path.join(root,'document-renderer.cjs')),word=require(path.join(root,'documents.cjs')),format=require(path.join(root,'notepad-format.cjs')),zip=require(path.join(root,'zip.cjs'));
test('empty Notes table and multiline formatted text survive repeated Notepad round trips',()=>{
 for(const html of ['<table><tr><td></td><td></td></tr><tr><td></td><td></td></tr></table>','<table><tr><td><b>A | B</b><br>Next</td><td><i>C</i></td></tr><tr><td>One<br>Two<br>Three</td><td>日本語 &amp; text</td></tr></table>']){
  let text=document.toMarkdown(html);const original=text;
  for(let i=0;i<4;i++)text=document.toMarkdown(document.render(format.decode(format.encode({text,assets:{}})).text));
  assert.equal(text,original);assert.equal((document.render(text).match(/<tr>/g)||[]).length,2);
 }
});
test('table line breaks do not enable HTML markup or attributes',()=>{
 assert.match(document.render('| A<br>B | <br onmouseover=bad> |\n|---|---|\n|<script>bad</script>|C|'),/A<br>\nB/);
 assert.doesNotMatch(document.render('<script>bad</script>\n\n<br onmouseover=bad>'),/<script>|<br onmouseover/);
 assert.equal(document.toMarkdown(document.render('`<br>`')),'`<br>`');
});
test('Word tables retain multiline text and use the same ordinary first row',async()=>{
 const text='| **Alpha**<br>Second | Plain |\n| --- | --- |\n| Left | Right |',bytes=await word.exportWord({text,assets:{}}),xml=zip.unpack(bytes)['word/document.xml'].toString();
 assert.match(xml,/<w:br\/>/);assert.doesNotMatch(xml,/E9EDF2/);
 const result=await word.importWord(bytes),html=document.render(result.text);assert.match(html,/Alpha/);assert.match(html,/Second/);assert.match(html,/<br>/);assert.match(html,/<strong>Alpha<\/strong>/);
 assert.match(word.printHtml({text,assets:{}}),/th\{font-weight:normal\}/);
});
