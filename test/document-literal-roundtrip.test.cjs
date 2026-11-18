const {test}=require('node:test'),assert=require('node:assert/strict'),{createWindow}=require('@mixmark-io/domino'),document=require('../src/document-renderer.cjs');
test('literal imported and typed tag/strike text survives Markdown save and reopen without becoming formatting',()=>{
 for(const text of ['<br>','<BR />','<u>literal</u>','~~literal~~','==literal==','> quote','a > b < c','\\<br>','\\\\<u>x</u>','\\~~literal~~','Math 漢字 <br> 😀 <u>x</u> ~~y~~']){
  const input=createWindow('').document,p=input.createElement('p');p.textContent=text;const markdown=document.toMarkdown(p.outerHTML),reopened=createWindow(document.render(markdown)).document;
  assert.equal(reopened.body.textContent.trimEnd(),text,text+' => '+markdown);assert.equal(reopened.querySelectorAll('u,s,br,mark').length,0,text);assert.equal(document.toMarkdown(document.render(markdown)),markdown);
 }
});
test('actual underline, strike, highlight, hard breaks and multiline tables retain their formatting',()=>{
 const markdown=document.toMarkdown('<p><u>under</u> <del>strike</del> <mark>highlight</mark><br>next</p><table><tr><td>A<br>B</td></tr></table>'),reopened=createWindow(document.render(markdown)).document;
 for(const tag of ['u','s','mark','br','table'])assert.ok(reopened.querySelector(tag),tag);assert.equal(reopened.querySelector('u').textContent,'under');assert.equal(reopened.querySelector('s').textContent,'strike');assert.ok(reopened.querySelector('table br'));
 const code=createWindow(document.render(document.toMarkdown('<pre><code>&lt;br&gt; ~~literal~~</code></pre>'))).document;assert.equal(code.querySelector('code').textContent.trimEnd(),'<br> ~~literal~~');
});
