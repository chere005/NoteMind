const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { surfaceHarness } = require('./helpers/tablet-surface.cjs');
const source = fs.readFileSync('src/tablet-entry.tsx', 'utf8');

test('the real quit-flush path saves an unfinished stroke synchronously and a later lift cannot duplicate it', async () => {
  const h = surfaceHarness();h.pointer('pointerdown', 30, 20);h.pointer('pointermove', 500, 900);
  assert.equal(h.page.strokes.length, 0);
  const model = [{ name: 'Pending', page: h.page }], cached = [{ name: 'Pending', aspect: h.page.aspect, strokes: h.page.strokes }];
  let flush, finished, written;
  const context = {crypto:require('node:crypto').webcrypto,pageIdentities:{current:new WeakMap()},flushAllInkMutations:require('../src/ink-mutations.js').flushAllInkMutations,
    sheetSaver:{current:null}, liveSheets: { current: model }, latestSheets: { current: cached }, saves: { current: Promise.resolve() }, saveTimer: { current: null },
    persistence: { current: { loaded: true, loadFailed: false } }, paper: () => ({ kind: 'blank', spacing: 'medium', colour: 'white' }),
    useEffect: fn => fn(), clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type;this.detail = options.detail; } },
    window: { dispatchEvent(event) { h.dispatch(event.type, event.detail); }, notemind: {
      onSheetsFlush(fn) { flush = fn;return () => {}; }, sheetsFlushDone(error) { finished = error; },
      async saveSheets(data) { written = structuredClone(data); },
    } },
  };
  const snapshotStart = source.indexOf(' const sheetsSnapshot='), snapshotEnd = source.indexOf('\n\n', snapshotStart);
  if (snapshotStart >= 0) vm.runInNewContext(source.slice(snapshotStart, snapshotEnd), context);
  const saveStart = source.indexOf(' const saveNow='), saveEnd = source.indexOf('\n\n', saveStart);
  vm.runInNewContext(source.slice(saveStart, saveEnd), context);
  const flushStart = source.indexOf(' useEffect(()=>window.notemind.onSheetsFlush('), flushEnd = source.indexOf('\n\n', flushStart);
  vm.runInNewContext(source.slice(flushStart, flushEnd), context);
  await flush();
  assert.equal(finished, null);assert.equal(written[0].strokes.length, 1);assert.equal(written[0].strokes[0].points.length, 2);
  assert.ok(written[0].extent.y < 0, 'new margin ink retains its paper extent');
  assert.equal(cached[0].strokes.length, 0, 'the old render cache was never relied on for the flush');
  h.pointer('pointerup', 600, 1000);assert.equal(h.page.strokes.length, 1);
  h.unmount();
});
