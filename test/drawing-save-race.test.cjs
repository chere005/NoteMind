const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { buildSync } = require('esbuild');

const signatureModule = { exports: {} };
vm.runInNewContext(buildSync({entryPoints:['src/tablet/renderer/sheetSignature.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,
  { module: signatureModule, exports: signatureModule.exports, WeakRef });
const { sheetSignature } = signatureModule.exports;
const source = fs.readFileSync('src/tablet-entry.tsx', 'utf8');
const implementation = source.slice(source.indexOf(' const prepareSheetSave='), source.indexOf(' const openSheet='));
const stroke = x => ({ colorHex: '#123456', width: 3, points: [{ x, y: .3 }] });
const sheet = name => ({ name, page: { aspect: 2, strokes: [stroke(.2)], backdrop: null }, paper: { kind: 'blank', spacing: 'medium', colour: 'white' } });

function pendingSave(sheets) {
  let complete;
  const context = {
    sheets, active: 0, currentSheets: sheets, sheetSignature, snapshotDrawing: value=>value, denseDrawing:()=>false, btoa: value => Buffer.from(value).toString('base64'),
    latestSheets: { current: sheets.map(s => ({ name: s.name, aspect: s.page.aspect, strokes: s.page.strokes, paper: s.paper })) },
    drawingSvg: () => 'preview',drawingPreview: () => 'preview', refresh() {}, setSaveError(message) { throw Error(message); },
    setSheets(update) { context.currentSheets = update(context.currentSheets); },
    window: { notemind: { savePane(data) { context.savedData = data;return new Promise(resolve => { complete = resolve; }); } } },
  };
  vm.runInNewContext(implementation + ';globalThis.save = saveSheet;globalThis.closeDrawing=closeSheet;', context);
  return { context, complete: file => complete(file) };
}

test('a delayed drawing save marks only the ink written to the file as saved', async () => {
  const first = sheet('First'), { context, complete } = pendingSave([first]);
  const saving = context.save();
  const writtenSignature = sheetSignature({ ...first, page: { ...first.page, strokes: context.savedData.strokes } });
  first.page.strokes = [...first.page.strokes, stroke(.8)];
  complete('/tmp/first.nm');await saving;
  assert.equal(context.currentSheets[0].saved, writtenSignature);
  assert.notEqual(context.currentSheets[0].saved, sheetSignature(context.currentSheets[0]), 'ink added while the save was pending stays dirty');
});

test('a delayed drawing save follows its page through a rename and reorder', async () => {
  const first = sheet('First'), second = sheet('Second'), { context, complete } = pendingSave([first, second]);
  const saving = context.save(), writtenSignature = sheetSignature(first);
  context.currentSheets = [second, { ...first, name: 'Renamed' }];
  complete('/tmp/first.nm');await saving;
  assert.equal(context.currentSheets[0].file, undefined);
  assert.equal(context.currentSheets[1].file, '/tmp/first.nm');
  assert.equal(context.currentSheets[1].name, 'Renamed');
  assert.equal(context.currentSheets[1].saved, writtenSignature);
  assert.notEqual(context.currentSheets[1].saved, sheetSignature(context.currentSheets[1]), 'a rename made while the save was pending stays dirty');
});

test('keeping a newly saved drawing in the project updates the current sheet object', async () => {
  const first = sheet('First'), { context, complete } = pendingSave([first]), events = [];
  context.window.dispatchEvent = event => events.push(event);
  context.CustomEvent = class { constructor(type, options) { this.type = type;this.detail = options.detail; } };
  const start = source.indexOf('onKeep:async(to,on)=>') + 'onKeep:'.length, end = source.indexOf('}}} onHide', start) + 1;
  vm.runInNewContext('globalThis.keep=' + source.slice(start, end), context);
  const keeping = context.keep('project', true);complete('/tmp/first.nm');await keeping;
  assert.equal(context.currentSheets[0].keptProject, true);
  assert.equal(events[0].type, 'notemind-keep-file');assert.equal(events[0].detail, '/tmp/first.nm');
});

test('a rejected asynchronous keep does not mark the drawing as kept', async () => {
 const first=sheet('First');let complete;const events=[],context={sheets:[first],active:0,kept:[first],captureDrawing:()=>({frozen:true}),denseDrawing:()=>false,drawingPreview:()=>new Promise(resolve=>complete=resolve),editableSheet:()=>({name:'First'}),btoa:value=>value,refresh(){},setSheets:update=>{context.kept=update(context.kept)},window:{NoteMindNotes:{captureInsertion:()=>({tab:'original'})},dispatchEvent:event=>{events.push(event);return false}},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}}};
 const start=source.indexOf('onKeep:async(to,on)=>{')+'onKeep:'.length,end=source.indexOf('} onHide=',start),text=source.slice(start,end).replace(/}}$/, '}');vm.runInNewContext('globalThis.keep='+text,context);
 const pending=context.keep('note',true);context.sheets=[sheet('Later')];complete('preview');await pending;assert.equal(events.length,1);assert.equal(events[0].cancelable,true);assert.equal(events[0].detail.insertion.tab,'original');assert.equal(context.kept[0].keptNote,undefined);
});

test('a dense drawing save captures payload and signature before asynchronous preview encoding',async()=>{
 const first=sheet('First'),{context,complete}=pendingSave([first]);let preview;
 context.drawingPreview=()=>new Promise(resolve=>preview=resolve);const saving=context.save(),writtenSignature=sheetSignature(first);assert.equal(context.savedData,undefined);
 first.page.strokes=[...first.page.strokes,stroke(.8)];context.latestSheets.current=[{name:'First',aspect:first.page.aspect,strokes:first.page.strokes,paper:first.paper}];preview('frozen preview');await new Promise(setImmediate);
 assert.equal(context.savedData.strokes.length,1);complete('/tmp/first.nm');await saving;assert.equal(context.currentSheets[0].saved,writtenSignature);assert.notEqual(context.currentSheets[0].saved,sheetSignature(context.currentSheets[0]));
});

test('close drawing keeps ink added during its pending save open and preserves active page identity',async()=>{
 const first=sheet('First'),second=sheet('Second'),{context,complete}=pendingSave([first,second]);
 context.liveSheets={current:[first,second]};context.page={current:second.page};context.sheetsSnapshot=()=>context.liveSheets.current.map(s=>({name:s.name,aspect:s.page.aspect,strokes:s.page.strokes,paper:s.paper}));context.window.notemind.closeSheetChoice=async()=> 'save';context.setSaveError=message=>{context.error=message};context.setActive=value=>{context.active=value};context.setBox=()=>{};
 const closing=context.closeDrawing(first.page);await new Promise(setImmediate);first.page.strokes=[...first.page.strokes,stroke(.9)];context.currentSheets=[second,first];context.liveSheets.current=context.currentSheets;complete('/tmp/first.nm');await closing;
 assert.equal(context.currentSheets.length,2);assert.equal(context.currentSheets[1].page.strokes.length,2);assert.match(context.error,/changed while saving/);assert.equal(context.page.current,second.page);
});
