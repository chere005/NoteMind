const {test}=require('node:test'),assert=require('node:assert/strict'),{md}=require('../src/document-renderer.cjs'),{streamMarkdown}=require('../src/word-markdown.cjs'),{parseInline}=require('../src/word-inline.cjs'),{linkMatches}=require('../src/word-link-matches.cjs');
const comparable=t=>({type:t.type,tag:t.tag,nesting:t.nesting,level:t.level,content:t.content,attrs:(t.attrs?.filter(([key])=>key!=='class')?.length?t.attrs.filter(([key])=>key!=='class'):null),...(t.meta?{meta:t.meta}:{}),...(t.children?{children:t.children.map(comparable)}:{})});
const stream=text=>{const tokens=[];streamMarkdown(text,t=>tokens.push(comparable(t)),{inlineThreshold:0});return tokens;};
const cases=[
  '*a* [b](x) **c** ~~d~~ ==e== <u>f</u> `g`',
  '***one*** ___two___ **a *b* c** *a **b** c* ~~a~~~b~~ ~~~~x~~~~',
  '[*inner* **strong**](relative "title") *outside* [a ~~b~~](https://example.com)',
  '![a *b* **c**](assets/x.png "Picture") ![nested ![child](a.png)](b.png)',
  '[a][ref] ![b][pic]\n\n[ref]: https://example.com "Title"\n[pic]: assets/a.png',
  'www.example.com a@example.com https://exämple.org (example.org), \\*literal* &amp; &#42; &copy;',
  '- [x] *done*\n- [ ] [open](task)\n\n| A | B |\n| --- | --- |\n| **x** | a<br>b |',
  '**unclosed ** x * y _z_\\\n next  \nline\n\n==plain **inside**== <u>*nested*</u>',
  '![nested ![&amp; &#42;](a.png)](b.png)',
  '<u>x</u></u> tail [a](x)',
  '<u>outer <u>inner</u> [link](x)</u> extra </u>',
  'https://example.com `example.net` [example.org](x) ![example.org](x.png)',
  '👨‍👩‍👧‍👦 *emoji* café 中文 — \u0000 \r\n smart “quotes”',
  '&commat;example.com \\@example.com &#35;example.org &lt;example.com&gt;'
];
for(const [i,text]of cases.entries())test('compact Word inline preserves semantic tokens '+i,()=>assert.deepEqual(stream(text),md.parse(text,{}).map(comparable)));
test('compact delimiter lists preserve disjoint nested scope and row reordering',()=>{const pieces=['*a*','__b__','~~c~~~d~~','[*e*](x)','![*alt*](x.png)','***f***','==g==','<u>h</u>','\\*i*','a@example.com'];let seed=27;for(let n=0;n<80;n++){let text='';for(let j=0;j<12;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=pieces[seed%pieces.length]+' ';}assert.deepEqual(stream(text),md.parse(text,{}).map(comparable));}});
test('streamed link candidates retain installed candidate precedence and exact normalization',()=>{const parts=['example.org','a@example.com','http://example.com/x?q=y','https://exämple.org','mailto:a@example.net','(www.example.com).','//example.org','bad://x','中文.example.com','x.org,a.net'];for(let offset=0;offset<parts.length;offset++){const text=parts.slice(offset).concat(parts.slice(0,offset)).join(' / ');assert.deepEqual([...linkMatches(md.linkify,text)],(md.linkify.match(text)||[]).map(item=>({...item})));}});
test('long compact inline stays typed and cancellation interrupts rules before publication',()=>{const text='*a* [b](x) '.repeat(4000);let stats;const tokens=parseInline(text,md,{}, {onStats:value=>stats=value});assert.ok(Array.isArray(tokens));assert.ok(stats.inlineTokens>20000);assert.ok(stats.inlineTypedBytes<stats.inlineTokens*30+300000);assert.equal(stats.delimiterRows,8000);assert.ok(stats.cacheBytes<text.length*5+32768);let checks=0;assert.throws(()=>parseInline(text,md,{}, {check:()=>{if(++checks===3)throw Error('cancelled')}}),/cancelled/);});

test('rendered notes keep unmatched underline closes literal without corrupting parser scope',()=>{assert.equal(md.render('<u>x</u></u> tail [a](x)'),'<p><u>x</u>&lt;/u&gt; tail <a href=\"x\">a</a></p>\n');for(const text of ['<u>[x</u>](url) after','<u>outer <u>inner</u> [link](x)</u> extra </u>','<u>*a*</u></u> *b*']){assert.doesNotThrow(()=>md.render(text));assert.deepEqual(stream(text),md.parse(text,{}).map(comparable));}});

test('literal marker runs never allocate a delimiter or token row per character',()=>{for(const text of ['*'.repeat(40000),'_'.repeat(40000),'~'.repeat(40000)]){let stats;const tokens=parseInline(text,md,{}, {onStats:value=>stats=value});assert.equal(tokens.length,1);assert.equal(tokens[0].content,text);assert.equal(stats.delimiterRows,0);assert.equal(stats.inlineRows,1);}for(const text of ['** * * **','a***b','*** a ***','[a ** ** b](x)','~~ ~~ ~~'])assert.deepEqual(stream(text),md.parse(text,{}).map(comparable));});
