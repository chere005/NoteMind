const test=require('node:test'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const renderer=require('../src/document-renderer.cjs'),syntax=renderer.syntax,fixtures=require('./syntax-fixtures.cjs'),format=require('../src/notepad-format.cjs');
const block=(language,text)=>'````'+language+'\n'+text+'````\n';
test('every selected language highlights real syntax and retains exact code through native round trips',()=>{
 assert.equal(syntax.languages.length,24);assert.deepEqual(syntax.languages.map(l=>l.id),fixtures.map(([id])=>id));
 for(const [language,text]of fixtures){let markdown=block(language,text);for(let i=0;i<3;i++){const html=renderer.render(markdown);assert.match(html,/class="hljs-/,language);markdown=renderer.toMarkdown(html);const tokens=renderer.md.parse(markdown,{});assert.equal(tokens[0].info,language);assert.equal(tokens[0].content,text,language);markdown=format.decode(format.encode({text:markdown,assets:{}})).text;}}
});
test('language aliases include the selected file names and JSX and TSX',()=>{
 for(const [alias,id]of Object.entries({'c++':'cpp',h:'c',hpp:'cpp',rs:'rust',py:'python',v:'verilog',xml:'html',ts:'typescript',tsx:'typescript',js:'javascript',jsx:'javascript',sh:'bash',zsh:'bash',yml:'yaml',toml:'ini',md:'markdown',make:'makefile',docker:'dockerfile',patch:'diff','c#':'csharp',cs:'csharp'}))assert.equal(syntax.resolve(alias),id,alias);
 assert.match(syntax.highlight('const view = <div title="hello">Text</div>;', 'jsx'),/hljs-tag/);assert.match(syntax.highlight('const view: JSX.Element = <div>Hello</div>;', 'tsx'),/hljs-tag/);
});
test('plain, unknown and oversized blocks are escaped without detection or dropped code',()=>{
 const code='<script>globalThis.bad = true;</script> & "quote"';for(const language of ['','text','nonesuch','<img onerror=bad>']){const html=renderer.render(block(language,code+'\n'));assert.doesNotMatch(html,/<script>|<img|class="hljs-/);assert.match(html,/&lt;script&gt;/);assert.equal(renderer.md.parse(renderer.toMarkdown(html),{})[0].content,code+'\n');}
 const large='x = "<unsafe>";\n'.repeat(6000);const html=syntax.highlight(large,'javascript');assert.doesNotMatch(html,/<span/);assert.match(html,/&lt;unsafe&gt;/);assert.ok(large.length>syntax.maxCode);
});
test('highlighted code preserves indentation, tabs, blank lines and fence markers',()=>{
 const text='\tif (ready) {\n\n    printf("日本語 & <tag>");  \n}\n```\n\n';const html=renderer.render(block('c',text));const back=renderer.toMarkdown(html);assert.equal(renderer.md.parse(back,{})[0].content,text);assert.ok(back.startsWith('````c'));
});
test('unchanged blocks reuse bounded work and PDF output includes the light syntax palette',()=>{
 const text=fixtures[4][1].repeat(100);syntax.highlight(text,'python');const start=performance.now();for(let i=0;i<1000;i++)syntax.highlight(text,'py');assert.ok(performance.now()-start<250,'cached blocks should not run the grammar again');
 const html=require('../src/documents.cjs').printHtml({text:block('python',fixtures[4][1]),assets:{}});assert.match(html,/hljs-keyword/);assert.match(html,/body class="syntax-light"/);assert.match(html,/--syntax-keyword:#9b1c31/);
});
