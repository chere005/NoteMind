const { test } = require('node:test'), assert = require('node:assert/strict');
const { buildSync } = require('esbuild'), vm = require('node:vm');
const result = buildSync({ entryPoints: ['src/tablet/main/pen/manager.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const loaded = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module: loaded, exports: loaded.exports, require, setTimeout, clearTimeout });
const { createFeedManager } = loaded.exports;
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  let resolveFirst, starts = 0, stops = 0;
  const timers = [], state = { settings: { enabled: true, mapSheet: true } };
  const device = name => ({ name, rawX: [0, 100], rawY: [0, 100], pressureMax: 2047, claims: {} });
  const backend = {
    name: 'wintab-data', frameKind: 'device', available: () => ({ ok: true }),
    onSample: () => () => {}, onEvent: () => () => {}, stop() { stops++; },
    start() { starts++;return starts === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve({ ok: true, device: device('replacement') }); },
  };
  const manager = createFeedManager({
    available: true, wintab: backend, inject: {}, injectTablet: {}, mapping: null,
    store: { get: () => state, update: fn => fn(state) }, trace: { event() {} },
    now: () => 1000, e2e: false, native: true, log() {},
    setTimer(fn, ms) { const timer = { fn, ms, cleared: false };timers.push(timer);return timer; },
    clearTimer(timer) { timer.cleared = true; },
  });
  return { manager, timers, completeFirst: () => resolveFirst({ ok: true, device: device('stale') }), stops: () => stops };
}

test('an old startup timeout cannot stop a replacement started after a device change', async () => {
  const { manager, timers, stops } = harness();
  await manager.open();manager.deviceChanged('resume');await settle();
  assert.equal(manager.status().tablet.name, 'replacement');
  const before = stops(), staleTimer = timers.find(timer => timer.ms === 4000 && !timer.cleared);
  staleTimer.fn();await settle();
  assert.equal(stops(), before, 'the stale startup no longer owns the backend');
  assert.equal(manager.status().tablet.name, 'replacement');
  assert.equal(manager.status().note, null);
  manager.dispose();
});

test('an old startup completion cannot stop or overwrite a reopened backend', async () => {
  const { manager, completeFirst, stops } = harness();
  await manager.open();manager.close('sheet gone');await manager.open();await settle();
  assert.equal(manager.status().tablet.name, 'replacement');
  const before = stops();completeFirst();await settle();
  assert.equal(stops(), before, 'a stale global generation cannot stop the new backend');
  assert.equal(manager.status().tablet.name, 'replacement');
  manager.dispose();
});
