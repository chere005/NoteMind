const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { transformSync } = require('esbuild');

const signatureModule = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync('src/tablet/renderer/sheetSignature.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code,
  { module: signatureModule, exports: signatureModule.exports });
const { sheetSignature } = signatureModule.exports;
const source = fs.readFileSync('src/tablet-entry.tsx', 'utf8');
const implementation = source.slice(source.indexOf(' const saveSheet='), source.indexOf(' const openSheet='));
const stroke = x => ({ colorHex: '#123456', width: 3, points: [{ x, y: .3 }] });
const sheet = name => ({ name, page: { aspect: 2, strokes: [stroke(.2)], backdrop: null }, paper: { kind: 'blank', spacing: 'medium', colour: 'white' } });

function pendingSave(sheets) {
  let complete;
  const context = {
    sheets, active: 0, currentSheets: sheets, sheetSignature, btoa: value => Buffer.from(value).toString('base64'),
    latestSheets: { current: sheets.map(s => ({ name: s.name, aspect: s.page.aspect, strokes: s.page.strokes, paper: s.paper })) },
    drawingSvg: () => 'preview', refresh() {}, setSaveError(message) { throw Error(message); },
    setSheets(update) { context.currentSheets = update(context.currentSheets); },
    window: { notemind: { savePane(data) { context.savedData = data;return new Promise(resolve => { complete = resolve; }); } } },
  };
  vm.runInNewContext(implementation + ';globalThis.save = saveSheet;', context);
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
