const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),path=require('node:path'),Module=require('node:module');
const output=buildSync({stdin:{contents:"export * from './src/tablet/renderer/tabletPage';export * from './src/tablet/renderer/sheetSignature';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,alias:{'@notemind/core':path.resolve('src/tablet/core.js')}});
const loaded=new Module(path.resolve('test/signature-fixture.cjs'),module);loaded.filename=path.resolve('test/signature-fixture.cjs');loaded.paths=module.paths;loaded._compile(output.outputFiles[0].text,loaded.filename);
const {TabletPage,sheetSignature,primeStrokeFingerprints,primeBackdropFingerprint,prepareSheetSignature,bindSheetSignaturePage}=loaded.exports;
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

test('cooperative signature preparation preserves exact JSON field order, UTF16, pressure and metadata bytes',async()=>{
 const page=new TabletPage(1.25),unusual={width:-0,points:[{y:-0,x:.12345678901234567,extra:undefined},{x:.3,y:.5}],colorHex:'#aBcDef',pressures:[-0,.3333333333333333]},sheet={name:'頁\ud83d\ude00\ud800',page,paper:{colour:'cream',kind:'grid'}};
 page.strokes=Array.from({length:12000},(_,i)=>i%2?unusual:stroke(i));page.backdrop='data:image/svg+xml,'+'<svg>頁\ud800</svg>'.repeat(10000);let pauses=0;
 const expected=reference(sheet),prepared=await prepareSheetSignature(sheet,{yieldControl:async()=>{pauses++}});assert.ok(pauses>1);assert.equal(prepared.signature,expected);assert.equal(sheetSignature(sheet),expected);
 // The primed signature must make the first visible read independent of geometry.
 for(let i=0;i<page.strokes.length;i++){const value=page.strokes[i];Object.defineProperty(page.strokes,i,{get(){throw Error('prepared geometry revisited');},configurable:true});}
 sheet.paper={kind:'blank'};assert.equal(sheetSignature(sheet),'nm2:'+hashText('],'+JSON.stringify([fingerprint(page.backdrop),JSON.stringify(sheet.paper)]).slice(1),removeSuffix(expected.slice(4),'],'+JSON.stringify([fingerprint(page.backdrop),JSON.stringify({colour:'cream',kind:'grid'})]).slice(1))));
});

test('bound dense changes prepare the exact signature before visibility and retry changed metadata',async()=>{
 const page=new TabletPage(1),sheet={name:'Before',page,paper:{kind:'blank'}},old=Array.from({length:6000},(_,i)=>stroke(i));page.strokes=old;bindSheetSignaturePage(page,()=>sheet);await prepareSheetSignature(sheet);
 const next=old.slice(0,-1);let pauses=0,seen=0;page.onChange(op=>{if(op?.op!=='mark')seen++;assert.equal(sheetSignature(sheet),reference(sheet));});
 assert.equal(await page.replaceAsync(next,{yieldControl:async()=>{if(++pauses===1)sheet.name='During preparation';}}),true);assert.ok(pauses>0);assert.equal(seen,1);assert.equal(sheet.name,'During preparation');assert.equal(page.undo(),true);assert.equal(sheetSignature(sheet),reference(sheet));
 await prepareSheetSignature({...sheet,name:'After'});sheet.name='After';assert.equal(sheetSignature(sheet),reference(sheet));
 assert.equal(await page.setAspectAsync(2,{yieldControl:async()=>{}}),true);assert.equal(sheetSignature(sheet),reference(sheet));assert.equal(await page.setBackdropAsync('data:image/png;base64,'+'YQ=='.repeat(20000),{yieldControl:async()=>{}}),true);assert.equal(sheetSignature(sheet),reference(sheet));page.dispose();
});

test('signature cancellation and errors cannot publish geometry or strand temporary history ownership',async()=>{
 const page=new TabletPage(1),sheet={name:'Original',page,paper:{}},old=Array.from({length:5000},(_,i)=>stroke(i));page.strokes=old;bindSheetSignaturePage(page,()=>sheet);const next=old.slice(1),controller=new AbortController();
 assert.equal(await page.replaceAsync(next,{signal:controller.signal,yieldControl:async()=>{controller.abort();}}),false);assert.equal(page.strokes,old);assert.equal(page.peekUndo(),null);
 page.setSignaturePreparer(async()=>{throw Error('signature failed')});await assert.rejects(page.replaceAsync(next),/signature failed/);assert.equal(page.strokes,old);assert.equal(page.peekUndo(),null);
 page.setSignaturePreparer(null);assert.equal(await page.replaceAsync(next),true);assert.equal(page.undo(),true);assert.equal(page.strokes,old);page.dispose();
});

test('a dense accepted append copies cooperatively and publishes one undo with its exact prepared signature',async()=>{
 const page=new TabletPage(1),sheet={name:'Ink',page,paper:{}},old=Array.from({length:6000},(_,i)=>stroke(i));page.strokes=old;bindSheetSignaturePage(page,()=>sheet);await prepareSheetSignature(sheet);let pauses=0,events=0;page.onChange(op=>{if(op?.op==='add'){events++;assert.equal(sheetSignature(sheet),reference(sheet));}});
 const added=stroke(7000);assert.equal(await page.addAsync(added,{yieldControl:async()=>{pauses++}}),true);assert.ok(pauses>0);assert.equal(events,1);assert.equal(page.strokes.at(-1),added);assert.equal(page.undo(),true);assert.equal(page.strokes,old);assert.equal(page.undo(),false);page.dispose();
});
