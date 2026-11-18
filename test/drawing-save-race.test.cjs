const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { buildSync } = require('esbuild');

const signatureModule = { exports: {} };
vm.runInNewContext(buildSync({entryPoints:['src/tablet/renderer/sheetSignature.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,
  { module: signatureModule, exports: signatureModule.exports, WeakRef, performance, setTimeout, setImmediate });
const { sheetSignature,prepareSheetSignature } = signatureModule.exports;
const {hasPendingInkMutations}=require('../src/ink-mutations.js');
const source = fs.readFileSync('src/tablet-entry.tsx', 'utf8');
const implementation = source.slice(source.indexOf(' const signatureStamp='),source.indexOf(' const renameIntents='))+'\n'+source.slice(source.indexOf(' const prepareSheetSave='), source.indexOf(' const openSheet='));
async function until(read){for(let at=0;at<50;at++){if(read())return;await new Promise(setImmediate);}assert.fail('Expected owned save preparation did not dispatch.');}
const stroke = x => ({ colorHex: '#123456', width: 3, points: [{ x, y: .3 }] });
const sheet = name => ({ name, page: { aspect: 2, strokes: [stroke(.2)], backdrop: null }, paper: { kind: 'blank', spacing: 'medium', colour: 'white' } });

function pendingSave(sheets) {
  let complete,dispatchedResolve;const dispatched=new Promise(resolve=>dispatchedResolve=resolve);
  const context = {
    sheets, active: 0, currentSheets: sheets,paper:()=>sheets[0].paper,projectInkSnapshot:(_page,strokes)=>strokes,flushInkMutations:()=>null,includeInk:(_extent,strokes)=>({x:0,y:0,width:1,height:1}), surface:{current:null},sheetsSnapshot:()=>context.currentSheets.map(s=>({name:s.name,aspect:s.page.aspect,strokes:s.page.strokes,paper:s.paper})),sheetSignature,prepareSheetSignature,hasPendingInkMutations, snapshotDrawing: value=>value, denseDrawing:()=>false, btoa: value => Buffer.from(value).toString('base64'),
    latestSheets: { current: sheets.map(s => ({ name: s.name, aspect: s.page.aspect, strokes: s.page.strokes, paper: s.paper })) },
    captureReadyDrawing:()=>({frozen:true}),drawingSvg: () => 'preview',drawingPreview: () => 'preview', refresh() {}, setSaveError(message) { throw Error(message); },
    setSheets(update) { context.currentSheets = update(context.currentSheets); },
    window: { notemind: { savePane(data,svg,file,options) { context.savedData = data;context.saveTarget={file,options};dispatchedResolve();return new Promise(resolve => { complete = resolve; }); } } },
  };
  context.bindDrawingSaveChunks=value=>value;context.saveDrawingPane=(api,...args)=>api.savePane(...args);context.pendingSheetActions={current:new Set()};context.page={current:sheets[0].page};context.liveSheets={get current(){return context.currentSheets;}};context.sheetsSnapshot=()=>context.currentSheets.map(s=>({name:s.name,aspect:s.page.aspect,strokes:s.page.strokes,paper:s.paper}));context.ensureSheetReady=async page=>context.currentSheets.find(item=>item.page===page);
  vm.runInNewContext(implementation + ';globalThis.save = saveSheet;globalThis.closeDrawing=closeSheet;', context);
  return { context,dispatched, complete: file => complete(file) };
}

test('a delayed drawing save marks only the ink written to the file as saved', async () => {
  const first = sheet('First'), { context, complete,dispatched } = pendingSave([first]);
  const saving = context.save();await dispatched;
  const writtenSignature = sheetSignature({ ...first, page: { ...first.page, strokes: context.savedData.strokes } });
  first.page.strokes = [...first.page.strokes, stroke(.8)];
  complete('/tmp/first.nm');await saving;
  assert.equal(context.currentSheets[0].saved, writtenSignature);
  assert.notEqual(context.currentSheets[0].saved, sheetSignature(context.currentSheets[0]), 'ink added while the save was pending stays dirty');
});

test('a delayed drawing save follows its page through a rename and reorder', async () => {
  const first = sheet('First'), second = sheet('Second'), { context, complete,dispatched } = pendingSave([first, second]);
  const saving = context.save(), writtenSignature = sheetSignature(first);await dispatched;
  context.currentSheets = [second, { ...first, name: 'Renamed' }];
  complete('/tmp/first.nm');await saving;
  assert.equal(context.currentSheets[0].file, undefined);
  assert.equal(context.currentSheets[1].file, '/tmp/first.nm');
  assert.equal(context.currentSheets[1].name, 'Renamed');
  assert.equal(context.currentSheets[1].saved, writtenSignature);
  assert.notEqual(context.currentSheets[1].saved, sheetSignature(context.currentSheets[1]), 'a rename made while the save was pending stays dirty');
});

test('keeping a newly saved drawing in the project updates the current sheet object', async () => {
  const first = sheet('First'), { context, complete,dispatched } = pendingSave([first]), events = [];
  context.window.dispatchEvent = event => events.push(event);
  context.CustomEvent = class { constructor(type, options) { this.type = type;this.detail = options.detail; } };
  const start = source.indexOf('onKeep:async(to,on)=>') + 'onKeep:'.length, end = source.indexOf('}}} onHide', start) + 1;
  vm.runInNewContext('globalThis.keep=' + source.slice(start, end), context);
  const keeping = context.keep('project', true);await dispatched;complete('/tmp/first.nm');await keeping;
  assert.equal(context.currentSheets[0].keptProject, true);
  assert.equal(events[0].type, 'notemind-keep-file');assert.equal(events[0].detail, '/tmp/first.nm');
});

test('a rejected asynchronous keep does not mark the drawing as kept', async () => {
 const first=sheet('First');let complete;const events=[],context={pendingSheetActions:{current:new Set()},page:{current:first.page},sheets:[first],active:0,kept:[first],captureReadyDrawing:()=>({frozen:true}),denseDrawing:()=>false,drawingPreview:()=>new Promise(resolve=>complete=resolve),editableSheet:()=>({name:'First'}),btoa:value=>value,refresh(){},setSheets:update=>{context.kept=update(context.kept)},window:{NoteMindNotes:{captureInsertion:()=>({tab:'original'})},dispatchEvent:event=>{events.push(event);return false}},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}}};
 context.page={current:first.page};context.liveSheets={current:[first]};context.ensureSheetReady=async()=>first;
 const start=source.indexOf('onKeep:async(to,on)=>{')+'onKeep:'.length,end=source.indexOf('} onHide=',start),text=source.slice(start,end).replace(/}}$/, '}');vm.runInNewContext('globalThis.keep='+text,context);
 const pending=context.keep('note',true);context.sheets=[sheet('Later')];complete('preview');await pending;assert.equal(events.length,1);assert.equal(events[0].cancelable,true);assert.equal(events[0].detail.insertion.tab,'original');assert.equal(context.kept[0].keptNote,undefined);
});

test('versioned save retains its initiating file revision and records the committed revision',async()=>{
 const first=sheet('First');first.file='/tmp/first.nm';first.fileRevision={sha256:'a'.repeat(64),bytes:100};const {context,complete}=pendingSave([first]);let preview;context.drawingPreview=()=>new Promise(resolve=>preview=resolve);const saving=context.save();context.currentSheets=[{...first,fileRevision:{sha256:'b'.repeat(64),bytes:200}}];await until(()=>preview);preview('frozen');await new Promise(setImmediate);assert.deepEqual(JSON.parse(JSON.stringify(context.saveTarget.options.expected)),first.fileRevision);assert.equal(context.saveTarget.options.versioned,true);const revision={sha256:'c'.repeat(64),bytes:300};complete({file:'/tmp/first.nm',revision});assert.equal(await saving,'/tmp/first.nm');assert.equal(context.currentSheets[0].fileRevision,revision);
});

test('dense save passes the encoded sidecar without re-reading newer geometry',async()=>{
 const first=sheet('First'),{context,complete}=pendingSave([first]);let worker,seen;context.denseDrawing=()=>true;context.denseAssets=snapshot=>{seen=snapshot;return new Promise(resolve=>worker=resolve)};const saving=context.save();first.page.strokes=[...first.page.strokes,stroke(.8)];context.latestSheets.current=[{name:'Later',aspect:2,strokes:first.page.strokes,paper:first.paper}];await until(()=>seen);assert.equal(seen.name,'First');assert.equal(seen.strokes.length,1);worker({sidecar:'exact binary',data:'preview'});await new Promise(setImmediate);assert.equal(context.savedData.encodedGraphics,'exact binary');assert.equal(context.savedData.strokes,undefined);complete('/tmp/first.nm');await saving;
});

test('save commits unfinished pen contact before capturing its immutable payload and signature',async()=>{
 const first=sheet('First'),{context,complete,dispatched}=pendingSave([first]);let flushed=0;context.surface.current={flush(){if(!flushed++)first.page.strokes=[...first.page.strokes,stroke(.7)];}};const saving=context.save();assert.equal(flushed,1);await dispatched;assert.equal(context.savedData.strokes.length,2);first.page.strokes=[...first.page.strokes,stroke(.9)];complete('/tmp/first.nm');await saving;assert.notEqual(context.currentSheets[0].saved,sheetSignature(context.currentSheets[0]));
});

test('a dense drawing save captures payload and signature before asynchronous preview encoding',async()=>{
 const first=sheet('First'),{context,complete}=pendingSave([first]);let preview;
 context.drawingPreview=()=>new Promise(resolve=>preview=resolve);const saving=context.save(),writtenSignature=sheetSignature(first);assert.equal(context.savedData,undefined);
 first.page.strokes=[...first.page.strokes,stroke(.8)];context.latestSheets.current=[{name:'First',aspect:first.page.aspect,strokes:first.page.strokes,paper:first.paper}];await until(()=>preview);preview('frozen preview');await new Promise(setImmediate);
 assert.equal(context.savedData.strokes.length,1);complete('/tmp/first.nm');await saving;assert.equal(context.currentSheets[0].saved,writtenSignature);assert.notEqual(context.currentSheets[0].saved,sheetSignature(context.currentSheets[0]));
});

test('close drawing keeps ink added during its pending save open and preserves active page identity',async()=>{
 const first=sheet('First'),second=sheet('Second'),{context,complete}=pendingSave([first,second]);
 context.liveSheets={current:[first,second]};context.page={current:second.page};context.sheetsSnapshot=()=>context.liveSheets.current.map(s=>({name:s.name,aspect:s.page.aspect,strokes:s.page.strokes,paper:s.paper}));context.window.notemind.closeSheetChoice=async()=> 'save';context.setSaveError=message=>{context.error=message};context.setActive=value=>{context.active=value};context.setBox=()=>{};
 const closing=context.closeDrawing(first.page);await new Promise(setImmediate);first.page.strokes=[...first.page.strokes,stroke(.9)];context.currentSheets=[second,first];context.liveSheets.current=context.currentSheets;complete('/tmp/first.nm');await closing;
 assert.equal(context.currentSheets.length,2);assert.equal(context.currentSheets[1].page.strokes.length,2);assert.match(context.error,/changed while saving/);assert.equal(context.page.current,second.page);
});

test('save projects only its captured pending transform and retains initial metadata, viewport and file revision',async()=>{
 const first=sheet('First');first.page.viewport={x:0,y:0,width:1,height:1};first.file='/tmp/first.nm';first.fileRevision={sha256:'a'.repeat(64),bytes:11};const {context,complete}=pendingSave([first]);let project;context.projectInkSnapshot=(_page,strokes)=>new Promise(resolve=>project=()=>resolve(strokes.map(stroke=>({...stroke,points:stroke.points.map(point=>({...point,x:point.x+.2}))}))));const saving=context.save();assert.equal(context.savedData,undefined);first.name='Later';first.page.viewport={x:-1,y:-1,width:3,height:3};first.page.strokes=[...first.page.strokes,stroke(.9)];project();await new Promise(setImmediate);assert.equal(context.savedData.name,'First');assert.equal(context.savedData.strokes.length,1);assert.equal(context.savedData.strokes[0].points[0].x,.4);assert.equal(context.savedData.viewport.width,1);assert.equal(context.saveTarget.options.expected.bytes,11);complete('/tmp/first.nm');await saving;assert.notEqual(context.currentSheets[0].saved,sheetSignature(context.currentSheets[0]));

});
test('a lazy drawing save waits for original geometry and follows its initiating page across selection changes',async()=>{
 const first=sheet('First'),second=sheet('Second');first.loaded=false;first.page.strokes=[];const {context,complete}=pendingSave([first,second]);let hydrate;context.ensureSheetReady=()=>new Promise(resolve=>hydrate=resolve);const saving=context.save();assert.equal(context.savedData,undefined);context.page.current=second.page;context.currentSheets=[second,first];first.page.strokes=[stroke(.7)];first.loaded=true;hydrate(first);await new Promise(setImmediate);assert.equal(context.savedData.name,'First');assert.equal(context.savedData.strokes[0].points[0].x,.7);complete('/tmp/first.nm');await saving;assert.equal(context.currentSheets[0].file,undefined);assert.equal(context.currentSheets[1].file,'/tmp/first.nm');
});
test('closing an unloaded dirty sheet hydrates its ink before deciding whether to prompt',async()=>{
 const first=sheet('First'),second=sheet('Second');first.loaded=false;first.page.strokes=[];const {context}=pendingSave([first,second]);let hydrate,prompts=0;context.ensureSheetReady=()=>new Promise(resolve=>hydrate=resolve);context.window.notemind.closeSheetChoice=async()=>{prompts++;return 'cancel';};context.setActive=()=>{};context.setBox=()=>{};const closing=context.closeDrawing(first.page);assert.equal(prompts,0);first.page.strokes=[stroke(.9)];first.loaded=true;hydrate(first);await closing;assert.equal(prompts,1);assert.equal(context.currentSheets.length,2);
});
