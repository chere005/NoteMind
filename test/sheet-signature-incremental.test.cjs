const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),path=require('node:path'),Module=require('node:module');
const output=buildSync({stdin:{contents:"export * from './src/tablet/renderer/tabletPage';export * from './src/tablet/renderer/sheetSignature';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}});
const loaded=new Module(path.resolve('test/signature-fixture.cjs'),module);loaded.filename=path.resolve('test/signature-fixture.cjs');loaded.paths=module.paths;loaded._compile(output.outputFiles[0].text,loaded.filename);
const {TabletPage,sheetSignature,primeStrokeFingerprints,primeBackdropFingerprint}=loaded.exports;
const {fingerprint,hashText,removeSuffix}=require('../src/stroke-signature.js');
const stroke=i=>({colorHex:'#aB12Cd',width:2+i/100,points:[{x:i/1000,y:.3333333333333333},{x:(i+1)/1000,y:.12345678901234567}],pressures:[.1,.9]});
function reference(sheet){const p=sheet.page,e=p.extent,extent=e&&(e.x!==0||e.y!==0||e.width!==1||e.height!==1)?JSON.stringify(e):'';return 'nm2:'+fingerprint([sheet.name,p.aspect,p.strokes.map(fingerprint),p.backdrop?fingerprint(p.backdrop):null,JSON.stringify(sheet.paper||{}),...(extent?[extent]:[])]);}

test('the existing two-part fingerprint can remove and replace UTF16 suffixes exactly',()=>{
 for(let i=0;i<100;i++){const prefix='頁\ud83d\ude00'+String.fromCharCode(i*593)+'['+i,suffix='],"'+String.fromCharCode(i*97)+'"]';const full=hashText(prefix+suffix);assert.equal(removeSuffix(full,suffix),hashText(prefix));assert.equal(hashText(suffix,hashText(prefix)),full);}
});
test('append, batched append, metadata, Undo, Redo and replacement keep legacy nm2 bytes',()=>{
 const page=new TabletPage(1.5),sheet={name:'頁 😀',page,paper:{kind:'blank'}};
 assert.equal(sheetSignature(sheet),reference(sheet));
 for(let i=0;i<120;i++){page.add(stroke(i));if(i%7===0)assert.equal(sheetSignature(sheet),reference(sheet));}
 assert.equal(sheetSignature(sheet),reference(sheet));
 sheet.paper={kind:'grid',spacing:'fine'};page.backdrop='data:image/png;base64,YWJj';assert.equal(sheetSignature(sheet),reference(sheet));
 for(let i=0;i<20;i++){page.undo();assert.equal(sheetSignature(sheet),reference(sheet));}for(let i=0;i<20;i++)page.redo();assert.equal(sheetSignature(sheet),reference(sheet));
 sheet.name='renamed';page.aspect=2;assert.equal(sheetSignature(sheet),reference(sheet));page.replace(page.strokes.filter((_,i)=>i%3));assert.equal(sheetSignature(sheet),reference(sheet));
 page.add(stroke(4000));assert.equal(sheetSignature(sheet),reference(sheet));
});
test('an appended stroke does not revisit the old stroke array or point fingerprints',()=>{
 const page=new TabletPage(1.5),sheet={name:'Large',page,paper:{}};page.strokes=Array.from({length:10000},(_,i)=>stroke(i));sheetSignature(sheet);
 page.add(stroke(10001));let oldReads=0;const old=page.strokes;for(let i=0;i<old.length-1;i++){const value=old[i];Object.defineProperty(old,i,{get(){oldReads++;return value;},configurable:true});}
 sheetSignature(sheet);assert.equal(oldReads,0);sheet.paper={kind:'grid'};sheetSignature(sheet);assert.equal(oldReads,0);
});
test('worker-provided leaf fingerprints skip renderer traversal without changing signatures',()=>{
 const page=new TabletPage(2),sheet={name:'Loaded',page,paper:{}};page.strokes=[stroke(1),stroke(2)];page.backdrop='data:image/png;base64,YWJj';const expected=reference(sheet),hashes=page.strokes.map(fingerprint);primeStrokeFingerprints(page.strokes,hashes);primeBackdropFingerprint(page,fingerprint(page.backdrop));
 for(const ink of page.strokes)Object.defineProperty(ink,'points',{get(){throw Error('Old points were traversed');}});assert.equal(sheetSignature(sheet),expected);
 assert.throws(()=>primeStrokeFingerprints(page.strokes,['invalid']),/fingerprints/);
});
